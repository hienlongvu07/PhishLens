import { analyzeUrl } from "./src/analyzer.js";

const $ = (selector) => document.querySelector(selector);
const API_BASE = chrome.runtime.getManifest().host_permissions[0].replace(/\/\*$/, "");
let currentUrl = "";
let currentAnalysis = null;
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
  credentials_at: "Có dấu @ hoặc thông tin trước @", unicode_or_punycode: "Ký tự Unicode/punycode", lookalike_brand: "Tên gần giống thương hiệu mẫu", ip_address: "Dùng địa chỉ IP",
  sample_blocklist: "Khớp danh sách ví dụ của PhishLens", http: "Kết nối HTTP", suspicious_port: "Cổng không thường gặp", shortener: "Dịch vụ rút gọn liên kết",
  many_subdomains: "Tên miền có nhiều cấp", long_hostname: "Tên miền dài", encoded_path: "Đường dẫn có ký tự mã hóa", hyphenated_hostname: "Tên miền có gạch nối", suspicious_keyword: "Có từ khóa cần chú ý"
};

function renderScore(result) {
  const card = $("#risk-score-card");
  if (!result.valid) { card.classList.add("hidden"); $("#score-breakdown").classList.add("hidden"); return; }
  card.classList.remove("hidden");
  $("#risk-score").textContent = String(result.riskScore);
  const track = $(".score-track");
  track.setAttribute("aria-valuenow", String(result.riskScore));
  $("#score-fill").style.width = `${result.riskScore}%`;
  card.dataset.band = result.band;
  const breakdown = $("#score-breakdown");
  breakdown.replaceChildren();
  if (!result.scoreBreakdown.length) { breakdown.classList.add("hidden"); return; }
  const title = document.createElement("b"); title.textContent = "Điểm đóng góp theo dấu hiệu";
  const list = document.createElement("ul");
  for (const item of result.scoreBreakdown) {
    const row = document.createElement("li");
    const label = document.createElement("span"); label.textContent = SIGNAL_LABELS[item.code] || item.code;
    const points = document.createElement("b"); points.textContent = `+${item.points}`;
    row.append(label, points); list.append(row);
  }
  breakdown.append(title, list); breakdown.classList.remove("hidden");
}

async function readAiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok || !data) throw new Error("unavailable");
  if (!data?.ai || typeof data.ai.summary !== "string" || !Array.isArray(data.ai.evidence) || !Array.isArray(data.ai.nextSteps)) {
    throw new Error("unavailable");
  }
  return data;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentUrl = tab?.url || "";
  const result = analyzeUrl(currentUrl);
  currentAnalysis = result;
  $("#domain").textContent = result.valid ? result.hostname : "Trang này chưa hỗ trợ kiểm tra";
  $("#level").textContent = result.level;
  $("#level").className = `level ${result.band === "high" ? "risk" : result.band === "caution" ? "caution" : "clear"}`;
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
  const signalCodes = [...new Set(currentAnalysis.signals.map(({ code }) => code))];
  const approved = await requestAiConsent(hostname);
  if (!approved) return;

  const button = $("#ai-analyze");
  const status = $("#ai-status");
  button.disabled = true;
  button.textContent = "Đang phân tích…";
  status.textContent = "Đang chuẩn bị phần giải thích…";
  status.classList.remove("is-error");
  $("#ai-result").classList.add("hidden");
  $("#community-result").classList.add("hidden");
  try {
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
      if (data.community.sourceUrl) {
        const source = document.createElement("a"); source.href = data.community.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = `Nguồn: ${data.community.source || "nguồn đã duyệt"}`;
        community.append(source);
      }
      community.classList.remove("hidden");
    }
    const result = $("#ai-result");
    result.replaceChildren();
    const heading = document.createElement("b"); heading.textContent = "Giải thích thêm";
    const summary = document.createElement("p"); summary.textContent = data.ai.summary;
    result.append(heading, summary);
    for (const [title, values] of [["Dấu hiệu được xem xét", data.ai.evidence], ["Bạn có thể làm gì", data.ai.nextSteps]]) {
      if (!values?.length) continue;
      const label = document.createElement("b"); label.textContent = title;
      const list = document.createElement("ul");
      for (const value of values) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
      result.append(label, list);
    }
    const limits = document.createElement("p"); limits.className = "ai-limitation"; limits.textContent = `Lưu ý: ${data.ai.limitations} Điểm rủi ro phía trên không thay đổi.`;
    result.append(limits);
    result.classList.remove("hidden");
    status.textContent = "Phần giải thích chỉ để tham khảo; hãy tự xác minh qua kênh chính thức.";
    button.textContent = "Xem giải thích lại";
  } catch {
    status.textContent = "Chưa lấy được phần giải thích lúc này. Kết quả kiểm tra vẫn còn; bạn có thể thử lại sau.";
    status.classList.add("is-error");
    button.textContent = "Thử lại phần giải thích";
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
