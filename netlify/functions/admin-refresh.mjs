import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request) => handlers.adminRefresh(request);
export const config = { path: "/api/admin/refresh", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
