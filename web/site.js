import { stories } from "./stories.js";
import { lookupPublicThreatData } from "./lookup-analysis.js";

const $ = (selector) => document.querySelector(selector);
const types = ["Giả mạo ngân hàng/tổ chức", "Lừa lấy mật khẩu hoặc OTP", "Giả mạo cơ quan/dịch vụ công", "Tuyển dụng/việc làm giả", "Quà tặng/khuyến mãi", "Đầu tư/vay đáng ngờ", "Liên kết rút gọn/website/tệp lạ", "Khác"];
const progressFill = document.querySelector(".page-progress span");
if (progressFill) {
  let progressQueued = false;
  const updateProgress = () => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    progressFill.style.transform = `scaleX(${range > 0 ? Math.min(1, window.scrollY / range) : 1})`;
    progressQueued = false;
  };
  window.addEventListener("scroll", () => {
    if (progressQueued) return;
    progressQueued = true;
    window.requestAnimationFrame(updateProgress);
  }, { passive: true });
  updateProgress();
}
const storyRoot = document.querySelector("#story-grid");
for (const [index, story] of stories.entries()) {
  const article = document.createElement("article"); article.className = `story-card story-${story.id}`;
  const art = document.createElement("div"); art.className = "story-art";
  const image = document.createElement("img"); image.src = story.art; image.alt = story.alt; image.width = 560; image.height = 300; image.loading = "lazy";
  art.append(image);
  const body = document.createElement("div"); body.className = "story-body";
  const eyebrow = document.createElement("p"); eyebrow.className = "story-category"; eyebrow.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span> ${story.category}`;
  const badge = document.createElement("span"); badge.className = "fiction-label"; badge.textContent = "Tình huống minh họa";
  const title = document.createElement("h3"); title.textContent = story.title;
  const setup = document.createElement("p"); setup.className = "story-text"; setup.textContent = story.setup;
  const turning = document.createElement("p"); turning.className = "story-turn"; turning.innerHTML = `<b>Dấu hiệu để dừng lại</b>`;
  const turningCopy = document.createElement("span"); turningCopy.textContent = story.turningPoint; turning.append(turningCopy);
  const takeaway = document.createElement("p"); takeaway.className = "story-takeaway"; takeaway.innerHTML = `<b>Thử chọn bước an toàn</b>`;
  const action = document.createElement("span"); action.textContent = `${story.takeaway} ${story.action}`; takeaway.append(action);
  const source = document.createElement("a"); source.className = "story-source"; source.href = story.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = `Nguồn tham khảo: ${story.source} ↗`;
  body.append(eyebrow, badge, title, setup, turning, takeaway, source);
  article.append(art, body); storyRoot.append(article);
}

// Progressive enhancement: reveal content on scroll only when motion is allowed
// and IntersectionObserver is available. Without it, the page stays fully visible.
if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches && "IntersectionObserver" in window) {
  const revealTargets = document.querySelectorAll(
    ".hero-copy, .hero-art-wrap, .hero-bottom, .extension-copy, .extension-visual, .tools-section .section-topline, .tool-card, .stories-heading, .story-card, .story-bottom-note, .why-section, .report-secondary"
  );
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -32px 0px" });
  revealTargets.forEach((element) => {
    element.classList.add("reveal-on-scroll");
    revealObserver.observe(element);
  });
  document.body.classList.add("motion-ready");
}

const typeSelect = document.querySelector('select[name="type"]');
typeSelect.add(new Option("Chọn hình thức nghi ngờ", "", true, true)); typeSelect.options[0].disabled = true;
types.forEach((type) => typeSelect.add(new Option(type, type)));

document.querySelector("#lookup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#lookup-input").value.trim();
  const result = document.querySelector("#lookup-result");
  result.className = "lookup-result"; result.textContent = "Đang kiểm tra dữ liệu PhishLens và các danh sách công khai…";
  try {
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    let parsed;
    try { parsed = new URL(candidate); } catch { throw new Error("invalid_address"); }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error("invalid_address");
    const [lookupResult, publicThreats] = await Promise.allSettled([
      fetch(`/api/lookup?url=${encodeURIComponent(parsed.origin)}`),
      lookupPublicThreatData(parsed.hostname.toLowerCase().replace(/\.$/, ""))
    ]);
    let data = { status: "Chưa có dữ liệu", message: "Chưa tra cứu được kho cảnh báo PhishLens đã xác minh." };
    let lookupUnavailable = lookupResult.status !== "fulfilled";
    if (!lookupUnavailable) {
      try {
        const response = lookupResult.value;
        data = await response.json();
        if (!response.ok) lookupUnavailable = true;
      } catch { lookupUnavailable = true; }
    }
    const threats = publicThreats.status === "fulfilled" ? publicThreats.value : {
      phishingStatus: "unavailable", phishingMatch: false, vietnamStatus: "unavailable", vietnamMatches: []
    };
    result.replaceChildren();
    const foundPublicThreat = threats.phishingMatch || threats.vietnamMatches.length > 0;
    const icon = document.createElement("div"); icon.className = "empty-mark"; icon.textContent = data.status === "Đã được xác minh" || foundPublicThreat ? "!" : data.status === "Đang xem xét" ? "…" : "⌕";
    const content = document.createElement("div");
    const heading = document.createElement("b"); heading.textContent = data.status === "Đã được xác minh" ? "Cảnh báo PhishLens đã xác minh" : foundPublicThreat ? "Tìm thấy cảnh báo trong danh sách công khai" : data.status; content.append(heading);
    if (data.item) {
      const checkedAt = data.item.updatedAt ? new Date(data.item.updatedAt).toLocaleDateString("vi-VN") : "chưa rõ";
      const p = document.createElement("p"); p.textContent = `${data.item.demo ? "Tình huống minh họa · " : ""}${data.item.hostname} · ${data.item.type}. ${data.item.summary} Trạng thái: ${data.item.status}; cập nhật ${checkedAt}.`; content.append(p);
      if (data.item.sourceUrl) { const link = document.createElement("a"); link.href = data.item.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Mở nguồn đã được quản trị viên đối chiếu ↗"; content.append(link); }
      if (!data.item.demo) { const note = document.createElement("small"); note.textContent = `Nguồn đăng: ${data.item.source}. Cảnh báo áp dụng cho tên miền được ghi nhận; không có nghĩa mọi trang trên đó đều lừa đảo.`; content.append(note); }
    }
    else if (data.status === "Đang xem xét") { const p = document.createElement("p"); p.textContent = data.message; content.append(p); }
    if (threats.phishingMatch) {
      const p = document.createElement("p"); p.textContent = "Tên miền khớp feed phishing ACTIVE của Phishing.Database. Đây là tín hiệu từ danh sách công khai, không phải xác minh độc lập rằng website hiện vẫn độc hại."; content.append(p);
      const link = document.createElement("a"); link.href = "https://github.com/Phishing-Database/Phishing.Database"; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Nguồn: Phishing.Database ↗"; content.append(link);
    }
    for (const record of threats.vietnamMatches) {
      const p = document.createElement("p");
      const reportDate = record.reportedAt ? new Date(`${record.reportedAt}T00:00:00Z`).toLocaleDateString("vi-VN") : "không rõ ngày";
      p.textContent = record.kind === "impersonation"
        ? `${record.historical ? "Báo cáo lịch sử" : "Báo cáo giả mạo"}: tên miền từng được ${record.sourceName} nêu liên quan đến ${record.target || "một tổ chức"} (${reportDate}).${record.historical ? " Báo cáo đã quá 12 tháng nên chỉ dùng làm thông tin tham khảo." : " Đây là cảnh báo theo báo cáo, không khẳng định website hiện vẫn hoạt động."}`
        : `Danh sách ${record.sourceName} nêu tên miền này trong nhóm website cờ bạc/vi phạm (${reportDate}); đây là nhóm cảnh báo riêng, không phải kết luận phishing.`;
      content.append(p);
      if (record.sourceUrl) { const link = document.createElement("a"); link.href = record.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = `Nguồn: ${record.sourceName} ↗`; content.append(link); }
    }
    if (!data.item && data.status !== "Đang xem xét" && !foundPublicThreat) {
      const p = document.createElement("p");
      p.textContent = threats.phishingStatus === "available" && threats.vietnamStatus === "available" && !lookupUnavailable
        ? "Không tìm thấy cảnh báo đã xác minh hoặc mục khớp trong các danh sách đang tra cứu. Điều này không chứng minh website an toàn."
        : "Chưa tìm thấy cảnh báo trong dữ liệu hiện có; một số danh sách công khai chưa tải được. Điều này không chứng minh website an toàn.";
      content.append(p);
    }
    if (lookupUnavailable || threats.phishingStatus !== "available" || threats.vietnamStatus !== "available") {
      const note = document.createElement("small"); note.textContent = "Một phần danh sách công khai chưa tải được; kết quả PhishLens đã xác minh vẫn được giữ nguyên."; content.append(note);
    }
    const method = document.createElement("small"); method.textContent = "Extension còn kiểm tra cấu trúc URL ngay trên thiết bị; trang tra cứu này đối chiếu cảnh báo và danh sách công khai theo hostname."; content.append(method);
    result.append(icon, content);
    result.classList.add(data.status === "Đã được xác minh" ? "state-verified" : data.status === "Đang xem xét" ? "state-review" : foundPublicThreat ? "state-feed" : "state-none");
  } catch (error) { result.textContent = error.message === "invalid_address" ? "Hãy nhập tên miền hoặc địa chỉ website hợp lệ." : "Chưa tra cứu được lúc này. Hãy kiểm tra kết nối và thử lại."; }
});

const reportForm = document.querySelector("#report-form");
const reportDialog = document.querySelector("#report-confirm-dialog");
let pendingReport = null;

reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  pendingReport = Object.fromEntries(new FormData(reportForm));
  if (!pendingReport.consent) return;
  $("#confirm-url").textContent = pendingReport.url;
  $("#confirm-type").textContent = pendingReport.type;
  $("#confirm-description").textContent = pendingReport.description || "Không có mô tả.";
  reportDialog.showModal();
});

$("#cancel-report").addEventListener("click", () => { pendingReport = null; reportDialog.close(); });
$("#confirm-report").addEventListener("click", async () => {
  if (!pendingReport) return;
  const status = reportForm.querySelector(".form-status");
  const button = $("#confirm-report");
  button.disabled = true; status.className = "form-status"; status.textContent = "Đang gửi báo cáo…";
  try {
    const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: pendingReport.url, type: pendingReport.type, description: pendingReport.description, source: "website", website: pendingReport.website }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Không gửi được.");
    reportDialog.close(); status.textContent = `${result.message} Mã tiếp nhận: ${String(result.id).slice(0, 8)}.`; reportForm.reset(); pendingReport = null;
  } catch { status.classList.add("error"); status.textContent = "Chưa gửi được báo cáo. Hãy kiểm tra kết nối rồi thử lại."; }
  finally { button.disabled = false; }
});
