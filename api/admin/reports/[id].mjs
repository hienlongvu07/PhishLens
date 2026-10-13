import { createApiHandlers } from "../../../src/api-handlers.js";

const handlers = createApiHandlers();
export const PATCH = (request) => handlers.adminUpdateReport(request);
