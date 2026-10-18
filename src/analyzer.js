import { UTS39_CONFUSABLES, UTS39_MAX_SOURCE_LENGTH } from "./uts39-confusables.js";

// Transparent local URL signals. A score is a PhishLens heuristic, not a probability.
export const SAMPLE_BRANDS = Object.freeze(["google", "facebook", "microsoft", "paypal", "amazon"]);
export const SHORTENER_DOMAINS = Object.freeze(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd"]);
export const AI_SIGNAL_CODES = Object.freeze(["http", "many_subdomains", "long_hostname", "credentials_at", "unicode_or_punycode", "encoded_path", "hyphenated_hostname", "shortener", "lookalike_brand", "sample_blocklist", "ip_address", "suspicious_port", "suspicious_keyword"]);
export const SIGNAL_RISK_POINTS = Object.freeze({
  credentials_at: 25, unicode_or_punycode: 25, lookalike_brand: 25, ip_address: 25,
  http: 12, suspicious_port: 12, shortener: 12,
  many_subdomains: 5, long_hostname: 5, encoded_path: 5, hyphenated_hostname: 5, suspicious_keyword: 5
});

export function safetyBand(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 76) return "green";
  if (score >= 41) return "yellow";
  return "red";
}

export function hostnameMatchesThreatFeed(hostname, domains) {
  if (typeof hostname !== "string" || !Array.isArray(domains)) return false;
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  let low, high, middle, value;
  for (let index = 0; index < labels.length - 1; index++) {
    const candidate = labels.slice(index).join(".");
    low = 0; high = domains.length - 1;
    while (low <= high) {
      middle = (low + high) >>> 1;
      value = domains[middle];
      if (value === candidate) return true;
      if (value < candidate) low = middle + 1; else high = middle - 1;
    }
  }
  return false;
}

export function reportIsHistorical(reportedAt, now = Date.now()) {
  const reported = new Date(reportedAt);
  if (!Number.isFinite(reported.getTime())) return true;
  const expires = new Date(reported);
  expires.setUTCMonth(expires.getUTCMonth() + 12);
  return now > expires.getTime();
}

export function matchVietnamThreatRecords(hostname, data, now = Date.now()) {
  if (typeof hostname !== "string" || !Array.isArray(data?.records)) return [];
  const matches = data.records.filter((record) =>
    typeof record?.domain === "string" && hostnameMatchesThreatFeed(hostname, [record.domain])
  );
  const newestByKind = new Map();
  for (const record of matches) {
    const current = newestByKind.get(record.kind);
    if (!current || new Date(record.reportedAt).getTime() > new Date(current.reportedAt).getTime()) {
      newestByKind.set(record.kind, record);
    }
  }
  return [...newestByKind.values()].map((record) => ({
    ...record,
    historical: reportIsHistorical(record.reportedAt, now)
  }));
}

export function applyVietnamThreatRecords(result, matches, dataStatus = "available", updatedAt = null) {
  if (!result?.valid) return result;
  const records = Array.isArray(matches) ? matches : [];
  const recentImpersonation = records.some((record) => record.kind === "impersonation" && !record.historical);
  const scoreBreakdown = recentImpersonation && !result.scoreBreakdown.some(({ code }) => code === "vietnam_impersonation")
    ? [...result.scoreBreakdown, { code: "vietnam_impersonation", points: 80 }]
    : result.scoreBreakdown;
  const riskScore = Math.min(100, scoreBreakdown.reduce((total, item) => total + item.points, 0));
  const safetyScore = Math.max(0, 100 - riskScore);
  const band = safetyBand(safetyScore);
  const findings = [...result.findings];
  for (const record of records) {
    const dateLabel = record.reportedAt?.slice(0, 7) || record.reportedAt || "không rõ ngày";
    if (record.kind === "impersonation") {
      findings.push(record.historical
        ? `Báo cáo của ${record.sourceName} từng ghi nhận tên miền này giả mạo ${record.target || "tổ chức"} (${dateLabel}); dữ liệu đã quá 12 tháng nên không trừ điểm.`
        : `Báo cáo của ${record.sourceName} ghi nhận tên miền này giả mạo ${record.target || "tổ chức"} (${dateLabel}).`);
    } else if (record.kind === "gambling_violation") {
      findings.push(`Tên miền này có trong danh sách ${record.sourceName} về website cá cược/cờ bạc hoặc vi phạm (${dateLabel}); đây là cảnh báo riêng, không phải kết luận phishing.`);
    }
  }
  return {
    ...result,
    signals: recentImpersonation && !(result.signals || []).some(({ code }) => code === "vietnam_impersonation")
      ? [...(result.signals || []), { code: "vietnam_impersonation" }]
      : (result.signals || []),
    scoreBreakdown,
    riskScore,
    safetyScore,
    band,
    level: band === "red" ? "Nhiều dấu hiệu cần chú ý" : band === "yellow" ? "Cần kiểm tra thêm" : "Ít dấu hiệu đáng ngờ được phát hiện",
    vietnamThreatStatus: dataStatus,
    vietnamThreatMatches: records,
    vietnamThreatUpdatedAt: updatedAt,
    findings
  };
}

function decodePunycodeLabel(label) {
  if (!label.startsWith("xn--")) return label;
  const input = label.slice(4);
  const output = [];
  const delimiter = input.lastIndexOf("-");
  let index = 0;
  if (delimiter >= 0) {
    for (const char of input.slice(0, delimiter)) output.push(char.codePointAt(0));
    index = delimiter + 1;
  }
  let n = 128, i = 0, bias = 72;
  const digit = (char) => char >= "a" && char <= "z" ? char.charCodeAt(0) - 97 : char >= "0" && char <= "9" ? char.charCodeAt(0) - 22 : 36;
  const adapt = (delta, points, first) => {
    delta = first ? Math.floor(delta / 700) : Math.floor(delta / 2);
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > 455) { delta = Math.floor(delta / 35); k += 36; }
    return k + Math.floor(36 * delta / (delta + 38));
  };
  while (index < input.length) {
    const oldI = i;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      if (index >= input.length) return label;
      const value = digit(input[index++]);
      if (value >= 36) return label;
      i += value * weight;
      const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (value < threshold) break;
      weight *= 36 - threshold;
    }
    const points = output.length + 1;
    bias = adapt(i - oldI, points, oldI === 0);
    n += Math.floor(i / points);
    i %= points;
    output.splice(i++, 0, n);
  }
  try { return String.fromCodePoint(...output); } catch { return label; }
}

export function toUnicodeHostname(host) {
  return host.split(".").map(decodePunycodeLabel).join(".");
}

function labelHasMixedLatinScript(label) {
  return /\p{Script=Latin}/u.test(label) && [...label].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char));
}

function skeleton(value) {
  const chars = [...value.normalize("NFD").toLowerCase()];
  let output = "";
  for (let index = 0; index < chars.length;) {
    let replacement;
    let consumed = 0;
    const limit = Math.min(UTS39_MAX_SOURCE_LENGTH, chars.length - index);
    for (let size = limit; size > 0; size--) {
      const candidate = chars.slice(index, index + size).join("");
      if (Object.hasOwn(UTS39_CONFUSABLES, candidate)) {
        replacement = UTS39_CONFUSABLES[candidate];
        consumed = size;
        break;
      }
    }
    output += replacement ?? chars[index];
    index += consumed || 1;
  }
  return output.normalize("NFD");
}

function confusableBrand(host) {
  const labels = host.split(".");
  const candidates = labels.slice(0, -1);
  for (const candidate of candidates) {
    if (!/[^\x00-\x7F]/.test(candidate)) continue;
    const normalized = skeleton(candidate);
    const brand = SAMPLE_BRANDS.find((name) => normalized === skeleton(name));
    if (brand) return { brand, candidate };
  }
  return null;
}

function similarBrand(host) {
  const labels = host.split(".");
  const candidate = labels.length > 1 ? labels.at(-2) : labels[0];
  return SAMPLE_BRANDS.find((brand) => {
    if (candidate === brand || candidate.length < 5 || Math.abs(candidate.length - brand.length) > 2) return false;
    let previous = Array.from({ length: brand.length + 1 }, (_, i) => i);
    for (let i = 1; i <= candidate.length; i++) {
      const row = [i];
      for (let j = 1; j <= brand.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (candidate[i - 1] === brand[j - 1] ? 0 : 1));
      previous = row;
    }
    return previous[brand.length] <= 2;
  });
}

export function analyzeUrl(input) {
  let url;
  try {
    url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("unsupported URL");
  } catch {
    return { valid: false, hostname: "Không xác định", level: "Không thể phân tích trang này", riskScore: null, safetyScore: null, band: "unavailable", scoreBreakdown: [], findings: ["Không thể phân tích URL này. Hãy mở một website có địa chỉ http:// hoặc https://."], advice: [], parts: null };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const unicodeHost = toUnicodeHostname(host);
  const labels = host.split(".");
  const unicodeLabels = unicodeHost.split(".");
  const findings = [];
  const caution = (text) => findings.push(text);
  const risk = (text) => findings.push(text);
  const signalPoints = new Map();
  const addSignal = (code, matched, points = SIGNAL_RISK_POINTS[code] || 0) => {
    if (!matched) return;
    if (!signalPoints.has(code)) signalPoints.set(code, points);
  };
  const normalizedUrl = url;

  if (url.protocol === "http:") risk("Dùng HTTP: kết nối không mã hóa; hãy xác minh website trước khi nhập thông tin.");
  if (labels.length >= 5) caution(`Tên miền có ${labels.length} cấp; hãy kiểm tra kỹ tên miền chính.`);
  if (unicodeHost.length > 50) caution(`Tên miền dài ${unicodeHost.length} ký tự, có thể khó nhận ra lỗi đánh máy.`);
  if (url.username || url.password) risk("URL có thông tin trước dấu @; cấu trúc này có thể làm tên miền thật bị hiểu nhầm.");

  const mixedLabel = unicodeLabels.find(labelHasMixedLatinScript);
  const brandedConfusable = confusableBrand(unicodeHost);
  const asciiLookalike = !brandedConfusable && !mixedLabel ? similarBrand(host) : null;
  if (mixedLabel) {
    const suspiciousChar = [...mixedLabel].find((char) => UTS39_CONFUSABLES[char]);
    const codepoint = suspiciousChar ? ` U+${suspiciousChar.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}` : "";
    caution(`Một phần tên miền trộn chữ Latin với hệ chữ khác${suspiciousChar ? `; ký tự “${suspiciousChar}”${codepoint} có thể trông giống chữ Latin` : ""}. Tên hiển thị: ${unicodeHost}.`);
    addSignal("unicode_or_punycode", true);
  }
  if (brandedConfusable) {
    risk(`Tên miền có ký tự trông giống thương hiệu “${brandedConfusable.brand}”; địa chỉ hiển thị là ${unicodeHost}.`);
    addSignal("lookalike_brand", true, 60);
  } else if (asciiLookalike) {
    risk(`Tên miền gần giống thương hiệu mẫu “${asciiLookalike}”; đây không phải xác nhận về tên miền chính thức.`);
    addSignal("lookalike_brand", true);
  }
  if (/%[0-9a-f]{2}/i.test(url.pathname + url.search)) caution("Đường dẫn có ký tự mã hóa phần trăm, có thể khó đọc bằng mắt.");
  if (unicodeHost.includes("-")) caution("Tên miền có dấu gạch nối; hãy so sánh với địa chỉ chính thức.");
  if (SHORTENER_DOMAINS.includes(host)) risk(`Dịch vụ rút gọn ${host} che khuất đích đến cuối.`);
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) risk("Địa chỉ dùng số thay cho tên miền, khó đối chiếu với website chính thức.");
  if (url.port && !["80", "443"].includes(url.port)) caution("URL dùng cổng kết nối không thường gặp.");
  if (/(?:login|verify|secure|account|wallet|payment|bonus|claim|job|invest|profit)/i.test(`${host}${url.pathname}`)) caution("Tên miền hoặc đường dẫn có từ khóa thường gặp trong lời mời đăng nhập, nhận thưởng hoặc đầu tư; từ khóa riêng lẻ không chứng minh là lừa đảo.");

  addSignal("http", url.protocol === "http:");
  addSignal("many_subdomains", labels.length >= 5);
  addSignal("long_hostname", unicodeHost.length > 50);
  addSignal("credentials_at", Boolean(url.username || url.password));
  addSignal("encoded_path", /%[0-9a-f]{2}/i.test(url.pathname + url.search));
  addSignal("hyphenated_hostname", unicodeHost.includes("-"));
  addSignal("shortener", SHORTENER_DOMAINS.includes(host));
  addSignal("ip_address", /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":"));
  addSignal("suspicious_port", Boolean(url.port && !["80", "443"].includes(url.port)));
  addSignal("suspicious_keyword", /(?:login|verify|secure|account|wallet|payment|bonus|claim|job|invest|profit)/i.test(`${host}${url.pathname}`));

  const scoreBreakdown = [...signalPoints].map(([code, points]) => ({ code, points }));
  const riskScore = Math.min(100, scoreBreakdown.reduce((total, item) => total + item.points, 0));
  const safetyScore = Math.max(0, 100 - riskScore);
  const band = safetyBand(safetyScore);
  const level = band === "red" ? "Nhiều dấu hiệu cần chú ý" : band === "yellow" ? "Cần kiểm tra thêm" : "Ít dấu hiệu đáng ngờ được phát hiện";
  const advice = findings.length ? [
    "Chưa xác minh? Không nhập mật khẩu, mã OTP hoặc thông tin thanh toán.",
    "Tự mở ứng dụng hoặc tự nhập địa chỉ website chính thức để xác minh.",
    "Không tải tệp hoặc ứng dụng từ trang chưa tin cậy.",
    "HTTPS mã hóa kết nối nhưng không chứng minh website thuộc tổ chức mà trang tự nhận."
  ] : [];

  return {
    valid: true, hostname: unicodeHost, canonicalHostname: host, signals: [...signalPoints.keys()].map((code) => ({ code })), scoreBreakdown, riskScore, safetyScore, band, level, findings, advice,
    parts: {
      protocol: normalizedUrl.protocol.replace(":", "").toUpperCase(), host: unicodeHost,
      port: normalizedUrl.port || "Mặc định", path: normalizedUrl.pathname || "/",
      query: normalizedUrl.search ? normalizedUrl.search.slice(1) : "Không có",
      fragment: normalizedUrl.hash ? normalizedUrl.hash.slice(1) : "Không có"
    }
  };
}

export function applyThreatFeed(result, status) {
  if (!result?.valid) return result;
  const match = status?.matched === true;
  const scoreBreakdown = match ? [...result.scoreBreakdown, { code: "threat_feed", points: 80 }] : result.scoreBreakdown;
  const riskScore = Math.min(100, scoreBreakdown.reduce((total, item) => total + item.points, 0));
  const safetyScore = Math.max(0, 100 - riskScore);
  const band = safetyBand(safetyScore);
  return {
    ...result,
    scoreBreakdown,
    riskScore,
    safetyScore,
    band,
    level: band === "red" ? "Nhiều dấu hiệu cần chú ý" : band === "yellow" ? "Cần kiểm tra thêm" : "Ít dấu hiệu đáng ngờ được phát hiện",
    feedStatus: status?.status || "unavailable",
    feedUpdatedAt: status?.updatedAt || null,
    findings: match ? [...result.findings, "Tên miền khớp danh sách Phishing.Database; đây là cảnh báo từ nguồn dữ liệu, không phải kết luận PhishLens xác minh độc lập."] : result.findings
  };
}
