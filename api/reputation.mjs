import { createApiHandlers } from "../src/api-handlers.js";

const handlers = createApiHandlers();
export const POST = (request) => handlers.reputation(request);
