import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request) => handlers.health(request);
export const config = { path: "/api/health", method: "GET" };
