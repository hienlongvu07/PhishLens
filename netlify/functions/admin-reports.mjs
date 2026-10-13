import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request) => handlers.adminReports(request);
export const config = { path: "/api/admin/reports", method: "GET" };
