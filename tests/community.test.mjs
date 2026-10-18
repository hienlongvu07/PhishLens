import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCommunityHandlers } from "../src/community-handlers.js";

const bank = Array.from({ length: 15 }, (_, i) => ({ id: `q-${i + 1}`, category: "Tình huống", prompt: `Một tình huống kiểm tra an toàn số số ${i + 1}?`, options: [{ id: "a", text: "Làm theo đường dẫn" }, { id: "b", text: "Tự xác minh qua kênh chính thức" }, { id: "c", text: "Chia sẻ mã" }, { id: "d", text: "Chuyển tiền trước" }], correct_option_id: "b", explanation: "Hãy xác minh độc lập trước khi cung cấp dữ liệu hoặc tiền.", safety_tip: "Tự mở kênh chính thức để kiểm tra.", active: true }));

function setup(envOverrides = {}) {
  const state = { attempt: null, beta: null, events: [], metrics: [], question: null, feedback: null, rpcCalls: 0 };
  const env = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret", COMMUNITY_SIGNING_SECRET: "s".repeat(40), PHISHLENS_SITE_URL: "https://phishlens.example", ...envOverrides };
  const client = {
    from(table) {
      const q = { table, operation: "select", payload: null, filter: null, select() { return this; }, eq(key, value) { this.filter = [key, value]; return this; }, order() { return this; }, range() { return this; }, limit() { return this; }, gte() { return this; }, lte() { return this; }, insert(payload) { this.operation = "insert"; this.payload = payload; if (table === "community_challenge_attempts") state.attempt = { id: payload.id, question_snapshot: payload.question_snapshot, expires_at: payload.expires_at, completed_at: null, score: null }; if (table === "community_beta_feedback") state.beta = payload; if (table === "community_campaign_events") state.events.push(payload); if (table === "community_external_metrics") state.metrics.push(payload); return this; }, upsert(payload) { this.operation = "upsert"; this.payload = payload; state.question = payload; return this; }, update(payload) { this.operation = "update"; this.payload = payload; return this; }, maybeSingle: async function () { if (table === "community_challenge_attempts") return { data: state.attempt, error: null }; return { data: null, error: null }; }, single: async function () { return { data: { id: "12345678-1234-1234-1234-123456789abc", created_at: new Date().toISOString() }, error: null }; }, then(resolve, reject) { let data = table === "community_challenge_questions" ? bank : []; return Promise.resolve({ data, error: null }).then(resolve, reject); } };
      return q;
    },
    async rpc(name, args) { state.rpcCalls++; if (name === "complete_community_challenge") { state.attempt.completed_at = new Date().toISOString(); state.attempt.score = args.p_score; return { data: { score: args.p_score, results: args.p_results, duplicate: false }, error: null }; } if (name === "community_public_stats") return { data: { challengeStarted: 2, challengeCompleted: 1, betaFeedback: 1, campaignViews: 3 }, error: null }; if (name === "community_admin_stats") return { data: {}, error: null }; return { data: 0, error: null }; }
  };
  const handlers = createCommunityHandlers({ makeAdminClient: () => client, makePublicClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "admin-id", email: "admin@example.com" } }, error: null }) } }), isAllowedAdmin: (email) => email === "admin@example.com", env, fetchImpl: async (url) => ({ ok: true, json: async () => ({ success: true, hostname: "phishlens.example" }) }) });
  return { handlers, state, env };
}
const post = (body) => new Request("https://phishlens.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("public activity pages and extension links are present; privacy describes anonymous event counts", async () => {
  for (const page of ["community.html", "challenge.html", "beta.html", "campaign.html", "community-admin.html"]) assert.ok((await readFile(new URL(`../web/${page}`, import.meta.url), "utf8")).includes("<html"));
  const popup = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../web/privacy.html", import.meta.url), "utf8");
  assert.match(popup, /challenge-link/); assert.match(popup, /campaign-link/);
  assert.match(privacy, /12 tháng/); assert.match(privacy, /không đặt cookie/);
});

test("Challenge samples exactly 10 questions and server grades them once", async () => {
  const { handlers, state } = setup();
  const start = await handlers.challengeStart(post({ turnstileToken: "valid-turnstile-token" }));
  assert.equal(start.status, 201);
  const game = await start.json(); assert.equal(game.questions.length, 10); assert.ok(game.attemptToken);
  const answers = game.questions.map((question) => ({ questionId: question.id, optionId: "b" }));
  const result = await handlers.challengeComplete(post({ attemptToken: game.attemptToken, answers }));
  assert.equal(result.status, 200); const scored = await result.json(); assert.equal(scored.score, 10); assert.ok(scored.questions.every((q) => q.correct));
  const duplicate = await handlers.challengeComplete(post({ attemptToken: game.attemptToken, answers }));
  assert.equal(duplicate.status, 409); assert.equal(state.rpcCalls, 1);
});

test("Challenge refuses missing signing configuration and invalid CAPTCHA", async () => {
  const unconfigured = setup({ COMMUNITY_SIGNING_SECRET: "short" });
  assert.equal((await unconfigured.handlers.challengeStart(post({ turnstileToken: "valid-turnstile-token" }))).status, 503);
  const invalid = createCommunityHandlers({ makeAdminClient: () => ({}), env: { TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret", COMMUNITY_SIGNING_SECRET: "x".repeat(40) }, fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) }) });
  assert.equal((await invalid.challengeStart(post({ turnstileToken: "bad-turnstile-token" }))).status, 400);
});

test("Campaign events are allowlisted and stored with normalized source", async () => {
  const { handlers, state } = setup();
  assert.equal((await handlers.campaignEvent(post({ eventType: "campaign_view", utmSource: "Social / FB" }))).status, 201);
  assert.equal(state.events[0].utm_source, "socialfb");
  assert.equal((await handlers.campaignEvent(post({ eventType: "unknown" }))).status, 400);
});

test("Beta feedback requires all ratings and verified Turnstile", async () => {
  const { handlers, state } = setup();
  const body = { product: "website", completedSteps: 4, ratings: { ease: 4, clarity: 5, speed: 4, usefulness: 5, overall: 4 }, issue: "", usefulFeature: "Lookup", desiredFeature: "", suggestion: "", turnstileToken: "valid-turnstile-token" };
  assert.equal((await handlers.submitBeta(post({ ...body, ratings: { ease: 4 } }))).status, 400);
  assert.equal((await handlers.submitBeta(post(body))).status, 201);
  assert.equal(state.beta.completed_steps, 4);
});

test("community environment and CSP expose Turnstile only through the site key", async () => {
  const { handlers } = setup({ EXTENSION_PUBLIC_URL: "" });
  const config = await (await handlers.config()).json(); assert.equal(config.turnstileSiteKey, "site-key"); assert.equal(config.extensionUrl, "https://chromewebstore.google.com/detail/phishlens/ompglgjccagiadkbeeneonjiooojincn");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value, /challenges\.cloudflare\.com/);
});

test("community tables are server-only and retention migration covers activity data", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202610150001_community_activities.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/enable row level security/g) || []).length, 6);
  assert.match(sql, /from anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /interval '12 months'/);
  assert.equal((sql.match(/^\('[a-z0-9-]+',/gm) || []).length, 15);
});

test("community admin API rejects requests without the existing admin session", async () => {
  const { handlers } = setup();
  assert.equal((await handlers.adminDashboard(new Request("https://phishlens.example/api/admin/community"))).status, 401);
});
