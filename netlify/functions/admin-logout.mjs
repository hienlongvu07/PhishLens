import { createApiHandlers } from "../../src/api-handlers.js";
const handlers = createApiHandlers();
export default (request) => handlers.adminLogout(request);
export const config = { path: "/api/admin/logout", method: "POST" };
