import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { actionExecuteShape } from "../plugin/rules/actionExecuteShape.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/action-execute-shape", actionExecuteShape, {
  valid: [
    "const action = Object.freeze({ id: \"auth.logout\", execute: (input, context) => authService.logout(resolveRequest(context)) });",
    "const action = Object.freeze({\n  id: \"workspace.settings.update\",\n  execute: ({ workspaceSlug, ...payload }, context) => service.update(workspaceSlug, payload, { context })\n});",
    "const actions = Object.freeze({ for_job: Object.freeze({ id: \"crud.external_documents.for_job\", execute: ({ input, context, service }) => service.queryDocumentsForJob(input, { context }) }) });",
    "const action = Object.freeze({ id: \"assistant.answer\", execute: async (input, context) => await assistant.streamAnswer(input, context) });",
    "const normalized = Object.freeze({ id, kind, execute: source.execute });",
    "const job = { name: \"nightly\", execute() { return run(); } };",
    "const action = {\n  id: \"booking.read\",\n  // readable-check: allow execute-shape - platform object: the scheduler calls execute with this bound\n  execute() { return this.read(); }\n};"
  ],
  invalid: [
    {
      code: "const action = Object.freeze({ id: \"crud.invoices.issue\", async execute(input, context) { const result = await service.issue(input); return { data: result }; } });",
      errors: [{ messageId: "blockBody", data: { action: "\"crud.invoices.issue\"" } }]
    },
    {
      code: "const action = Object.freeze({ id: ACTION_IDS.answer, execute: aiStreamAction((input, context) => assistant.streamAnswer(input, context)) });",
      errors: [{ messageId: "wrappedExecute", data: { action: "ACTION_IDS.answer", helper: "aiStreamAction" } }]
    },
    {
      code: "const action = Object.freeze({ id: \"owners.tariff.override\", execute: (input, context) => ({ data: { type: \"owners_agency_tariff_overrides\", attributes: service.override(input, context) } }) });",
      errors: [{ messageId: "notOneCall" }]
    },
    {
      code: "const action = Object.freeze({ id: \"plant.procedure.level\", execute: (input, context) => input.level ? service.raise(input, { context }) : service.lower(input, { context }) });",
      errors: [{ messageId: "notOneCall" }]
    },
    {
      code: "const action = Object.freeze({ id: \"emails.send\", execute: (input, context) => repository.withTransaction(input).then(() => service.send(input, { context })) });",
      errors: [{ messageId: "notOneCall" }]
    },
    {
      code: "function createOnboardingAction(id, execute) {\n  return { id, audit: { actionName: id }, execute };\n}",
      errors: [{ messageId: "notArrow", data: { action: "id" } }]
    },
    {
      code: "const action = { id: \"workflow.view\", execute: function (input, context) { return service.getDefinition(input.recordId, { context }); } };",
      errors: [{ messageId: "blockBody" }]
    }
  ]
});
