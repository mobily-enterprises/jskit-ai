import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noFactorySpread } from "../plugin/rules/noFactorySpread.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-factory-spread", noFactorySpread, {
  valid: [
    "function createInvoices(dependencies) {\n  const reads = createInvoiceReads(dependencies);\n  return Object.freeze({ listInvoices: reads.listInvoices, readInvoice: reads.readInvoice });\n}",
    "const feature = { setup({ service }) { return { checklists: Object.freeze({ decorateService(base) { return Object.freeze({ ...base, close }); } }) }; } };",
    "function decorateService(service) {\n  const audit = createAudit(service);\n  return Object.freeze({ ...service, ...audit });\n}",
    "function createRequestOptions(options) { return Object.freeze({ ...DEFAULT_OPTIONS, ...options }); }",
    "function createScopeInput(request) { return { workspaceSlug: request.params.workspaceSlug }; }\nfunction createCustomActionInput(request) {\n  const scopedInput = createScopeInput(request);\n  return { ...scopedInput, ...request.input };\n}",
    "function createOutputTargetSpec(target) {\n  return { ...createGenericTargetSpec(target), presentation: target.presentation };\n}",
    "function listRows(rows) { return rows.map((row) => ({ ...createRow(row), id: row.id })); }"
  ],
  invalid: [
    {
      code: "const feature = { setup(dependencies) {\n  return { invoices: Object.freeze({ ...createInvoiceReads(dependencies), ...createInvoiceWrites(dependencies) }) };\n} };",
      errors: [
        { messageId: "factorySpread", data: { owner: "setup", factory: "createInvoiceReads()" } },
        { messageId: "factorySpread", data: { owner: "setup", factory: "createInvoiceWrites()" } }
      ]
    },
    {
      code: "function createRepository({ knex }) {\n  const staffRoster = createStaffRosterQueries({ knex });\n  return Object.freeze({ ...staffRoster, withTransaction });\n}",
      errors: [{ messageId: "factorySpread", data: { owner: "createRepository", factory: "staffRoster from createStaffRosterQueries()" } }]
    },
    {
      code: "function createUsageRecording({ admission, events }) {\n  return Object.freeze({ admit: admission, ...createService({ admission, events }) });\n}",
      errors: [{ messageId: "factorySpread", data: { owner: "createUsageRecording", factory: "createService()" } }]
    },
    {
      code: "async function createDocumentsService(dependencies) {\n  const generation = await createDocumentGeneration(dependencies);\n  function readDocument(id) { return dependencies.repository.read(id); }\n  return { ...generation, readDocument };\n}",
      errors: [{ messageId: "factorySpread", data: { owner: "createDocumentsService", factory: "generation from createDocumentGeneration()" } }]
    },
    {
      code: "const createSystemGraph = ({ project }) => Object.freeze({ ...services.createService({ project }) });",
      errors: [{ messageId: "factorySpread" }]
    }
  ]
});
