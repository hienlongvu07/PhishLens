const $ = (selector) => document.querySelector(selector);
let session = null;
let activePage = 1;

async function request(path, options = {}, authenticated = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authenticated && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let response = await fetch(path, { ...options, headers, cache: "no-store" });
  let data = response.status === 204 ? {} : await response.json();
  if (response.status === 401 && authenticated && session?.refresh_token && path !== "/api/admin/refresh") {
    const refresh = await fetch("/api/admin/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
    const refreshed = await refresh.json();
    if (refresh.ok) {
      session = refreshed.session;
      headers.Authorization = `Bearer ${session.access_token}`;
      response = await fetch(path, { ...options, headers, cache: "no-store" });
      data = response.status === 204 ? {} : await response.json();
    } else {
      session = null;
      throw new Error("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.");
    }
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function text(tag, value, className) {
  const node = document.createElement(tag); node.textContent = value ?? "";
  if (className) node.className = className;
  return node;
}

function showDashboard() {
  $("#login-view").classList.add("hidden"); $("#dashboard").classList.remove("hidden"); load(1);
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = event.currentTarget.querySelector(".form-status");
  const form = new FormData(event.currentTarget);
  try {
    const data = await request("/api/admin/login", {
      method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    }, false);
    session = data.session; showDashboard();
  } catch (error) { status.textContent = error.message; }
});

async function load(page = activePage) {
  activePage = page;
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, selector] of [["q", "#search"], ["status", "#filter-status"], ["type", "#filter-type"], ["from", "#filter-from"], ["to", "#filter-to"]]) {
    const value = $(selector).value; if (value) params.set(key, value);
  }
  try {
    const data = await request(`/api/admin/reports?${params}`);
    renderStats(data.stats); renderRows(data.reports);
    for (const value of data.statuses) if (![...$("#filter-status").options].some((o) => o.value === value)) $("#filter-status").add(new Option(value, value));
    for (const value of data.types) if (![...$("#filter-type").options].some((o) => o.value === value)) $("#filter-type").add(new Option(value, value));
    const pages = Math.max(1, Math.ceil(data.count / data.pageSize));
    $("#page-label").textContent = `Trang ${data.page} / ${pages} · ${data.count} báo cáo`;
    $("#previous-page").disabled = data.page <= 1;
    $("#next-page").disabled = data.page >= pages;
  } catch (error) {
    session = null; $("#login-view").classList.remove("hidden"); $("#dashboard").classList.add("hidden");
    $("#login-form .form-status").textContent = error.message;
  }
}

function renderStats(stats) {
  const items = [["Tổng báo cáo", stats.total], ...Object.entries(stats.byStatus)];
  $("#stats").replaceChildren(...items.map(([label, value]) => {
    const card = document.createElement("div"); card.className = "stat-card"; card.append(text("b", value), text("span", label)); return card;
  }));
  $("#type-stats").replaceChildren(...Object.entries(stats.byType).map(([label, value]) => {
    const card = document.createElement("div"); card.className = "type-stat"; card.append(text("b", value), text("span", label)); return card;
  }));
}

function renderRows(reports) {
  const body = $("#report-rows"); body.replaceChildren(); $("#empty").classList.toggle("hidden", reports.length > 0);
  for (const report of reports) {
    const tr = document.createElement("tr"); const urlCell = document.createElement("td");
    const link = text("a", report.hostname || report.url); link.href = "/"; link.title = "URL đầy đủ sẽ hiển thị trong Chi tiết";
    urlCell.append(link, text("span", new Date(report.createdAt).toLocaleString("vi-VN"), "cell-sub"));
    const typeCell = text("td", report.type); const statusCell = document.createElement("td");
    const badge = text("span", report.status, `badge ${report.status === "Đã xác minh" ? "verified" : report.status === "Đang xem xét" ? "review" : report.status === "Không đủ căn cứ" ? "rejected" : ""}`);
    statusCell.append(badge);
    const actionCell = document.createElement("td"); const button = text("button", "Chi tiết", "row-action"); button.type = "button"; button.addEventListener("click", () => openDetail(report)); actionCell.append(button);
    tr.append(urlCell, typeCell, statusCell, actionCell); body.append(tr);
  }
}

function openDetail(report) {
  const root = $("#detail-content"); root.replaceChildren();
  root.append(text("p", "BÁO CÁO CỘNG ĐỒNG", "eyebrow"), text("h2", report.hostname || "Chi tiết báo cáo", "detail-title"));
  for (const [label, value] of [["URL đầy đủ", report.url], ["Loại nghi ngờ", report.type], ["Mô tả", report.description || "Người gửi không thêm mô tả."], ["Tiếp nhận", new Date(report.createdAt).toLocaleString("vi-VN")], ["Trạng thái hiện tại", report.status], ["Nguồn gửi", report.source || "website"], ["Ghi chú quản trị", report.reviewNote || "Chưa có"]]) {
    const block = document.createElement("div"); block.className = "detail-block"; block.append(text("b", `${label}: `), document.createTextNode(value)); root.append(block);
  }
  const actions = document.createElement("div"); actions.className = "detail-actions";
  const statusLabel = text("label", "Cập nhật trạng thái"); const select = document.createElement("select");
  ["Mới", "Đang xem xét", "Đã xác minh", "Không đủ căn cứ"].forEach((value) => select.add(new Option(value, value, false, value === report.status)));
  statusLabel.append(select);
  const noteLabel = text("label", "Ghi chú quản trị"); const note = document.createElement("textarea"); note.maxLength = 500; note.value = report.reviewNote || ""; note.placeholder = "Cơ sở xem xét, nguồn đã đối chiếu…"; noteLabel.append(note);
  const summaryLabel = text("label", "Tóm tắt công khai khi xác minh"); const summary = document.createElement("textarea"); summary.maxLength = 500; summary.minLength = 20; summary.value = report.publicSummary || ""; summary.placeholder = "Nêu rõ thông tin được nguồn công khai hỗ trợ, không khẳng định mọi đường dẫn trên tên miền đều lừa đảo."; summaryLabel.append(summary);
  const sourceLabel = text("label", "Nguồn công khai (HTTPS)"); const source = document.createElement("input"); source.type = "url"; source.maxLength = 2048; source.value = report.sourceUrl || ""; source.placeholder = "https://to-chuc-chinh-thuc.example/canh-bao"; sourceLabel.append(source);
  const save = text("button", "Lưu trạng thái", "button"); save.type = "button";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await request(`/api/admin/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: select.value, reviewNote: note.value, publicSummary: summary.value, sourceUrl: source.value }) });
      $("#detail-dialog").close(); await load(activePage);
    } catch (error) { save.disabled = false; window.alert(error.message); }
  });
  actions.append(statusLabel, noteLabel, summaryLabel, sourceLabel, save, text("p", "Khi xác minh, cần tóm tắt ít nhất 20 ký tự và nguồn HTTPS. Công khai hostname, tóm tắt, loại báo cáo và nguồn; URL đầy đủ, query, mô tả và ghi chú quản trị vẫn ở riêng trong dashboard.", "form-status"));
  root.append(actions); $("#detail-dialog").showModal();
}

let timer;
for (const selector of ["#search", "#filter-status", "#filter-type", "#filter-from", "#filter-to"]) {
  $(selector).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => load(1), 250); });
}
$("#previous-page").addEventListener("click", () => { if (activePage > 1) load(activePage - 1); });
$("#next-page").addEventListener("click", () => load(activePage + 1));
$("#logout").addEventListener("click", async () => {
  try { await request("/api/admin/logout", { method: "POST", body: JSON.stringify({ refresh_token: session?.refresh_token }) }); }
  finally { session = null; window.location.reload(); }
});
