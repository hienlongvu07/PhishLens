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
  sample_blocklist: "Khớp danh sách demo", http: "Kết nối HTTP", suspicious_port: "Cổng không thường gặp", shortener: "Dịch vụ rút gọn liên kết",
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
  const contentType = response.headers.get("content-type") || "không có Content-Type";
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    const missingRoute = response.status === 404 || response.status === 410;
    throw Object.assign(new Error(missingRoute
      ? "API AI chưa có trong bản deploy hiện tại. Hãy deploy lại phiên bản mới nhất trên Vercel."
      : "Máy chủ trả về phản hồi không đúng định dạng. Hãy thử lại sau."), {
      technical: `HTTP ${response.status}; Content-Type: ${contentType}; phản hồi không phải JSON`
    });
  }
  if (!response.ok) {
    const messages = {
      AI_NOT_CONFIGURED: "AI chưa được cấu hình trên máy chủ.",
      AI_MODEL_INVALID: "Tên model Gemini trên máy chủ không hợp lệ.",
      GEMINI_RATE_LIMITED: "Gemini đang giới hạn yêu cầu. Hãy thử lại sau.",
      GEMINI_UNAVAILABLE: "Gemini đang quá tải tạm thời. Hãy chờ một chút rồi thử lại.",
      GEMINI_AUTH_FAILED: "Gemini từ chối API key. Kiểm tra cấu hình trên Vercel.",
      GEMINI_MODEL_NOT_FOUND: "Không tìm thấy model Gemini đã cấu hình.",
      GEMINI_REQUEST_INVALID: "Gemini từ chối yêu cầu. Mở chi tiết kỹ thuật để xem lý do.",
      AI_TIMEOUT: "Gemini phản hồi quá thời gian chờ.",
      AI_INVALID_OUTPUT: "Gemini trả về kết quả không đọc được. Hãy thử lại.",
      AI_SERVICE_ERROR: "Dịch vụ AI đang gặp lỗi. Kết quả kiểm tra cục bộ vẫn còn."
    };
    const code = typeof data.code === "string" ? data.code : "";
    const fallback = response.status === 429 ? "Dịch vụ AI đang bận. Hãy thử lại sau."
      : response.status === 404 ? "API AI chưa có trong bản deploy hiện tại. Hãy deploy lại trên Vercel."
        : response.status === 503 ? "Dịch vụ AI chưa sẵn sàng. Kiểm tra cấu hình Vercel."
          : "Chưa thể phân tích bằng AI. Kết quả kiểm tra cục bộ vẫn còn.";
    throw Object.assign(new Error(messages[code] || fallback), {
      technical: `HTTP ${response.status}${code ? `; ${code}` : ""}${data.providerStatus ? `; Gemini ${String(data.providerStatus).slice(0, 80)}` : ""}${data.providerMessage ? `; ${String(data.providerMessage).slice(0, 240)}` : ""}${data.error ? `; ${String(data.error).slice(0, 120)}` : ""}`
    });
  }
  if (!data?.ai || typeof data.ai.summary !== "string" || !Array.isArray(data.ai.evidence) || !Array.isArray(data.ai.nextSteps)) {
    throw Object.assign(new Error("Máy chủ AI trả về kết quả thiếu dữ liệu. Hãy thử lại sau."), {
      technical: `HTTP ${response.status}; JSON không đúng cấu trúc AI đã yêu cầu`
    });
  }
  return data;
}

function clearAiError() {
  $("#ai-error-details").classList.add("hidden");
  $("#ai-error-details").open = false;
  $("#ai-error-technical").textContent = "";
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentUrl = tab?.url || "";
  const result = analyzeUrl(currentUrl);
  currentAnalysis = result;
  $("#domain").textContent = result.valid ? result.hostname : (currentUrl || result.hostname);
  $("#level").textContent = result.level;
  $("#level").className = `level ${result.band === "high" ? "risk" : result.band === "caution" ? "caution" : "clear"}`;
  $("#summary").textContent = result.valid ? `${result.findings.length} dấu hiệu cần xem xét · phân tích trong trình duyệt` : "Mở một website bắt đầu bằng http:// hoặc https:// để PhishLens phân tích. Các trang chrome://, edge:// và trang tiện ích bị trình duyệt giới hạn.";
  $("#finding-count").textContent = String(result.findings.length);
  renderList($("#findings"), result.findings);
  $("#no-findings").classList.toggle("hidden", result.findings.length > 0 || !result.valid);
  renderParts(result.parts);
  renderScore(result);
  $("#report").disabled = !result.valid;
  $("#ai-analyze").disabled = !result.valid;
  $("#ai-consent-note").textContent = result.valid
    ? "Chỉ gửi hostname và dấu hiệu tới PhishLens sau khi bạn xác nhận."
    : "AI chỉ hoạt động trên trang HTTP(S). Hãy mở một website rồi bấm biểu tượng PhishLens; Chrome/Edge không cho extension đọc trang hệ thống.";
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
  const approved = window.confirm(`PHÂN TÍCH VỚI AI\n\nGửi hostname và mã dấu hiệu tới PhishLens (${API_BASE}); máy chủ chuyển chúng tới Google Gemini.\n\nHostname: ${hostname}\nDấu hiệu: ${signalCodes.length ? signalCodes.join(", ") : "không có"}\n\nKhông gửi đường dẫn, query, fragment, thông tin đăng nhập, cookie hay nội dung trang. Với Gemini API free tier, Google có thể dùng dữ liệu để cải thiện sản phẩm. AI chỉ giải thích, không quyết định điểm. Tiếp tục?`);
  if (!approved) return;

  const button = $("#ai-analyze");
  const status = $("#ai-status");
  button.disabled = true;
  button.textContent = "Đang phân tích…";
  status.textContent = "Đang gửi hostname và mã dấu hiệu đã trích xuất.";
  status.classList.remove("is-error");
  clearAiError();
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
    clearAiError();
    status.textContent = "AI đã giải thích tín hiệu; đây không phải xác minh website.";
    button.textContent = "Phân tích lại bằng AI";
  } catch (error) {
    if (!error.technical) {
      const networkFailure = error.name === "TypeError";
      error.message = networkFailure
        ? "Không kết nối được API PhishLens. Kiểm tra mạng hoặc domain cấu hình trong extension."
        : "Chưa thể phân tích bằng AI. Kết quả cục bộ vẫn còn; bạn có thể thử lại.";
      error.technical = `${error.name || "Error"}: yêu cầu không hoàn tất`;
    }
    status.textContent = error.message;
    status.classList.add("is-error");
    if (error.technical) {
      $("#ai-error-technical").textContent = error.technical;
      $("#ai-error-details").classList.remove("hidden");
    }
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
