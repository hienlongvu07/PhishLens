// Các quy tắc minh bạch, chạy cục bộ; danh sách bên dưới chỉ dành cho demo.
export const SAMPLE_BRANDS = ["google", "facebook", "microsoft", "paypal", "amazon"];
export const SHORTENER_DOMAINS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd"];
export const SAMPLE_SUSPICIOUS_DOMAINS = ["login-verify-example.test", "secure-account-demo.test"];
export const AI_SIGNAL_CODES = Object.freeze(["http", "many_subdomains", "long_hostname", "credentials_at", "unicode_or_punycode", "encoded_path", "hyphenated_hostname", "shortener", "lookalike_brand", "sample_blocklist", "ip_address", "suspicious_port", "suspicious_keyword"]);
export const SIGNAL_RISK_POINTS = Object.freeze({
  credentials_at: 25, unicode_or_punycode: 25, lookalike_brand: 25, ip_address: 25,
  sample_blocklist: 30,
  http: 12, suspicious_port: 12, shortener: 12,
  many_subdomains: 5, long_hostname: 5, encoded_path: 5, hyphenated_hostname: 5, suspicious_keyword: 5
});

export function riskBand(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 60) return "high";
  if (score >= 25) return "caution";
  return "low";
}

const CONFUSABLES = /[\u0430\u0435\u043e\u0440\u0441\u0445\u0456\u04cf]/i;

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function similarBrand(host) {
  const labels = host.split(".");
  const candidate = labels.length > 1 ? labels.at(-2) : labels[0];
  return SAMPLE_BRANDS.find((brand) => candidate !== brand && candidate.length >= 5 && levenshtein(candidate, brand) <= 2);
}

export function analyzeUrl(input) {
  let url;
  try {
    url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("unsupported URL");
  } catch {
    return { valid: false, hostname: "Không xác định", level: "Không thể phân tích trang này", riskScore: null, band: "unavailable", scoreBreakdown: [], findings: ["Không thể phân tích URL này. Hãy mở một website có địa chỉ http:// hoặc https://."], advice: [], parts: null };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let displayHost = host;
  try { displayHost = decodeURIComponent(new URL(input).hostname); } catch { /* Giữ hostname chuẩn hóa */ }
  const findings = [];
  const caution = (text) => findings.push(text);
  const risk = (text) => findings.push(text);

  if (url.protocol === "http:") risk("Dùng HTTP: kết nối không mã hóa, nên người khác trên đường truyền có thể đọc hoặc sửa dữ liệu.");
  const labels = host.split(".");
  if (labels.length >= 5) caution(`Tên miền có ${labels.length} cấp; tên miền chính thường nằm ngay trước phần đuôi, nên hãy kiểm tra kỹ phần này.`);
  if (host.length > 50) caution(`Tên miền dài ${host.length} ký tự, có thể khó nhận ra lỗi đánh máy hoặc tên miền chính.`);
  if (url.username || url.password) risk("URL có thông tin trước dấu @; cấu trúc này có thể làm phần tên miền thật bị hiểu nhầm.");

  let unicodeHost = host;
  try { unicodeHost = new URL(`https://${host}`).hostname; } catch { /* Bảo toàn host */ }
  if (host.includes("xn--")) {
    let decoded;
    try { decoded = new URL(`https://${host}`).hostname; } catch { decoded = ""; }
    const confusable = /ypal|gооgle|facebооk/i.test(decoded);
    const message = decoded && decoded !== host ? `Tên miền có mã punycode; dạng ký tự hiển thị là ${decoded}. Hãy kiểm tra các ký tự quốc tế.` : "Tên miền có mã punycode (xn--); hãy kiểm tra kỹ ký tự quốc tế hiển thị trong tên miền.";
    if (confusable) risk(message); else caution(message);
  } else if (CONFUSABLES.test(unicodeHost)) {
    risk("Tên miền chứa ký tự Unicode có hình dạng gần giống chữ Latin.");
  }
  if (/%[0-9a-f]{2}/i.test(url.pathname + url.search)) caution("Đường dẫn có ký tự mã hóa phần trăm; đích đến hoặc tham số có thể khó đọc bằng mắt.");
  if (host.includes("-")) caution("Tên miền có dấu gạch nối; hãy so sánh từng ký tự với tên miền chính thức bạn tự nhập.");
  if (SHORTENER_DOMAINS.includes(host)) risk(`Dịch vụ rút gọn ${host} che khuất đích đến cuối cho tới khi liên kết được mở.`);
  const brand = similarBrand(host);
  if (brand) risk(`Tên miền gần giống thương hiệu mẫu “${brand}”, nhưng đây không phải xác nhận về tên miền chính thức.`);
  if (SAMPLE_SUSPICIOUS_DOMAINS.includes(host)) risk("Tên miền khớp danh sách đáng ngờ mẫu của dự án; đây chỉ là dữ liệu demo nhỏ.");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) risk("Địa chỉ dùng số thay cho tên miền; khó đối chiếu với tên website chính thức.");
  if (url.port && !["80", "443"].includes(url.port)) caution("URL dùng cổng kết nối không thường gặp; hãy xác minh đích đến qua kênh chính thức.");
  if (/(?:login|verify|secure|account|wallet|payment|bonus|claim|job|invest|profit)/i.test(`${host}${url.pathname}`)) caution("Tên miền hoặc đường dẫn có từ khóa thường xuất hiện trong lời mời đăng nhập, nhận thưởng hoặc đầu tư; từ khóa riêng lẻ không chứng minh là lừa đảo.");

  const signals = [];
  const addSignal = (code, match) => { if (match) signals.push({ code }); };
  addSignal("http", url.protocol === "http:");
  addSignal("many_subdomains", labels.length >= 5);
  addSignal("long_hostname", host.length > 50);
  addSignal("credentials_at", Boolean(url.username || url.password) || input.includes("@"));
  addSignal("unicode_or_punycode", host.includes("xn--") || CONFUSABLES.test(unicodeHost));
  addSignal("encoded_path", /%[0-9a-f]{2}/i.test(url.pathname + url.search));
  addSignal("hyphenated_hostname", host.includes("-"));
  addSignal("shortener", SHORTENER_DOMAINS.includes(host));
  addSignal("lookalike_brand", Boolean(similarBrand(host)));
  addSignal("sample_blocklist", SAMPLE_SUSPICIOUS_DOMAINS.includes(host));
  addSignal("ip_address", /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":"));
  addSignal("suspicious_port", Boolean(url.port && !["80", "443"].includes(url.port)));
  addSignal("suspicious_keyword", /(?:login|verify|secure|account|wallet|payment|bonus|claim|job|invest|profit)/i.test(`${host}${url.pathname}`));
  const scoreBreakdown = signals.map(({ code }) => ({ code, points: SIGNAL_RISK_POINTS[code] || 0 }));
  const riskScore = Math.min(100, scoreBreakdown.reduce((total, item) => total + item.points, 0));
  const band = riskBand(riskScore);
  const level = band === "high" ? "Nhiều dấu hiệu đáng ngờ" : band === "caution" ? "Cần kiểm tra thêm" : "Ít dấu hiệu được phát hiện";
  const advice = findings.length ? [
    "Chưa xác minh? Không nhập mật khẩu, mã OTP hoặc thông tin thanh toán.",
    "Tự mở ứng dụng hoặc tự nhập địa chỉ website chính thức để xác minh.",
    "Không tải tệp hoặc ứng dụng từ trang chưa tin cậy.",
    "HTTPS mã hóa kết nối nhưng không chứng minh website thuộc tổ chức mà trang tự nhận."
  ] : [];

  return {
    valid: true, hostname: displayHost, canonicalHostname: host, signals, scoreBreakdown, riskScore, band, level, findings, advice,
    parts: {
      protocol: url.protocol.replace(":", "").toUpperCase(), host: displayHost,
      port: url.port || "Mặc định", path: url.pathname || "/",
      query: url.search ? url.search.slice(1) : "Không có",
      fragment: url.hash ? url.hash.slice(1) : "Không có"
    }
  };
}
