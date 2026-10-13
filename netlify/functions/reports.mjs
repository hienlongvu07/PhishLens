import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request, context) => handlers.submitReport(request, context);
export const config = {
  path: "/api/reports",
  method: "POST",
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
