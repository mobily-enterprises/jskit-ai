import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { knexReason } from "../plugin/rules/knexReason.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const REPOSITORY = "packages/receivals/src/server/receivalsRepository.js";
const TOTALS = "// Knex: totals - monthly totals with a conditional count per status";

function inRepository(code, filename = REPOSITORY) {
  return { code, filename };
}

new RuleTester().run("jskit/knex-reason", knexReason, {
  valid: [
    inRepository(`${TOTALS}\nasync function monthlyTotals(options) {\n  return receivals.scopedQuery(options).select("status");\n}`),
    inRepository(`function createReceivalsRepository({ receivals }) {\n  return Object.freeze({\n    ${TOTALS}\n    monthlyTotals: (options) => receivals.scopedQuery(options).select("status")\n  });\n}`),
    inRepository(`${TOTALS}\n/**\n * Totals per status and month.\n * @param {object} options\n */\nexport async function monthlyTotals(options) {\n  return receivals.scopedQuery(options).select("status");\n}`),
    inRepository("// Knex: newest-per-group - the newest snapshot of each booking, ranked by revision\nconst latest = (options) => snapshots.scopedQuery(options).select(\"bookingId\");"),
    inRepository("// Knex: subquery - the lots a receival may join, for the lots repository's whereIn\nexport const joinableLots = (options) => lots.query({}).whereIn(\"id\", (q) => receivals.scopedQuery(options).select(\"lotId\"));"),
    inRepository("// Knex: hot-path #412 - distinct actors by a loose index scan\nconst actors = (options) => events.scopedQuery(options).distinct(\"actorId\");"),
    inRepository("// Knex: hot-path https://github.com/example/jskit/issues/412 - distinct actors by a loose index scan\nconst actors = (options) => events.scopedQuery(options).distinct(\"actorId\");"),
    inRepository("// Knex: hot-path - distinct actors by a loose index scan until #412 lands in the resource\nconst actors = (options) => events.scopedQuery(options).distinct(\"actorId\");"),
    inRepository("class Reports {\n  // Knex: report - distinct active days per person over thirty days\n  activeDays(options) { return activity.scopedQuery(options).countDistinct(\"day\"); }\n}"),
    inRepository("// Knex: runtime-tables - rows of tables people define while the app runs\nconst rows = (resource, options) => resource.scopedQuery(options).select(\"*\");", "packages/data/src/server/repositories/runtimeRows.js"),
    inRepository("// Knex: report - totals for the console\nconst totals = (options) => receivals.scopedQuery(options).count();", "packages/console/src/server/repository.js"),
    { code: "async function listOpen(options) { return receivals.query({ page: { size: 20 } }, options); }", filename: "packages/receivals/src/server/receivalsService.js" }
  ],
  invalid: [
    {
      ...inRepository("async function monthlyTotals(options) {\n  return receivals.scopedQuery(options).select(\"status\");\n}"),
      errors: [{ messageId: "missingReason", data: { name: "monthlyTotals" }, line: 2 }]
    },
    {
      ...inRepository("/**\n * Totals per status and month.\n */\nconst monthlyTotals = (options) => receivals.scopedQuery(options).select(\"status\");"),
      errors: [{ messageId: "missingReason", data: { name: "monthlyTotals" } }]
    },
    {
      ...inRepository(`${TOTALS}\n\nasync function monthlyTotals(options) {\n  return receivals.scopedQuery(options).select("status");\n}`),
      errors: [{ messageId: "missingReason" }]
    },
    {
      ...inRepository("// Knex: totals\nconst totals = (options) => receivals.scopedQuery(options).count();"),
      errors: [{ messageId: "reasonForm", data: { name: "totals" } }]
    },
    {
      ...inRepository("// Knex: speed - the resource is slower here\nconst totals = (options) => receivals.scopedQuery(options).count();"),
      errors: [{ messageId: "unknownKind", data: { name: "totals" } }]
    },
    {
      ...inRepository("// Knex: hot-path - distinct actors by a loose index scan\nconst actors = (options) => events.scopedQuery(options).distinct(\"actorId\");"),
      errors: [{ messageId: "hotPathTicket", data: { name: "actors" } }]
    },
    {
      ...inRepository("const totals = async (options) => {\n  const a = await receivals.scopedQuery(options).count();\n  const b = await receivals.scopedQuery(options).sum(\"weight\");\n  return [a, b];\n};"),
      errors: [{ messageId: "missingReason", line: 2 }]
    },
    {
      ...inRepository(`${TOTALS}\nconst base = receivals.scopedQuery(systemOptions);`),
      errors: [{ messageId: "outsideMethod" }]
    },
    {
      code: `${TOTALS}\nasync function monthlyTotals(options) {\n  return receivals.scopedQuery(options).select("status");\n}`,
      filename: "packages/receivals/src/server/receivalsService.js",
      errors: [{ messageId: "outsideRepository" }]
    },
    {
      code: `${TOTALS}\nconst totals = (options) => receivals.scopedQuery(options).count();`,
      filename: "packages/receivals/src/server/receivalRepositoryExtensions.js",
      errors: [{ messageId: "outsideRepository" }]
    },
    {
      ...inRepository("// readable-check: allow knex-reason - data: a known report\nconst totals = (options) => receivals.scopedQuery(options).count();"),
      errors: [{ messageId: "missingReason" }]
    }
  ]
});
