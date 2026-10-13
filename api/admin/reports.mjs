import { createApiHandlers } from "../../src/api-handlers.js";

const handlers = createApiHandlers();
export const GET = (request) => handlers.adminReports(request);
