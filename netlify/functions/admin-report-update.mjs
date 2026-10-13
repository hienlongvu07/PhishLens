import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request, context) => handlers.adminUpdateReport(request, context);
export const config = { path: "/api/admin/reports/:id", method: "PATCH", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
