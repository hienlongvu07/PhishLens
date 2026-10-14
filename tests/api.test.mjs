import test from "node:test";
import assert from "node:assert/strict";
import { createApiHandlers } from "../src/api-handlers.js";

const admin = { id: "admin-user", email: "admin@example.com" };
const report = {
  id: "123e4567-e89b-12d3-a456-426614174000", url: "https://lookalike.test/login?token=abc#form",
  hostname: "lookalike.test", type: "Lừa lấy mật khẩu hoặc OTP", description: "Yêu cầu OTP",
  source: "extension", status: "Mới", review_note: "", public_summary: "Nguồn chính thức cảnh báo tên miền giả mạo.",
  source_url: "https://example.com/security-alert", created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:00Z"
};

function createHarness({ alerts = [], reports = [], insertResult = report, updated = report } = {}) {
  const calls = { inserted: [], rpc: [], auth: [] };
  const publicClient = {
    auth: {
      async getUser(token) { calls.auth.push(["getUser", token]); return { data: { user: token === "good" ? admin : null }, error: null }; },
      async signInWithPassword({ email }) { calls.auth.push(["login", email]); return { data: { user: admin, session: { access_token: "good", refresh_token: "refresh", expires_at: 2000000000, user: admin } }, error: null }; },
      async refreshSession() { return { data: { user: admin, session: { access_token: "good", refresh_token: "refresh2", expires_at: 2000000000, user: admin } }, error: null }; },
      async setSession() { return { error: null }; }, async signOut() { return { error: null }; }
    }
  };
  const adminClient = {
    from(table) {
      let selected = "";
      const query = {
        select(columns) { selected = columns; return query; },
        eq(column, value) { query.filter = [column, value]; return query; },
        in(column, value) { query.statusFilter = [column, value]; return query; },
        insert(row) { calls.inserted.push(row); return { select: () => ({ single: async () => ({ data: insertResult, error: null }) }) }; },
        maybeSingle: async () => ({ data: table === "verified_alerts" ? alerts.find((item) => item.hostname === query.filter?.[1]) || null : null, error: null }),
        then(resolve, reject) {
          const count = table === "reports" ? reports.filter((r) => r.hostname === query.filter?.[1] && query.statusFilter?.[1].includes(r.status)).length : null;
          return Promise.resolve({ count, error: null, data: selected.includes("count") ? null : reports }).then(resolve, reject);
        },
        or() { return query; }, gte() { return query; }, lte() { return query; }, order() { return query; }, range() { return query; }
      };
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push([name, args]);
      if (name === "admin_report_stats") return { data: { total: reports.length, byStatus: { Mới: reports.length }, byType: {} }, error: null };
      return { data: updated, error: null };
    }
  };
  const handlers = createApiHandlers({ makePublicClient: () => publicClient, makeAdminClient: () => adminClient, isAllowedAdmin: (email) => email?.toLowerCase() === "admin@example.com" });
  return { handlers, calls };
}

const post = (url, body) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const authorized = { headers: { Authorization: "Bearer good" } };

test("report accepts full URL exactly, including query and fragment", async () => {
  const { handlers, calls } = createHarness();
  const response = await handlers.submitReport(post("https://phishlens.test/api/reports", { url: report.url, type: report.type, source: "extension" }));
  assert.equal(response.status, 201);
  assert.equal(calls.inserted[0].url, report.url);
  assert.equal(calls.inserted[0].hostname, "lookalike.test");
});

test("report validation rejects unsupported URLs, credentials, types and long descriptions", async () => {
  const { handlers, calls } = createHarness();
  for (const url of ["javascript:alert(1)", "https://user:pass@example.com", "not a url"]) {
    const response = await handlers.submitReport(post("https://phishlens.test/api/reports", { url, type: report.type }));
    assert.equal(response.status, 400);
  }
  assert.equal((await handlers.submitReport(post("https://phishlens.test/api/reports", { url: report.url, type: "invalid" }))).status, 400);
  assert.equal((await handlers.submitReport(post("https://phishlens.test/api/reports", { url: report.url, type: report.type, description: "x".repeat(1001) }))).status, 400);
  assert.equal(calls.inserted.length, 0);
});

test("lookup distinguishes verified, pending and no-data without calling unknown safe", async () => {
  const { handlers } = createHarness({ alerts: [{ hostname: "verified.test", url: "https://verified.test/", type: "Khác", summary: "Đã kiểm tra", source_url: "https://example.org/alert", status: "Đã xác minh", source: "Nhóm", updated_at: "2026-10-13", is_demo: false }], reports: [{ hostname: "pending.test", status: "Mới" }] });
  const lookup = (host) => handlers.lookup(new Request(`https://phishlens.test/api/lookup?url=${host}`));
  const verified = await (await lookup("verified.test")).json();
  assert.equal(verified.status, "Đã được xác minh");
  assert.equal(verified.item.sourceUrl, "https://example.org/alert");
  assert.equal((await (await lookup("pending.test")).json()).status, "Đang xem xét");
  const unknown = await (await lookup("unknown.test")).json();
  assert.equal(unknown.status, "Chưa có dữ liệu");
  assert.match(unknown.message, /không thể suy ra.*an toàn/i);
});

test("admin routes require an allowed authenticated account and login rejects non-allowlisted email", async () => {
  const { handlers, calls } = createHarness();
  assert.equal((await handlers.adminReports(new Request("https://phishlens.test/api/admin/reports"))).status, 401);
  assert.equal((await handlers.adminReports(new Request("https://phishlens.test/api/admin/reports", { headers: { Authorization: "Bearer wrong" } }))).status, 401);
  assert.equal((await handlers.adminLogin(post("https://phishlens.test/api/admin/login", { email: "other@example.com", password: "secret" }))).status, 403);
  const loggedIn = await handlers.adminLogin(post("https://phishlens.test/api/admin/login", { email: "admin@example.com", password: "secret" }));
  assert.equal(loggedIn.status, 200);
  assert.equal(calls.auth.at(-1)[0], "login");
});

test("admin can list, paginate and change report status through the protected RPC", async () => {
  const { handlers, calls } = createHarness({ reports: [report] });
  const list = await (await handlers.adminReports(new Request("https://phishlens.test/api/admin/reports?page=1", authorized))).json();
  assert.equal(list.reports[0].url, report.url);
  assert.equal(list.pageSize, 50);
  const missingEvidence = post("https://phishlens.test/api/admin/reports/123e4567-e89b-12d3-a456-426614174000", { status: "Đã xác minh" });
  missingEvidence.headers.set("Authorization", "Bearer good");
  assert.equal((await handlers.adminUpdateReport(missingEvidence, { params: { id: report.id } })).status, 400);
  const insecureEvidence = post("https://phishlens.test/api/admin/reports/123e4567-e89b-12d3-a456-426614174000", { status: "Đã xác minh", publicSummary: report.public_summary, sourceUrl: "http://example.com/alert" });
  insecureEvidence.headers.set("Authorization", "Bearer good");
  assert.equal((await handlers.adminUpdateReport(insecureEvidence, { params: { id: report.id } })).status, 400);
  const updateRequest = post("https://phishlens.test/api/admin/reports/123e4567-e89b-12d3-a456-426614174000", { status: "Đã xác minh", reviewNote: "Đã đối chiếu", publicSummary: report.public_summary, sourceUrl: report.source_url });
  updateRequest.headers.set("Authorization", "Bearer good");
  const update = await handlers.adminUpdateReport(updateRequest, { params: { id: report.id } });
  assert.equal(update.status, 200);
  assert.equal(calls.rpc.at(-1)[0], "admin_update_report");
  assert.equal(calls.rpc.at(-1)[1].p_status, "Đã xác minh");
  assert.equal(calls.rpc.at(-1)[1].p_source_url, report.source_url);
  const badRequest = post("https://phishlens.test/api/admin/reports/123e4567-e89b-12d3-a456-426614174000", { status: "safe" });
  badRequest.headers.set("Authorization", "Bearer good");
  const badUpdate = await handlers.adminUpdateReport(badRequest, { params: { id: report.id } });
  assert.equal(badUpdate.status, 400);
});

test("AI analysis accepts only hostname and signal codes and returns verified source separately", async () => {
  const requests = [];
  const aiResult = { summary: "Có dấu hiệu cần xem xét.", evidence: ["Tên miền dùng HTTP."], nextSteps: ["Tự mở website chính thức."], limitations: "Không xác minh toàn bộ website." };
  const handlers = createApiHandlers({
    makeAdminClient: () => ({ from: () => ({ select() { return this; }, eq(_field, host) { this.host = host; return this; }, async maybeSingle() { return { data: this.host === "login-verify-example.test" ? { hostname: this.host, type: "demo", summary: "Cảnh báo demo đã xác minh.", source_url: "https://example.org/source", status: "Đã xác minh", source: "PhishLens", updated_at: "2026-10-14", is_demo: true, url: "https://must-not-send.test/?secret=1" } : null, error: null }; } }) }),
    geminiApiKey: () => "test-key", geminiModel: () => "test-model",
    fetchImpl: async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiResult) }] } }] }); }
  });
  const response = await handlers.analyze(post("https://phishlens.test/api/analyze", { hostname: "login-verify-example.test", signalCodes: ["http", "sample_blocklist"] }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.community.status, "verified");
  assert.equal(data.community.demo, true);
  assert.deepEqual(data.ai, aiResult);
  const modelInput = JSON.parse(requests[0].body.contents[0].parts[0].text);
  assert.deepEqual(modelInput.signalCodes, ["http", "sample_blocklist"]);
  assert.equal(modelInput.hostname, "login-verify-example.test");
  assert.equal(modelInput.signalDetails[0].code, "http");
  assert.equal(JSON.stringify(requests[0].body).includes("must-not-send"), false);
  assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent");
  assert.equal(requests[0].init.headers["x-goog-api-key"], "test-key");
  assert.equal("temperature" in requests[0].body.generationConfig, false);
});

test("AI analysis validates its small allowlisted payload and requires server configuration", async () => {
  const handlers = createApiHandlers({ geminiApiKey: () => "" });
  assert.equal((await handlers.analyze(post("https://phishlens.test/api/analyze", { hostname: "https://x.test/a?secret=1", signalCodes: [] }))).status, 400);
  assert.equal((await handlers.analyze(post("https://phishlens.test/api/analyze", { hostname: "x.test", signalCodes: ["unknown"] }))).status, 400);
  assert.equal((await handlers.analyze(post("https://phishlens.test/api/analyze", { hostname: "x.test", signalCodes: [], url: "https://secret.test/" }))).status, 400);
  assert.equal((await handlers.analyze(post("https://phishlens.test/api/analyze", { hostname: "x.test", signalCodes: [] }))).status, 503);
});

test("AI analysis returns useful machine-readable errors for malformed output, provider failure and timeout", async () => {
  const baseOptions = { geminiApiKey: () => "test-key", makeAdminClient: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }) }) };
  const body = { hostname: "example.test", signalCodes: [] };
  const malformed = createApiHandlers({ ...baseOptions, fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }) });
  const malformedResponse = await malformed.analyze(post("https://phishlens.test/api/analyze", body));
  assert.equal(malformedResponse.status, 502);
  assert.equal((await malformedResponse.json()).code, "AI_INVALID_OUTPUT");
  const failed = createApiHandlers({ ...baseOptions, fetchImpl: async () => Response.json({ error: "upstream" }, { status: 500 }) });
  const failedResponse = await failed.analyze(post("https://phishlens.test/api/analyze", body));
  assert.equal(failedResponse.status, 502);
  assert.equal((await failedResponse.json()).code, "AI_PROVIDER_ERROR");
  const limited = createApiHandlers({ ...baseOptions, fetchImpl: async () => Response.json({}, { status: 429 }) });
  const limitedResponse = await limited.analyze(post("https://phishlens.test/api/analyze", body));
  assert.equal(limitedResponse.status, 503);
  assert.equal((await limitedResponse.json()).code, "GEMINI_RATE_LIMITED");
  const denied = createApiHandlers({ ...baseOptions, fetchImpl: async () => Response.json({}, { status: 403 }) });
  assert.equal((await (await denied.analyze(post("https://phishlens.test/api/analyze", body))).json()).code, "GEMINI_AUTH_FAILED");
  const rejected = createApiHandlers({ ...baseOptions, fetchImpl: async () => Response.json({ error: { status: "INVALID_ARGUMENT", message: "Unsupported generation setting." } }, { status: 400 }) });
  const rejectedData = await (await rejected.analyze(post("https://phishlens.test/api/analyze", body))).json();
  assert.equal(rejectedData.code, "GEMINI_REQUEST_INVALID");
  assert.equal(rejectedData.providerStatus, "INVALID_ARGUMENT");
  assert.match(rejectedData.providerMessage, /Unsupported generation setting/);
  const timeout = createApiHandlers({ ...baseOptions, fetchImpl: async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } });
  const timeoutResponse = await timeout.analyze(post("https://phishlens.test/api/analyze", body));
  assert.equal(timeoutResponse.status, 504);
  assert.equal((await timeoutResponse.json()).code, "AI_TIMEOUT");
});

