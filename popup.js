import { analyzeUrl, applyThreatFeed, applyVietnamThreatRecords, hostnameMatchesThreatFeed, matchVietnamThreatRecords } from "./src/analyzer.js";

const $ = (selector) => document.querySelector(selector);
const API_BASE = chrome.runtime.getManifest().host_permissions[0].replace(/\/\*$/, "");
const FEED_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FEED_DB_NAME = "phishlens-threat-feed";
const FEED_DB_VERSION = 1;
let currentUrl = "";
let currentAnalysis = null;
let analysisReady = Promise.resolve(null);
const miniGuide = [
  ["Ngân hàng / tổ chức", "Tự mở ứng dụng hoặc gọi kênh chính thức; cảnh giác với tin khóa tài khoản, hoàn tiền."],
  ["Mật khẩu / OTP", "Không đọc hoặc gửi OTP cho bất kỳ ai để “xác minh”."],
  ["Cơ quan / dịch vụ công", "Tự vào cổng chính thức, không chuyển phí theo tin nhắn bất ngờ."],
  ["Việc làm / quà tặng", "Cẩn trọng khi phải nộp phí trước, nạp tiền làm nhiệm vụ hoặc nhận thưởng lạ."],
  ["Đầu tư / link rút gọn", "Lợi nhuận chắc chắn và URL che đích đều cần kiểm tra độc lập."],
  ["HTTPS", "Mã hóa kết nối, không chứng minh website thuộc về tổ chức tự nhận."]
];
for (const [title, description] of miniGuide) { const article = document.createElement("article"); const b = document.createElement("b"); b.textContent = title; const span = document.createElement("span"); span.textContent = description; article.append(b, span); $("#mini-guide").append(article); }

function renderList(target, items) {
  target.replaceChildren();
  if (!items.length) return;
  const list = document.createElement("ul"); list.className = "finding-list";
  for (const item of items) { const li = document.createElement("li"); li.textContent = item; list.append(li); }
  target.append(list);
}

function renderParts(parts) {
  const target = $("#parts"); target.replaceChildren();
  if (!parts) return;
  const names = { protocol: "Giao thức", host: "Tên miền", port: "Cổng", path: "Đường dẫn", query: "Tham số", fragment: "Mảnh URL" };
  for (const [key, value] of Object.entries(parts)) {
    const dt = document.createElement("dt"); dt.textContent = names[key];
    const dd = document.createElement("dd"); dd.textContent = value;
    target.append(dt, dd);
  }
}

const SIGNAL_LABELS = {
  credentials_at: "Có dấu @ hoặc thông tin trước @", unicode_or_punycode: "Tên miền trộn hệ chữ", lookalike_brand: "Tên miền giống thương hiệu mẫu", ip_address: "Dùng địa chỉ IP",
  threat_feed: "Có trong danh sách phishing Phishing.Database", http: "Kết nối HTTP", suspicious_port: "Cổng không thường gặp", shortener: "Dịch vụ rút gọn liên kết",
  many_subdomains: "Tên miền có nhiều cấp", long_hostname: "Tên miền dài", encoded_path: "Đường dẫn có ký tự mã hóa", hyphenated_hostname: "Tên miền có gạch nối", suspicious_keyword: "Có từ khóa cần chú ý",
  vietnam_impersonation: "Báo cáo trong nước ghi nhận giả mạo"
};

function renderScore(result) {
  const card = $("#risk-score-card");
  if (!result.valid) { card.classList.add("hidden"); $("#score-breakdown").classList.add("hidden"); return; }
  card.classList.remove("hidden");
  $("#safety-score").textContent = String(result.safetyScore);
  const track = $(".score-track");
  track.setAttribute("aria-valuenow", String(result.safetyScore));
  $("#score-fill").style.width = `${result.safetyScore}%`;
  card.dataset.band = result.band;
  $("#threat-feed-status").textContent = feedStatusText(result);
  renderVietnamThreatStatus(result);
  const breakdown = $("#score-breakdown");
  breakdown.replaceChildren();
  if (!result.scoreBreakdown.length) { breakdown.classList.add("hidden"); return; }
  const title = document.createElement("b"); title.textContent = "Điểm trừ theo dấu hiệu";
  const list = document.createElement("ul");
  for (const item of result.scoreBreakdown) {
    const row = document.createElement("li");
    const label = document.createElement("span"); label.textContent = SIGNAL_LABELS[item.code] || item.code;
    const points = document.createElement("b"); points.textContent = `−${item.points}`;
    row.append(label, points); list.append(row);
  }
  breakdown.append(title, list); breakdown.classList.remove("hidden");
}

function renderVietnamThreatStatus(result) {
  const target = $("#vietnam-threat-status");
  target.replaceChildren();
  const matches = result.vietnamThreatMatches || [];
  if (result.vietnamThreatStatus === "loading") {
    target.append(document.createTextNode("Đang đối chiếu danh sách báo cáo trong nước…"));
  } else if (result.vietnamThreatStatus === "unavailable") {
    target.append(document.createTextNode("Chưa tải được danh sách báo cáo trong nước; điểm phân tích cục bộ vẫn được giữ."));
  } else if (!matches.length) {
    const freshness = result.vietnamThreatStatus === "stale" ? " Đang dùng bản đã lưu; dữ liệu có thể cũ." : "";
    target.append(document.createTextNode(`Không khớp dữ liệu báo cáo đã tải; điều này không chứng minh website an toàn.${freshness}`));
  } else {
    for (const record of matches) {
      const item = document.createElement("p");
      const period = record.reportedAt?.slice(0, 7) || record.reportedAt;
      if (record.kind === "impersonation") {
        item.textContent = record.historical
          ? `Báo cáo ${period} từng ghi nhận tên miền giả mạo ${record.target || "tổ chức"}; đã quá 12 tháng nên không trừ điểm.`
          : `Báo cáo ${period} ghi nhận tên miền giả mạo ${record.target || "tổ chức"}; trừ 80 điểm an toàn.`;
      } else {
        item.textContent = `Có tên trong danh sách cờ bạc/vi phạm (${period}); cảnh báo riêng, không phải kết luận phishing và không đổi điểm.`;
      }
      target.append(item);
      const source = document.createElement("a");
      source.href = record.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = record.sourceName;
      target.append(source);
      if (record.sourceEvidenceUrl) {
        const evidence = document.createElement("a");
        evidence.href = record.sourceEvidenceUrl;
        evidence.target = "_blank";
        evidence.rel = "noopener noreferrer";
        evidence.textContent = "Bài công bố tên miền";
        target.append(document.createTextNode(" · "), evidence);
      }
    }
    if (result.vietnamThreatStatus === "stale") {
      target.append(document.createTextNode(" Đang dùng bản đã lưu; dữ liệu có thể cũ."));
    }
  }
  const lookup = document.createElement("a");
  lookup.href = "https://tinnhiemmang.vn/website-lua-dao";
  lookup.target = "_blank";
  lookup.rel = "noopener noreferrer";
  lookup.textContent = "Tự tra cứu trên Tín Nhiệm Mạng";
  target.append(document.createElement("br"), lookup);
  const scope = document.createElement("p");
  scope.className = "feed-scope-note";
  scope.textContent = "Danh sách chỉ gồm các tên miền được chọn từ báo cáo có nguồn dẫn; không bao phủ toàn bộ danh sách của cơ quan.";
  target.append(scope);
  if (result.vietnamThreatUpdatedAt) {
    const updated = document.createElement("p");
    updated.className = "feed-scope-note";
    updated.textContent = `Dữ liệu PhishLens cập nhật ${new Date(result.vietnamThreatUpdatedAt).toLocaleDateString("vi-VN")}.`;
    target.append(updated);
  }
}

function feedStatusText(result) {
  const updated = result.feedUpdatedAt ? new Date(result.feedUpdatedAt).toLocaleDateString("vi-VN") : "";
  if (result.feedStatus === "match") return `Có trong danh sách phishing của Phishing.Database${updated ? ` · cập nhật ${updated}` : ""}.`;
  if (result.feedStatus === "not-found") return `Không tìm thấy trong danh sách Phishing.Database${updated ? ` · cập nhật ${updated}` : ""}; điều này không bảo đảm an toàn.`;
  if (result.feedStatus === "stale-match") return `Có trong danh sách Phishing.Database đã lưu${updated ? ` · cập nhật ${updated}` : ""}.`;
  if (result.feedStatus === "stale-not-found") return `Chưa tìm thấy trong danh sách Phishing.Database đã lưu${updated ? ` · cập nhật ${updated}` : ""}; dữ liệu có thể cũ.`;
  if (result.feedStatus === "unavailable") return "Chưa đối chiếu được danh sách phishing; điểm cục bộ vẫn được giữ.";
  return "Đang đối chiếu danh sách cảnh báo…";
}

function openFeedDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FEED_DB_NAME, FEED_DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore("cache");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readFeedCache() {
  const db = await openFeedDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("cache", "readonly").objectStore("cache").get("active-domains");
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function writeFeedCache(value) {
  const db = await openFeedDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("cache", "readwrite");
    transaction.objectStore("cache").put(value, "active-domains");
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function readVietnamFeedCache() {
  const db = await openFeedDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("cache", "readonly").objectStore("cache").get("vietnam-reported-sites");
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function writeVietnamFeedCache(value) {
  const db = await openFeedDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("cache", "readwrite");
    transaction.objectStore("cache").put(value, "vietnam-reported-sites");
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function downloadFeed() {
  const options = { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000) };
  const [metadataResponse, feedResponse] = await Promise.all([
    fetch(`${API_BASE}/data/phishing-domains.json`, options),
    fetch(`${API_BASE}/data/phishing-domains.gzdata`, options)
  ]);
  if (!metadataResponse.ok || !feedResponse.ok) throw new Error("feed unavailable");
  const metadata = await metadataResponse.json();
  const compressed = await feedResponse.arrayBuffer();
  if (!metadata?.updatedAt || !Number.isFinite(metadata.domainCount) || compressed.byteLength < 100_000) throw new Error("invalid feed");
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", compressed);
    const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (checksum !== metadata.sha256) throw new Error("feed checksum mismatch");
  }
  if (typeof DecompressionStream !== "function") throw new Error("gzip unsupported");
  const decompressed = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")));
  const text = await decompressed.text();
  const domains = text.split(/\r?\n/).filter(Boolean);
  if (domains.length < 10_000 || domains.length !== metadata.domainCount) throw new Error("invalid feed contents");
  return { domains, updatedAt: metadata.updatedAt, fetchedAt: Date.now() };
}

async function lookupThreatFeed(hostname) {
  let cached = null;
  try { cached = await readFeedCache(); } catch { /* Continue with a network lookup. */ }
  try {
    let current = cached;
    const cacheFresh = Boolean(current && Date.now() - current.fetchedAt <= FEED_MAX_AGE_MS);
    if (!cacheFresh) {
      current = await downloadFeed();
      try { await writeFeedCache(current); } catch { /* This popup can still use the freshly downloaded feed. */ }
    }
    const matched = hostnameMatchesThreatFeed(hostname, current.domains);
    return { status: matched ? "match" : "not-found", matched, updatedAt: current.updatedAt };
  } catch {
    if (cached?.domains?.length) {
      const matched = hostnameMatchesThreatFeed(hostname, cached.domains);
      return { status: matched ? "stale-match" : "stale-not-found", matched, updatedAt: cached.updatedAt };
    }
    return { status: "unavailable", matched: false };
  }
}

async function downloadVietnamThreatData() {
  const response = await fetch(`${API_BASE}/data/vietnam-reported-sites.json`, {
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error("Vietnam threat data unavailable");
  const data = await response.json();
  if (!data?.updatedAt || !Number.isFinite(data.recordCount) || !Array.isArray(data.records) || data.recordCount !== data.records.length) {
    throw new Error("Vietnam threat data invalid");
  }
  for (const record of data.records) {
    if (typeof record.domain !== "string" || !["impersonation", "gambling_violation"].includes(record.kind)
      || typeof record.reportedAt !== "string" || typeof record.sourceUrl !== "string" || typeof record.sourceName !== "string") {
      throw new Error("Vietnam threat record invalid");
    }
  }
  return { ...data, fetchedAt: Date.now() };
}

async function lookupVietnamThreatRecords(hostname) {
  let cached = null;
  try { cached = await readVietnamFeedCache(); } catch { /* Continue with a network lookup. */ }
  try {
    let current = cached;
    const cacheFresh = Boolean(current && Date.now() - current.fetchedAt <= FEED_MAX_AGE_MS);
    if (!cacheFresh) {
      current = await downloadVietnamThreatData();
      try { await writeVietnamFeedCache(current); } catch { /* Use the downloaded data for this check. */ }
    }
    return {
      status: "available",
      updatedAt: current.updatedAt,
      matches: matchVietnamThreatRecords(hostname, current)
    };
  } catch {
    if (cached?.records?.length) {
      return { status: "stale", updatedAt: cached.updatedAt, matches: matchVietnamThreatRecords(hostname, cached) };
    }
    return { status: "unavailable", matches: [] };
  }
}

async function readAiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok) {
    throw Object.assign(new Error("AI request failed"), { code: data?.code || "AI_SERVICE_ERROR", status: response.status });
  }
  if (!data?.ai || Object.keys(data.ai).length !== 3
    || typeof data.ai.summary !== "string" || !data.ai.summary.trim() || data.ai.summary.length > 320
    || !Array.isArray(data.ai.evidence) || data.ai.evidence.length > 2
    || data.ai.evidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 140)
    || typeof data.ai.nextStep !== "string" || !data.ai.nextStep.trim() || data.ai.nextStep.length > 180) {
    throw Object.assign(new Error("AI response invalid"), { code: "AI_INVALID_OUTPUT", status: response.status });
  }
  return data;
}

const AI_ERROR_MESSAGES = Object.freeze({
  AI_NOT_CONFIGURED: "Tính năng giải thích AI hiện chưa sẵn sàng.",
  AI_MODEL_INVALID: "Chưa thể tạo lời giải thích lúc này. Kết quả kiểm tra vẫn còn.",
  HIVE_AUTH_FAILED: "Dịch vụ giải thích tạm thời không thể xử lý yêu cầu.",
  HIVE_MODEL_NOT_FOUND: "Chưa thể tạo lời giải thích lúc này. Kết quả kiểm tra vẫn còn.",
  HIVE_BALANCE_REQUIRED: "Dịch vụ giải thích đang tạm ngưng. Kết quả kiểm tra vẫn còn.",
  HIVE_RATE_LIMITED: "Dịch vụ nhận quá nhiều yêu cầu. Hãy thử lại sau.",
  HIVE_UNAVAILABLE: "Dịch vụ đang bận. Hãy thử lại sau.",
  AI_TIMEOUT: "Phân tích mất quá nhiều thời gian. Bạn có thể thử lại.",
  AI_PROVIDER_CONNECTION_FAILED: "Chưa kết nối được dịch vụ giải thích. Bạn có thể thử lại.",
  AI_NETWORK_ERROR: "Chưa kết nối được PhishLens. Hãy kiểm tra mạng rồi thử lại.",
  AI_INVALID_OUTPUT: "Chưa tạo được phần giải thích. Bạn có thể thử lại.",
  HIVE_REQUEST_INVALID: "Dịch vụ giải thích chưa xử lý được yêu cầu này.",
  INVALID_REQUEST: "Yêu cầu giải thích chưa hợp lệ. Kết quả kiểm tra cục bộ vẫn còn.",
  AI_PROVIDER_ERROR: "Chưa lấy được phần giải thích lúc này. Bạn có thể thử lại.",
  AI_SERVICE_ERROR: "Chưa lấy được phần giải thích lúc này. Bạn có thể thử lại."
});

function renderAiError(error) {
  const code = AI_ERROR_MESSAGES[error?.code] ? error.code : error?.name === "TypeError" ? "AI_NETWORK_ERROR" : "AI_SERVICE_ERROR";
  const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : "Không nhận được phản hồi HTTP";
  const statusNode = $("#ai-status");
  statusNode.replaceChildren(document.createTextNode(AI_ERROR_MESSAGES[code]));
  statusNode.classList.add("is-error");
  const details = document.createElement("details");
  details.className = "ai-error-details";
  const summary = document.createElement("summary"); summary.textContent = "Thông tin chi tiết";
  const diagnostic = document.createElement("code"); diagnostic.textContent = `${code} · ${status}`;
  details.append(summary, diagnostic);
  statusNode.append(details);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentUrl = tab?.url || "";
  let result = analyzeUrl(currentUrl);
  currentAnalysis = result;
  $("#domain").textContent = result.valid ? result.hostname : "Trang này chưa hỗ trợ kiểm tra";
  $("#level").textContent = result.level;
  $("#level").className = `level ${result.band}`;
  $("#summary").textContent = result.valid ? `${result.findings.length} dấu hiệu cần chú ý` : "Trang này chưa thể kiểm tra. Hãy mở một website có địa chỉ bắt đầu bằng http:// hoặc https://.";
  $("#finding-count").textContent = String(result.findings.length);
  renderList($("#findings"), result.findings);
  $("#no-findings").classList.toggle("hidden", result.findings.length > 0 || !result.valid);
  renderParts(result.parts);
  renderScore(result);
  $("#report").disabled = !result.valid;
  $("#ai-analyze").disabled = !result.valid;
  $("#ai-consent-note").textContent = result.valid
    ? "Tên miền và dấu hiệu chỉ được gửi khi bạn chọn tiếp tục."
    : "Mở một website để xem kết quả kiểm tra.";
  $("#report").textContent = "Gửi báo cáo đến website PhishLens";

  if (result.valid) {
    result = { ...result, vietnamThreatStatus: "loading", vietnamThreatMatches: [] };
    currentAnalysis = result;
    renderScore(result);
    analysisReady = Promise.all([
      lookupThreatFeed(result.canonicalHostname),
      lookupVietnamThreatRecords(result.canonicalHostname)
    ]).then(([feedStatus, vietnamData]) => {
      let completed = applyThreatFeed(result, feedStatus);
      completed = applyVietnamThreatRecords(completed, vietnamData.matches, vietnamData.status, vietnamData.updatedAt);
      result = completed;
      currentAnalysis = result;
      $("#level").textContent = result.level;
      $("#level").className = `level ${result.band}`;
      $("#finding-count").textContent = String(result.findings.length);
      renderList($("#findings"), result.findings);
      $("#no-findings").classList.toggle("hidden", result.findings.length > 0);
      renderScore(result);
      return result;
    }).catch(() => {
      let completed = applyThreatFeed(result, { status: "unavailable", matched: false });
      completed = applyVietnamThreatRecords(completed, [], "unavailable");
      result = completed;
      currentAnalysis = completed;
      renderScore(completed);
      return completed;
    });
  }
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
  document.querySelectorAll(".panel").forEach((panel) => {
    const isActive = panel.id === button.dataset.panel;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.remove("is-entering");
    if (isActive) {
      // Restart the short visual transition when switching tabs.
      void panel.offsetWidth;
      panel.classList.add("is-entering");
    }
  });
}));

$("#settings").addEventListener("click", () => chrome.tabs.create({ url: API_BASE }));
$("#guide-link").href = `${API_BASE}/#cam-nang`;
$("#privacy-link").href = `${API_BASE}/privacy.html`;
for (const [id, path] of [["#community-link", "/community.html"], ["#challenge-link", "/challenge.html"], ["#beta-link", "/beta.html"], ["#campaign-link", "/campaign.html"]]) {
  const link = $(id); link.href = `${API_BASE}${path}`;
  link.addEventListener("click", (event) => { event.preventDefault(); chrome.tabs.create({ url: link.href }); });
}

function requestAiConsent(hostname) {
  const dialog = $("#ai-consent-dialog");
  $("#consent-domain").textContent = hostname;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "approve"), { once: true });
  });
}

$("#ai-analyze").addEventListener("click", async () => {
  if (!currentAnalysis?.valid) return;
  const hostname = currentAnalysis.canonicalHostname;
  const approved = await requestAiConsent(hostname);
  if (!approved) return;

  const button = $("#ai-analyze");
  const status = $("#ai-status");
  button.disabled = true;
  button.textContent = "Đang giải thích…";
  status.replaceChildren(document.createTextNode("Đang hoàn tất đối chiếu để giải thích kết quả…"));
  status.classList.remove("is-error");
  $("#community-result").classList.add("hidden");
  $("#ai-result").classList.add("hidden");
  try {
    const latestAnalysis = await analysisReady;
    const signalCodes = [...new Set((latestAnalysis?.signals || currentAnalysis.signals).map(({ code }) => code))];
    status.textContent = "Đang tạo phần giải thích…";
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, signalCodes }),
      credentials: "omit", cache: "no-store", redirect: "error"
    });
    const data = await readAiResponse(response);
    const community = $("#community-result");
    if (data.community?.status === "verified") {
      const label = document.createElement("b"); label.textContent = `Cảnh báo PhishLens đã xác minh${data.community.demo ? " · Tình huống minh họa" : ""}`;
      const summary = document.createElement("p"); summary.textContent = data.community.summary;
      community.replaceChildren(label, summary);
      try {
        const sourceUrl = new URL(data.community.sourceUrl);
        if (sourceUrl.protocol === "https:") {
          const source = document.createElement("a"); source.href = sourceUrl.href; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = `Nguồn: ${data.community.source || "nguồn đã duyệt"}`;
          community.append(source);
        }
      } catch { /* Keep the verified alert text without an invalid source link. */ }
      community.classList.remove("hidden");
    }
    const result = $("#ai-result");
    result.replaceChildren();
    const heading = document.createElement("b"); heading.textContent = "Giải thích kết quả";
    const summary = document.createElement("p"); summary.textContent = data.ai.summary;
    result.append(heading, summary);
    if (data.ai.evidence.length) {
      const label = document.createElement("b"); label.textContent = "Dấu hiệu liên quan";
      const list = document.createElement("ul");
      for (const value of data.ai.evidence) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
      result.append(label, list);
    }
    const actionLabel = document.createElement("b"); actionLabel.textContent = "Bạn nên làm gì";
    const action = document.createElement("p"); action.textContent = data.ai.nextStep;
    result.append(actionLabel, action);
    const limits = document.createElement("p"); limits.className = "ai-limitation"; limits.textContent = "AI chỉ giải thích các dấu hiệu; điểm an toàn không thay đổi.";
    result.append(limits);
    result.classList.remove("hidden");
    status.textContent = "";
    button.textContent = "Giải thích lại";
  } catch (error) {
    renderAiError(error);
    button.textContent = "Thử lại";
  } finally {
    button.disabled = false;
  }
});
$("#report").addEventListener("click", async () => {
  const type = $("#report-type").value;
  const dialog = $("#report-confirm-dialog");
  $("#report-confirm-url").textContent = currentUrl;
  $("#report-confirm-type").textContent = type;
  dialog.returnValue = "cancel";
  dialog.showModal();
  const approved = await new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "approve"), { once: true }));
  if (!approved) return;
  const button = $("#report"); button.disabled = true; button.textContent = "Đang gửi…";
  try {
    const response = await fetch(`${API_BASE}/api/reports`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl, type, source: "extension" }),
      credentials: "omit", cache: "no-store", redirect: "error"
    });
    let data = {};
    try { data = await response.json(); } catch { /* Use a friendly message below. */ }
    if (!response.ok) throw new Error("report_failed");
    button.disabled = true;
    button.textContent = "Đã gửi báo cáo";
    $("#report-status").textContent = "Đã gửi để nhóm PhishLens xem xét. Báo cáo chưa phải kết luận xác minh.";
  } catch {
    button.disabled = false; button.textContent = "Thử gửi lại";
    $("#report-status").textContent = "Chưa gửi được báo cáo. Hãy kiểm tra kết nối rồi thử lại.";
  }
});

init();
