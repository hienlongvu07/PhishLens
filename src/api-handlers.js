import { REPORT_STATUSES, REPORT_TYPES } from "./api-constants.js";
import { adminSupabase, allowedAdminEmails, publicSupabase } from "./supabase-clients.js";

const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function json(status, data) { return new Response(JSON.stringify(data), { status, headers: baseHeaders }); }
function fail(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error("PhishLens API error:", error);
  return json(status, { error: status >= 500 && status !== 503 ? "Có lỗi máy chủ. Vui lòng thử lại sau." : error.message });
}
async function readJson(request, limit = 12000) {
  const text = await request.text();
  if (text.length > limit) throw Object.assign(new Error("Nội dung gửi vượt giới hạn."), { status: 413 });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("JSON không hợp lệ."), { status: 400 }); }
}
function parseUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || value !== value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    return { parsed, original: value };
  } catch { return null; }
}
function hostnameFromLookup(value) {
  if (typeof value !== "string") return "";
  const parsed = parseUrl(value);
  const host = parsed?.parsed.hostname || value.trim().toLowerCase().replace(/^www\./, "");
  return host.replace(/\.$/, "").toLowerCase();
}
function getBearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function sessionPayload(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: { id: session.user.id, email: session.user.email }
  };
}
function publicAlert(row) {
  const evidenceUrl = parseUrl(row.source_url);
  return {
    hostname: row.hostname, url: row.url, type: row.type,
    summary: row.summary, sourceUrl: evidenceUrl?.parsed.protocol === "https:" ? evidenceUrl.original : "", status: row.status, source: row.source,
    updatedAt: row.updated_at, demo: Boolean(row.is_demo)
  };
}
function publicReport(row) {
  return {
    id: row.id, url: row.url, hostname: row.hostname, type: row.type,
    description: row.description, source: row.source, status: row.status,
    publicSummary: row.public_summary || "", sourceUrl: row.source_url || "",
    reviewNote: row.review_note, createdAt: row.created_at, updatedAt: row.updated_at,
    demo: false
  };
}
function adminEmailAllowed(email) { return Boolean(email) && allowedAdminEmails().has(email.toLowerCase()); }

async function getAdmin(request, makePublicClient = publicSupabase, isAllowedAdmin = adminEmailAllowed) {
  const token = getBearer(request);
  if (!token) throw Object.assign(new Error("Cần đăng nhập quản trị."), { status: 401 });
  const authClient = makePublicClient();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user || !isAllowedAdmin(data.user.email)) {
    throw Object.assign(new Error("Phiên quản trị không hợp lệ hoặc tài khoản chưa được cấp quyền."), { status: 401 });
  }
  return data.user;
}

export function createApiHandlers({ makePublicClient = publicSupabase, makeAdminClient = adminSupabase, isAllowedAdmin = adminEmailAllowed } = {}) {
  return {
    health: async () => json(200, { ok: true, name: "PhishLens" }),

    lookup: async (request) => {
      try {
        const target = hostnameFromLookup(new URL(request.url).searchParams.get("url") || "");
        if (!target || target.length > 253 || /[\s/@]/.test(target)) return json(400, { error: "Nhập URL hoặc tên miền hợp lệ." });
        const db = makeAdminClient();
        const { data: alert, error: alertError } = await db.from("verified_alerts").select("hostname,url,type,summary,source_url,status,source,updated_at,is_demo").eq("hostname", target).maybeSingle();
        if (alertError) throw alertError;
        if (alert) return json(200, { status: "Đã được xác minh", item: publicAlert(alert) });
        const { count, error: reportError } = await db.from("reports").select("id", { count: "exact", head: true }).eq("hostname", target).in("status", ["Mới", "Đang xem xét"]);
        if (reportError) throw reportError;
        if (count) return json(200, { status: "Đang xem xét", message: "Đã có báo cáo đang được nhóm xem xét. Đây chưa phải kết luận." });
        return json(200, { status: "Chưa có dữ liệu", message: "PhishLens chưa có dữ liệu đã xác minh cho tên miền này. Không thể suy ra rằng website an toàn." });
      } catch (error) { return fail(error); }
    },

    submitReport: async (request) => {
      try {
        const body = await readJson(request);
        // Honeypot for simple form bots. Netlify's per-IP function rate limit is the primary throttle.
        if (String(body.website || "").trim()) return json(201, { id: "received", status: "Mới", message: "Đã tiếp nhận báo cáo để xem xét, chưa phải xác minh." });
        const input = parseUrl(body.url);
        if (!input) return json(400, { error: "URL phải là HTTP(S), tối đa 2.048 ký tự và không chứa tên người dùng/mật khẩu." });
        if (!REPORT_TYPES.includes(body.type)) return json(400, { error: "Hãy chọn loại báo cáo hợp lệ." });
        const description = typeof body.description === "string" ? body.description.trim() : "";
        if (description.length > 1000) return json(400, { error: "Mô tả tối đa 1.000 ký tự." });
        const row = {
          url: input.original,
          hostname: input.parsed.hostname.toLowerCase().replace(/\.$/, ""),
          type: body.type,
          description,
          source: body.source === "extension" ? "extension" : "website"
        };
        const { data, error } = await makeAdminClient().from("reports").insert(row).select("id,status").single();
        if (error) throw error;
        return json(201, { id: data.id, status: data.status, message: "Đã tiếp nhận báo cáo để xem xét, chưa phải xác minh." });
      } catch (error) { return fail(error); }
    },

    adminLogin: async (request) => {
      try {
        const body = await readJson(request, 3000);
        if (typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 254 || body.password.length > 256) {
          return json(400, { error: "Nhập email và mật khẩu hợp lệ." });
        }
        if (!isAllowedAdmin(body.email)) return json(403, { error: "Email này chưa được cấp quyền quản trị." });
        const { data, error } = await makePublicClient().auth.signInWithPassword({ email: body.email.trim(), password: body.password });
        if (error || !data.session || !isAllowedAdmin(data.user?.email)) return json(401, { error: "Email hoặc mật khẩu chưa đúng." });
        return json(200, { session: sessionPayload(data.session) });
      } catch (error) { return fail(error); }
    },

    adminRefresh: async (request) => {
      try {
        const body = await readJson(request, 3000);
        if (typeof body.refresh_token !== "string" || body.refresh_token.length > 4096) return json(400, { error: "Phiên đăng nhập hết hạn. Hãy đăng nhập lại." });
        const { data, error } = await makePublicClient().auth.refreshSession({ refresh_token: body.refresh_token });
        if (error || !data.session || !isAllowedAdmin(data.user?.email)) return json(401, { error: "Phiên đăng nhập hết hạn. Hãy đăng nhập lại." });
        return json(200, { session: sessionPayload(data.session) });
      } catch (error) { return fail(error); }
    },

    adminLogout: async (request) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const body = await readJson(request, 3000);
        if (typeof body.refresh_token === "string") {
          const client = makePublicClient();
          await client.auth.setSession({ access_token: getBearer(request), refresh_token: body.refresh_token });
          await client.auth.signOut({ scope: "local" });
        }
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      } catch (error) { return fail(error); }
    },

    adminReports: async (request) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const url = new URL(request.url);
        const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
        const pageSize = 50;
        const q = (url.searchParams.get("q") || "").slice(0, 100).replace(/[^\p{L}\p{N} ._:/?=&@-]/gu, "").trim();
        const status = url.searchParams.get("status") || "";
        const type = url.searchParams.get("type") || "";
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        let query = makeAdminClient().from("reports").select("id,url,hostname,type,description,source,status,review_note,public_summary,source_url,created_at,updated_at", { count: "exact" });
        if (q) query = query.or(`url.ilike.%${q}%,hostname.ilike.%${q}%,description.ilike.%${q}%`);
        if (status && REPORT_STATUSES.includes(status)) query = query.eq("status", status);
        if (type && REPORT_TYPES.includes(type)) query = query.eq("type", type);
        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000Z`);
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999Z`);
        const [{ data: reports, count, error }, { data: stats, error: statsError }] = await Promise.all([
          query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
          makeAdminClient().rpc("admin_report_stats")
        ]);
        if (error) throw error;
        if (statsError) throw statsError;
        const byStatus = Object.fromEntries(REPORT_STATUSES.map((value) => [value, Number(stats?.byStatus?.[value] || 0)]));
        const byType = Object.fromEntries(REPORT_TYPES.map((value) => [value, Number(stats?.byType?.[value] || 0)]));
        return json(200, { reports: (reports || []).map(publicReport), count: count || 0, page, pageSize, stats: { total: Number(stats?.total || 0), byStatus, byType }, statuses: REPORT_STATUSES, types: REPORT_TYPES });
      } catch (error) { return fail(error); }
    },

    adminUpdateReport: async (request, context) => {
      try {
        const user = await getAdmin(request, makePublicClient, isAllowedAdmin);
        const reportId = context?.params?.id || new URL(request.url).pathname.split("/").at(-1);
        if (!/^[0-9a-f-]{36}$/i.test(reportId)) return json(400, { error: "Mã báo cáo không hợp lệ." });
        const body = await readJson(request, 3000);
        if (!REPORT_STATUSES.includes(body.status)) return json(400, { error: "Trạng thái không hợp lệ." });
        const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
        if (reviewNote.length > 500) return json(400, { error: "Ghi chú tối đa 500 ký tự." });
        const publicSummary = typeof body.publicSummary === "string" ? body.publicSummary.trim() : "";
        const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
        if (publicSummary.length > 500 || sourceUrl.length > 2048) return json(400, { error: "Tóm tắt tối đa 500 ký tự; URL nguồn tối đa 2.048 ký tự." });
        if (body.status === "Đã xác minh") {
          let source;
          try { source = new URL(sourceUrl); } catch { source = null; }
          if (publicSummary.length < 20 || !source || source.protocol !== "https:" || !source.hostname || source.username || source.password) {
            return json(400, { error: "Muốn công bố cảnh báo, hãy nhập tóm tắt tối thiểu 20 ký tự và URL nguồn HTTPS đã kiểm tra." });
          }
        }
        const { data, error } = await makeAdminClient().rpc("admin_update_report", {
          p_id: reportId, p_status: body.status, p_review_note: reviewNote,
          p_public_summary: publicSummary, p_source_url: sourceUrl, p_reviewed_by: user.id
        });
        if (error) throw error;
        if (!data) return json(404, { error: "Không tìm thấy báo cáo." });
        return json(200, { report: publicReport(data) });
      } catch (error) { return fail(error); }
    }
  };
}
