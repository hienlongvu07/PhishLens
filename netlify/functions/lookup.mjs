import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request) => handlers.lookup(request);
export const config = { path: "/api/lookup", method: "GET" };
