import { analyzeUrl } from "./src/analyzer.js";

const $ = (selector) => document.querySelector(selector);
const API_BASE = chrome.runtime.getManifest().host_permissions[0].replace(/\/\*$/, "");
let currentUrl = "";
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
  $("#domain").textContent = currentUrl || result.hostname;
  $("#level").textContent = result.level;
  $("#level").className = `level ${result.level === "Có dấu hiệu đáng ngờ" ? "risk" : result.level === "Cần kiểm tra thêm" ? "caution" : "clear"}`;
  $("#summary").textContent = result.valid ? `${result.findings.length} dấu hiệu cần xem xét · phân tích trong trình duyệt` : "Trang hệ thống của trình duyệt không được phân tích.";
  $("#finding-count").textContent = String(result.findings.length);
  renderList($("#findings"), result.findings);
  $("#no-findings").classList.toggle("hidden", result.findings.length > 0 || !result.valid);
  renderParts(result.parts);
  $("#report").disabled = !result.valid;
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
