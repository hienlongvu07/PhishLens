import { communityHandlers } from "../src/community-routes.js";

const notFound = () => new Response(JSON.stringify({ error: "API route not found." }), {
  status: 404,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export default async function handler(request) {
  const url = new URL(request.url);
  const route = (url.searchParams.get("route") || "").replace(/^\/+|\/+$/g, "");
  const method = request.method.toUpperCase();

  if (route === "config" && method === "GET") return communityHandlers.config(request);
  if (route === "stats" && method === "GET") return communityHandlers.publicStats(request);
  if (route === "events" && method === "POST") return communityHandlers.campaignEvent(request);
  if (route === "beta" && method === "POST") return communityHandlers.submitBeta(request);
  if (route === "challenge/start" && method === "POST") return communityHandlers.challengeStart(request);
  if (route === "challenge/complete" && method === "POST") return communityHandlers.challengeComplete(request);

  if (route === "admin" && method === "GET") return communityHandlers.adminDashboard(request);
  if (route === "admin/questions" && method === "POST") return communityHandlers.adminSaveQuestion(request);
  if (route === "admin/metrics" && method === "POST") return communityHandlers.adminAddMetric(request);
  if (route === "admin/export" && method === "GET") return communityHandlers.adminExport(request);

  const questionMatch = route.match(/^admin\/questions\/([a-z0-9-]{3,60})$/i);
  if (questionMatch && method === "PATCH") return communityHandlers.adminSaveQuestion(request, { params: { id: questionMatch[1] } });

  const feedbackMatch = route.match(/^admin\/feedback\/([0-9a-f-]{36})$/i);
  if (feedbackMatch && method === "PATCH") return communityHandlers.adminUpdateFeedback(request, { params: { id: feedbackMatch[1] } });

  return notFound();
}
