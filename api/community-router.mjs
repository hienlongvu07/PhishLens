import { communityHandlers } from "../src/community-routes.js";

const notFound = () => new Response(JSON.stringify({ error: "API route not found." }), {
  status: 404,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export default async function handler(request) {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost";
  const forwardedProtocol = (request.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  const url = new URL(request.url, `${forwardedProtocol}://${forwardedHost}`);
  const routedRequest = {
    url: url.href,
    method: request.method,
    headers: request.headers,
    text: () => request.text()
  };
  const route = (url.searchParams.get("route") || "").replace(/^\/+|\/+$/g, "");
  const method = request.method.toUpperCase();

  if (route === "config" && method === "GET") return communityHandlers.config(routedRequest);
  if (route === "stats" && method === "GET") return communityHandlers.publicStats(routedRequest);
  if (route === "events" && method === "POST") return communityHandlers.campaignEvent(routedRequest);
  if (route === "beta" && method === "POST") return communityHandlers.submitBeta(routedRequest);
  if (route === "challenge/start" && method === "POST") return communityHandlers.challengeStart(routedRequest);
  if (route === "challenge/complete" && method === "POST") return communityHandlers.challengeComplete(routedRequest);

  if (route === "admin" && method === "GET") return communityHandlers.adminDashboard(routedRequest);
  if (route === "admin/questions" && method === "POST") return communityHandlers.adminSaveQuestion(routedRequest);
  if (route === "admin/metrics" && method === "POST") return communityHandlers.adminAddMetric(routedRequest);
  if (route === "admin/export" && method === "GET") return communityHandlers.adminExport(routedRequest);

  const questionMatch = route.match(/^admin\/questions\/([a-z0-9-]{3,60})$/i);
  if (questionMatch && method === "PATCH") return communityHandlers.adminSaveQuestion(routedRequest, { params: { id: questionMatch[1] } });

  const feedbackMatch = route.match(/^admin\/feedback\/([0-9a-f-]{36})$/i);
  if (feedbackMatch && method === "PATCH") return communityHandlers.adminUpdateFeedback(routedRequest, { params: { id: feedbackMatch[1] } });

  return notFound();
}
