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

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentUrl = tab?.url || "";
  const result = analyzeUrl(currentUrl);
  currentAnalysis = result;
  $("#domain").textContent = currentUrl || result.hostname;
  $("#level").textContent = result.level;
  $("#level").className = `level ${result.level === "Có dấu hiệu đáng ngờ" ? "risk" : result.level === "Cần kiểm tra thêm" ? "caution" : "clear"}`;
  $("#summary").textContent = result.valid ? `${result.findings.length} dấu hiệu cần xem xét · phân tích trong trình duyệt` : "Trang hệ thống của trình duyệt không được phân tích.";
  $("#finding-count").textContent = String(result.findings.length);
  renderList($("#findings"), result.findings);
  $("#no-findings").classList.toggle("hidden", result.findings.length > 0 || !result.valid);
  renderParts(result.parts);
  $("#report").disabled = !result.valid;
  $("#ai-analyze").disabled = !result.valid;
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

$("#ai-analyze").addEventListener("click", async () => {
  if (!currentAnalysis?.valid) return;
  const hostname = currentAnalysis.canonicalHostname;
  const signalCodes = [...new Set(currentAnalysis.signals.map(({ code }) => code))];
  const approved = window.confirm(`GỬI PHÂN TÍCH TÙY CHỌN\n\nSẽ gửi tới PhishLens tại ${API_BASE}; máy chủ chuyển hostname và mã dấu hiệu tới Google Gemini để tạo lời giải thích.\n\nHostname: ${hostname}\nMã dấu hiệu: ${signalCodes.length ? signalCodes.join(", ") : "không có"}\n\nKhông gửi URL đầy đủ, đường dẫn, query, fragment, cookie, thông tin đăng nhập hoặc nội dung trang. Nếu PhishLens đang dùng Gemini API free tier, Google có thể dùng prompt và phản hồi để cải thiện sản phẩm. AI chỉ giải thích; trạng thái vẫn dựa trên quy tắc và cảnh báo đã xác minh. Tiếp tục?`);
  if (!approved) return;

  const button = $("#ai-analyze");
  const status = $("#ai-status");
  button.disabled = true;
  button.textContent = "Đang phân tích…";
  status.textContent = "Đang gửi hostname và mã dấu hiệu đã trích xuất.";
  $("#ai-result").classList.add("hidden");
  $("#community-result").classList.add("hidden");
  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, signalCodes }),
      credentials: "omit", cache: "no-store", redirect: "error"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const community = $("#community-result");
    if (data.community?.status === "verified") {
      const label = document.createElement("b"); label.textContent = `Dữ liệu PhishLens · Đã xác minh${data.community.demo ? " (demo)" : ""}`;
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
    const heading = document.createElement("b"); heading.textContent = "Giải thích AI";
    const summary = document.createElement("p"); summary.textContent = data.ai.summary;
    result.append(heading, summary);
    for (const [title, values] of [["Bằng chứng được đưa vào", data.ai.evidence], ["Bạn có thể làm gì", data.ai.nextSteps]]) {
      if (!values?.length) continue;
      const label = document.createElement("b"); label.textContent = title;
      const list = document.createElement("ul");
      for (const value of values) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
      result.append(label, list);
    }
    const limits = document.createElement("p"); limits.className = "ai-limitation"; limits.textContent = `Giới hạn: ${data.ai.limitations} Trạng thái vẫn do quy tắc và dữ liệu PhishLens quyết định.`;
    result.append(limits);
    result.classList.remove("hidden");
    status.textContent = "Đã nhận phần giải thích bổ sung. Đây không phải kết luận website an toàn hay lừa đảo.";
    button.textContent = "Phân tích lại bằng AI";
  } catch (error) {
    status.textContent = `Chưa lấy được giải thích AI (${error.message}). Kết quả quy tắc trên thiết bị vẫn còn; bạn có thể thử lại.`;
    button.textContent = "Thử lại phân tích AI";
  } finally {
    button.disabled = false;
  }
});
$("#report").addEventListener("click", async () => {
  const type = $("#report-type").value;
  const approved = window.confirm(`XEM LẠI TRƯỚC KHI GỬI\n\nURL ĐẦY ĐỦ (gồm query và fragment):\n${currentUrl}\n\nLoại nghi ngờ: ${type}\nNơi nhận: ${API_BASE}\n\nQuery có thể chứa mã phiên hoặc thông tin riêng tư. Chỉ tiếp tục nếu bạn đã kiểm tra URL và muốn chia sẻ đầy đủ với nhóm PhishLens. Extension không gửi mật khẩu, OTP, cookie hay nội dung trang.`);
  if (!approved) return;
  const button = $("#report"); button.disabled = true; button.textContent = "Đang gửi…";
  try {
    const response = await fetch(`${API_BASE}/api/reports`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl, type, source: "extension" }),
      credentials: "omit", cache: "no-store", redirect: "error"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    button.textContent = "Đã gửi báo cáo";
    $("#report-status").textContent = `Đã tiếp nhận để xem xét · Mã ${String(data.id).slice(0, 8)}. Chưa phải xác minh.`;
  } catch (error) {
    button.disabled = false; button.textContent = "Thử gửi lại";
    $("#report-status").textContent = `Chưa gửi được (${error.message}). Kiểm tra kết nối tới PhishLens rồi thử lại.`;
  }
});

init();
