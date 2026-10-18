import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getAdmin } from "./api-handlers.js";
import { adminSupabase, allowedAdminEmails, publicSupabase } from "./supabase-clients.js";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
const products = new Set(["website", "extension", "both"]);
const events = new Set(["campaign_view", "challenge_click", "beta_click", "product_click", "share_click", "share_success"]);
const betaStatuses = new Set(["Mới", "Đang xem xét", "Đã xử lý"]);
const betaCategories = new Set(["Chưa phân loại", "Lỗi", "Giao diện", "Nội dung", "Tốc độ", "Tính năng", "Khác"]);
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_EXTENSION_URL = "https://chromewebstore.google.com/detail/phishlens/ompglgjccagiadkbeeneonjiooojincn";

async function bodyJson(request, max = 12000) {
  const raw = await request.text();
  if (raw.length > max) throw Object.assign(new Error("Nội dung gửi vượt giới hạn."), { status: 413 });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("JSON không hợp lệ."), { status: 400 }); }
}

function signedAttempt(id, expiresAt, secret) {
  const payload = Buffer.from(JSON.stringify({ id, exp: expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAttemptToken(token, secret) {
  if (typeof token !== "string" || token.length > 500) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!/^[0-9a-f-]{36}$/i.test(value.id) || !Number.isSafeInteger(value.exp) || value.exp < Date.now() || value.exp > Date.now() + MAX_AGE_MS + 60_000) return null;
    return value;
  } catch { return null; }
}

function publicQuestion(question) {
  const options = question.options.map(({ id, text }) => ({ id, text }));
  for (let i = options.length - 1; i > 0; i--) { const j = randomInt(i + 1); [options[i], options[j]] = [options[j], options[i]]; }
  return { id: question.id, category: question.category, prompt: question.prompt, options };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function publicExtensionUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const storeHost = ["chromewebstore.google.com", "chrome.google.com"].includes(url.hostname.toLowerCase());
    if (!storeHost && !url.pathname.toLowerCase().endsWith(".zip")) return "";
    return url.href;
  } catch { return ""; }
}

export function createCommunityHandlers({ makeAdminClient = adminSupabase, makePublicClient = publicSupabase, isAllowedAdmin = (email) => Boolean(email) && allowedAdminEmails().has(email.toLowerCase()), fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const db = () => makeAdminClient();
  const extensionUrl = () => publicExtensionUrl(env.EXTENSION_PUBLIC_URL) || DEFAULT_EXTENSION_URL;
  async function verifyTurnstile(token) {
    const secret = env.TURNSTILE_SECRET_KEY;
    if (!secret || !env.TURNSTILE_SITE_KEY) return { ok: false, unavailable: true };
    if (typeof token !== "string" || token.length < 10 || token.length > 2048) return { ok: false };
    try {
      const form = new URLSearchParams({ secret, response: token });
      const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(5000) });
      const result = await response.json();
      if (!response.ok || !result.success) return { ok: false };
      const expectedHost = env.PHISHLENS_SITE_URL ? new URL(env.PHISHLENS_SITE_URL).hostname : "";
      if (expectedHost && result.hostname !== expectedHost) return { ok: false };
      return { ok: true };
    } catch { return { ok: false, unavailable: true }; }
  }

  return {
    config: async () => json(200, { turnstileSiteKey: env.TURNSTILE_SITE_KEY || "", extensionUrl: extensionUrl() }),

    publicStats: async () => {
      const { data, error } = await db().rpc("community_public_stats");
      if (error) return json(503, { error: "Chưa tải được thống kê hoạt động." });
      return json(200, data || {});
    },

    campaignEvent: async (request) => {
      try {
        const input = await bodyJson(request, 1200);
        if (!input || Object.keys(input).some((key) => !["eventType", "utmSource"].includes(key)) || !events.has(input.eventType)) return json(400, { error: "Sự kiện không hợp lệ." });
        const source = typeof input.utmSource === "string" ? input.utmSource.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 80) : "";
        const { error } = await db().from("community_campaign_events").insert({ event_type: input.eventType, utm_source: source });
        if (error) throw error;
        return json(201, { ok: true });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa ghi nhận được sự kiện." }); }
    },

    challengeStart: async (request) => {
      try {
        if (!env.COMMUNITY_SIGNING_SECRET || env.COMMUNITY_SIGNING_SECRET.length < 32) return json(503, { error: "Challenge chưa được cấu hình trên máy chủ." });
        const input = await bodyJson(request, 3000);
        if (!input || Object.keys(input).some((key) => !["turnstileToken"].includes(key))) return json(400, { error: "Yêu cầu không hợp lệ." });
        const verification = await verifyTurnstile(input.turnstileToken);
        if (!verification.ok) return json(verification.unavailable ? 503 : 400, { error: verification.unavailable ? "Xác minh đang tạm gián đoạn. Hãy thử lại sau." : "Không xác minh được yêu cầu. Hãy thử lại." });
        const { data: bank, error } = await db().from("community_challenge_questions").select("id,category,prompt,options,correct_option_id,explanation,safety_tip,active").eq("active", true);
        if (error) throw error;
        if (!bank || bank.length < 15) return json(503, { error: "Thử thách chưa sẵn sàng. Ngân hàng cần ít nhất 15 câu hỏi đang hoạt động." });
        const shuffled = [...bank];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
        const selected = shuffled.slice(0, 10);
        const id = crypto.randomUUID();
        const expiresAt = Date.now() + MAX_AGE_MS;
        const snapshot = selected.map((question) => ({ id: question.id, category: question.category, prompt: question.prompt, options: question.options, correctOptionId: question.correct_option_id, explanation: question.explanation, safetyTip: question.safety_tip }));
        const { error: insertError } = await db().from("community_challenge_attempts").insert({ id, question_snapshot: snapshot, expires_at: new Date(expiresAt).toISOString() });
        if (insertError) throw insertError;
        return json(201, { attemptToken: signedAttempt(id, expiresAt, env.COMMUNITY_SIGNING_SECRET || ""), questions: selected.map(publicQuestion) });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa thể bắt đầu thử thách." }); }
    },

    challengeComplete: async (request) => {
      try {
        const input = await bodyJson(request, 5000);
        if (!input || Object.keys(input).some((key) => !["attemptToken", "answers"].includes(key)) || !Array.isArray(input.answers) || input.answers.length !== 10) return json(400, { error: "Câu trả lời chưa hợp lệ." });
        const secret = env.COMMUNITY_SIGNING_SECRET;
        if (!secret || secret.length < 32) return json(503, { error: "Thử thách chưa được cấu hình trên máy chủ." });
        const token = verifyAttemptToken(input.attemptToken, secret);
        if (!token) return json(400, { error: "Lượt chơi hết hạn hoặc không hợp lệ. Hãy bắt đầu lượt mới." });
        const { data: attempt, error } = await db().from("community_challenge_attempts").select("id,question_snapshot,expires_at,completed_at,score").eq("id", token.id).maybeSingle();
        if (error) throw error;
        if (!attempt || new Date(attempt.expires_at).getTime() < Date.now()) return json(400, { error: "Lượt chơi hết hạn hoặc không hợp lệ. Hãy bắt đầu lượt mới." });
        const snapshot = attempt.question_snapshot;
        const answerMap = new Map();
        for (const answer of input.answers) {
          if (!answer || Object.keys(answer).some((key) => !["questionId", "optionId"].includes(key)) || typeof answer.questionId !== "string" || typeof answer.optionId !== "string" || answerMap.has(answer.questionId)) return json(400, { error: "Câu trả lời không đúng định dạng." });
          answerMap.set(answer.questionId, answer.optionId);
        }
        if (snapshot.length !== 10 || snapshot.some((question) => !answerMap.has(question.id) || !question.options.some((option) => option.id === answerMap.get(question.id)))) return json(400, { error: "Câu trả lời không khớp với lượt chơi này." });
        const results = snapshot.map((question) => ({ questionId: question.id, correct: answerMap.get(question.id) === question.correctOptionId }));
        if (attempt.completed_at) return json(409, { error: "Lượt này đã được chấm. Hãy bắt đầu lượt mới để chơi lại." });
        const score = results.filter((result) => result.correct).length;
        const { data: completed, error: finishError } = await db().rpc("complete_community_challenge", { p_attempt_id: token.id, p_score: score, p_results: results });
        if (finishError) throw finishError;
        if (completed.duplicate) return json(409, { error: "Lượt này vừa được chấm. Hãy bắt đầu lượt mới để chơi lại." });
        const correctness = new Map((completed.results || results).map((result) => [result.questionId, result.correct]));
        const responseQuestions = snapshot.map((question) => ({
          id: question.id, category: question.category, prompt: question.prompt,
          selectedOptionId: answerMap.get(question.id), correctOptionId: question.correctOptionId,
          correct: correctness.get(question.id), explanation: question.explanation, safetyTip: question.safetyTip,
          options: question.options
        }));
        return json(200, { score: completed.score, correctCount: completed.score, incorrectCount: 10 - completed.score, total: 10, duplicate: Boolean(completed.duplicate), level: completed.score >= 9 ? "Bạn đã nhận ra rất nhiều tín hiệu." : completed.score >= 6 ? "Bạn đã có nền tảng tốt; hãy xem lại vài điểm dễ bỏ sót." : "Không sao cả — xem lời giải để biết cách kiểm tra an toàn hơn.", questions: responseQuestions });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa chấm được lượt chơi. Hãy thử lại." }); }
    },

    submitBeta: async (request) => {
      try {
        const input = await bodyJson(request, 7000);
        const allowed = ["product", "completedSteps", "ratings", "issue", "usefulFeature", "desiredFeature", "suggestion", "turnstileToken"];
        if (!input || Object.keys(input).some((key) => !allowed.includes(key)) || !products.has(input.product) || !Number.isInteger(input.completedSteps) || input.completedSteps < 0 || input.completedSteps > 7) return json(400, { error: "Kiểm tra lại thông tin đánh giá." });
        const ratingKeys = ["ease", "clarity", "speed", "usefulness", "overall"];
        if (!input.ratings || Object.keys(input.ratings).length !== 5 || ratingKeys.some((key) => !Number.isInteger(input.ratings[key]) || input.ratings[key] < 1 || input.ratings[key] > 5)) return json(400, { error: "Hãy chấm đủ năm tiêu chí từ 1 đến 5." });
        if (input.product !== "website" && !extensionUrl()) return json(400, { error: "Phần thử extension chưa mở vì chưa có link cài đặt công khai." });
        const limits = { issue: 1200, usefulFeature: 600, desiredFeature: 600, suggestion: 1000 };
        for (const [field, max] of Object.entries(limits)) if (typeof (input[field] ?? "") !== "string" || (input[field] ?? "").length > max) return json(400, { error: "Một nội dung góp ý vượt quá giới hạn cho phép." });
        const verification = await verifyTurnstile(input.turnstileToken);
        if (!verification.ok) return json(verification.unavailable ? 503 : 400, { error: verification.unavailable ? "Xác minh đang tạm gián đoạn. Hãy thử lại sau." : "Không xác minh được yêu cầu. Hãy thử lại." });
        const row = { product: input.product, completed_steps: input.completedSteps, rating_ease: input.ratings.ease, rating_clarity: input.ratings.clarity, rating_speed: input.ratings.speed, rating_usefulness: input.ratings.usefulness, rating_overall: input.ratings.overall, issue: input.issue.trim(), useful_feature: input.usefulFeature.trim(), desired_feature: input.desiredFeature.trim(), suggestion: input.suggestion.trim() };
        const { data, error } = await db().from("community_beta_feedback").insert(row).select("id,created_at").single();
        if (error) throw error;
        return json(201, { ok: true, id: data.id, createdAt: data.created_at });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa lưu được phản hồi. Hãy thử lại." }); }
    },

    adminDashboard: async (request) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const url = new URL(request.url);
        const view = url.searchParams.get("view") || "overview";
        const [{ data: stats, error: statsError }] = await Promise.all([db().rpc("community_admin_stats")]);
        if (statsError) throw statsError;
        if (view === "questions") {
          const { data, error } = await db().from("community_challenge_questions").select("id,category,prompt,options,correct_option_id,explanation,safety_tip,active,sort_order,updated_at").order("sort_order");
          if (error) throw error;
          return json(200, { stats, questions: data || [] });
        }
        if (view === "feedback") {
          const page = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
          const status = url.searchParams.get("status") || "";
          const product = url.searchParams.get("product") || "";
          let query = db().from("community_beta_feedback").select("*", { count: "exact" });
          if (betaStatuses.has(status)) query = query.eq("status", status);
          if (products.has(product)) query = query.eq("product", product);
          const { data, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * 30, page * 30 - 1);
          if (error) throw error;
          return json(200, { stats, feedback: data || [], count: count || 0, page, pageSize: 30 });
        }
        if (view === "metrics") {
          const { data, error } = await db().from("community_external_metrics").select("*").order("created_at", { ascending: false }).limit(200);
          if (error) throw error;
          return json(200, { stats, metrics: data || [] });
        }
        const { data: eventsData, error: eventsError } = await db().from("community_campaign_events").select("event_type,utm_source,created_at").order("created_at", { ascending: false }).limit(5000);
        if (eventsError) throw eventsError;
        return json(200, { stats, events: eventsData || [] });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa tải được bảng điều khiển cộng đồng." }); }
    },

    adminUpdateFeedback: async (request, context) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const id = context?.params?.id || new URL(request.url).pathname.split("/").at(-1);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Mã phản hồi không hợp lệ." });
        const input = await bodyJson(request, 1500);
        if (!betaStatuses.has(input.status) || !betaCategories.has(input.category)) return json(400, { error: "Trạng thái hoặc phân loại không hợp lệ." });
        const { data, error } = await db().from("community_beta_feedback").update({ status: input.status, category: input.category, updated_at: new Date().toISOString() }).eq("id", id).select("id,status,category").maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: "Không tìm thấy phản hồi." });
        return json(200, data);
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa cập nhật được phản hồi." }); }
    },

    adminSaveQuestion: async (request, context) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const input = await bodyJson(request, 8000);
        const id = context?.params?.id || input.id;
        if (typeof id !== "string" || !/^[a-z0-9-]{3,60}$/.test(id) || typeof input.category !== "string" || input.category.length < 2 || input.category.length > 100 || typeof input.prompt !== "string" || input.prompt.length < 10 || input.prompt.length > 700 || !Array.isArray(input.options) || input.options.length < 3 || input.options.length > 5 || typeof input.correctOptionId !== "string" || !input.options.some((option) => option?.id === input.correctOptionId) || typeof input.explanation !== "string" || input.explanation.length < 10 || input.explanation.length > 700 || typeof input.safetyTip !== "string" || input.safetyTip.length < 5 || input.safetyTip.length > 500 || typeof input.active !== "boolean") return json(400, { error: "Nội dung câu hỏi hoặc đáp án chưa hợp lệ." });
        const optionIds = new Set();
        for (const option of input.options) {
          if (!option || typeof option.id !== "string" || !/^[a-z0-9_-]{1,20}$/.test(option.id) || optionIds.has(option.id) || typeof option.text !== "string" || option.text.length < 2 || option.text.length > 300) return json(400, { error: "Các lựa chọn cần mã riêng và nội dung hợp lệ." });
          optionIds.add(option.id);
        }
        const row = { id, category: input.category.trim(), prompt: input.prompt.trim(), options: input.options, correct_option_id: input.correctOptionId, explanation: input.explanation.trim(), safety_tip: input.safetyTip.trim(), active: input.active, sort_order: Number.isInteger(input.sortOrder) ? Math.max(0, Math.min(10000, input.sortOrder)) : 100, updated_at: new Date().toISOString() };
        const { data, error } = await db().from("community_challenge_questions").upsert(row).select("id,active,updated_at").single();
        if (error) throw error;
        return json(200, data);
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa lưu được câu hỏi." }); }
    },

    adminAddMetric: async (request) => {
      try {
        const user = await getAdmin(request, makePublicClient, isAllowedAdmin);
        const input = await bodyJson(request, 3500);
        const platformValues = ["Facebook", "TikTok", "Khác"], typeValues = ["Lượt xem", "Lượt tương tác", "Lượt chia sẻ", "Khác"];
        let source;
        try { source = new URL(input.evidenceUrl); } catch { source = null; }
        if (!platformValues.includes(input.platform) || !typeValues.includes(input.metricType) || !Number.isInteger(input.value) || input.value < 0 || input.value > 100000000 || !source || source.protocol !== "https:" || !source.hostname || source.username || source.password || typeof (input.note || "") !== "string" || (input.note || "").length > 500) return json(400, { error: "Nhập nền tảng, số liệu và liên kết minh chứng HTTPS hợp lệ." });
        const { data, error } = await db().from("community_external_metrics").insert({ platform: input.platform, metric_type: input.metricType, metric_value: input.value, evidence_url: input.evidenceUrl, note: input.note || "", created_by: user.id }).select("id,platform,metric_type,metric_value,evidence_url,note,created_at").single();
        if (error) throw error;
        return json(201, data);
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa lưu được số liệu." }); }
    },

    adminExport: async (request) => {
      try {
        await getAdmin(request, makePublicClient, isAllowedAdmin);
        const from = new URL(request.url).searchParams.get("from") || "";
        const to = new URL(request.url).searchParams.get("to") || "";
        const dateFilter = (query, column = "created_at") => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte(column, `${from}T00:00:00.000Z`);
          if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte(column, `${to}T23:59:59.999Z`);
          return query;
        };
        const [attempts, feedback, eventsData, metrics] = await Promise.all([
          dateFilter(db().from("community_challenge_attempts").select("id,score,started_at,completed_at").order("started_at", { ascending: false }), "started_at").limit(10000),
          dateFilter(db().from("community_beta_feedback").select("created_at,product,completed_steps,rating_ease,rating_clarity,rating_speed,rating_usefulness,rating_overall,issue,useful_feature,desired_feature,suggestion,status,category").order("created_at", { ascending: false })).limit(10000),
          dateFilter(db().from("community_campaign_events").select("created_at,event_type,utm_source").order("created_at", { ascending: false })).limit(10000),
          dateFilter(db().from("community_external_metrics").select("created_at,platform,metric_type,metric_value,evidence_url,note").order("created_at", { ascending: false })).limit(10000)
        ]);
        for (const result of [attempts, feedback, eventsData, metrics]) if (result.error) throw result.error;
        const rows = [["Nhóm", "Thời gian", "Hoạt động", "Số liệu", "Chi tiết", "Nguồn"]];
        for (const row of attempts.data || []) rows.push(["Challenge", row.started_at, row.completed_at ? "Hoàn thành" : "Bắt đầu", row.score == null ? "" : `${row.score}/10`, row.id, ""]);
        for (const row of feedback.data || []) rows.push(["Beta", row.created_at, row.product, `${(row.rating_ease + row.rating_clarity + row.rating_speed + row.rating_usefulness + row.rating_overall) / 5}/5`, `${row.status} · ${row.category} · ${row.issue} · ${row.useful_feature} · ${row.desired_feature} · ${row.suggestion}`, ""]);
        for (const row of eventsData.data || []) rows.push(["Chiến dịch", row.created_at, row.event_type, 1, row.utm_source, ""]);
        for (const row of metrics.data || []) rows.push(["Mạng xã hội", row.created_at, `${row.platform} · ${row.metric_type}`, row.metric_value, row.note, row.evidence_url]);
        const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
        return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="phishlens-community-report.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : "Chưa xuất được báo cáo." }); }
    }
  };
}
