import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { routeActionId } from "../plugin/rules/routeActionId.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/route-action-id", routeActionId, {
  valid: [
    "router.register(\"POST\", \"/api/invoices/:invoiceId/send\", { auth: \"required\", actionId: ACTION_SEND_INVOICE, params }, async function sendInvoice(request, reply) {\n  reply.send(await request.executeAction({ actionId: ACTION_SEND_INVOICE, input: request.input.params }));\n});",
    "http.router.register(\"GET\", \"/api/invoices\", { ...routeBase, actionId: \"invoices.list\" }, async (request) => request.executeAction({ actionId: \"invoices.list\", input: request.input.query }));",
    // A handler that chooses between actions runs no one action.
    "router.register(\"POST\", \"/api/invoices/:invoiceId\", { auth: \"required\" }, async function settle(request, reply) {\n  reply.send(request.input.body.paid ? await request.executeAction({ actionId: \"invoices.close\", input: {} }) : await request.executeAction({ actionId: \"invoices.remind\", input: {} }));\n});",
    // An action run on a surface the route resolves is checked where the handler runs it.
    "router.register(\"GET\", \"/api/chat\", { auth: \"required\" }, async function listChats(request, reply) {\n  reply.send(await request.executeAction({ actionId: ACTION_CHATS_LIST, surface: routeState.hostSurfaceId, input: {} }));\n});",
    "router.register(\"GET\", \"/v1/lending\", { auth: \"public\", middleware: [authenticateApiKey] }, async function readLending(request, reply) {\n  reply.send(await request.executeAction({ actionId: \"resellers.lending.read\", input: {}, context: { apiKey: request.apiKey } }));\n});",
    "router.register(\"GET\", \"/api/health\", { auth: \"public\" }, async () => ({ ok: true }));",
    "app.register(\"GET\", \"/api/invoices\", {}, async (request) => request.executeAction({ actionId: \"invoices.list\", input: {} }));",
    // A route whose action finds its scope in the body names no actionId, and says so.
    "// readable-check: allow route-action-id - action scope: its workspace is the body's workspaceSlug\nrouter.register(\"POST\", \"/api/imports\", { auth: \"required\", body }, async function runImport(request, reply) {\n  reply.send(await request.executeAction({ actionId: \"imports.run\", input: request.input.body }));\n});"
  ],
  invalid: [
    {
      code: "router.register(\"POST\", \"/api/invoices/:invoiceId/send\", { auth: \"required\", permission: \"invoices.write\", params }, async function sendInvoice(request, reply) {\n  reply.send(await request.executeAction({ actionId: ACTION_SEND_INVOICE, input: request.input.params }));\n});",
      errors: [{ messageId: "missingActionId", data: { route: "POST /api/invoices/:invoiceId/send", action: "ACTION_SEND_INVOICE" } }]
    },
    {
      code: "http.router.register(\"GET\", \"/api/w/:workspaceSlug/invoices\", { ...routeBase, query }, async (request) => request.executeAction({ actionId: \"invoices.list\", input: { ...request.input.params, ...request.input.query } }));",
      errors: [{ messageId: "missingActionId", data: { route: "GET /api/w/:workspaceSlug/invoices", action: "\"invoices.list\"" } }]
    },
    {
      code: "router.register(\"POST\", \"/api/invoices\", { auth: \"required\", body }, async function create(request, reply) {\n  if (request.input.body.draft) {\n    return reply.send(await request.executeAction({ actionId: ACTION_CREATE, input: { ...request.input.body } }));\n  }\n  reply.code(201).send(await request.executeAction({ actionId: ACTION_CREATE, input: request.input.body }));\n});",
      errors: [{ messageId: "missingActionId", data: { route: "POST /api/invoices", action: "ACTION_CREATE" } }]
    }
  ]
});
