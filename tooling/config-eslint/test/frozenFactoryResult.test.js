import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { frozenFactoryResult } from "../plugin/rules/frozenFactoryResult.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/frozen-factory-result", frozenFactoryResult, {
  valid: [
    "function createGoogleAdsSearch({ invoke }) {\n  async function discover(id) { return invoke(\"discover\", id); }\n  async function create(reviewId) { return invoke(\"create\", reviewId); }\n  return Object.freeze({ discover, create });\n}",
    "function createLocalAuthService({ sessions }) {\n  function getStatus() { return sessions.status(); }\n  return Object.freeze({ getStatus, logout: sessions.logout });\n}",
    "function createScopeInput(request) { return { workspaceSlug: request.params.workspaceSlug, limit: 10 }; }",
    "const createEmptyQuery = () => ({ filters: [], page: 1 });",
    "function buildQueryFields(resource) { return { read() { return resource; } }; }",
    "function createReadAction({ service }) {\n  return Object.freeze({ id: \"booking.read\", execute: (input) => service.read(input) });\n}",
    "function createJobsService() {\n  function list() { return []; }\n  return list;\n}",
    "function createRegistry({ sessions }) {\n  return Object.freeze({ get size() { return sessions.size; } });\n}",
    "function createRepository({ knex }) {\n  return Object.freeze({\n    // readable-check: allow inline-member - platform object: Knex calls it with the transaction as this\n    withTransaction: function (work) { return knex.transaction(work); }\n  });\n}"
  ],
  invalid: [
    {
      code: "function createGoogleAdsSearch({ invoke }) {\n  return {\n    async discover(id) { return invoke(\"discover\", id); },\n    pause: (id) => invoke(\"campaigns.setStatus\", id)\n  };\n}",
      errors: [
        { messageId: "unfrozenResult", data: { factory: "createGoogleAdsSearch" } },
        { messageId: "inlineMember", data: { factory: "createGoogleAdsSearch", member: "discover" } },
        { messageId: "inlineMember", data: { factory: "createGoogleAdsSearch", member: "pause" } }
      ]
    },
    {
      code: "function createAccountStore({ table }) {\n  return Object.freeze({\n    async findById(id) { return table().where({ id }).first(); }\n  });\n}",
      errors: [{ messageId: "inlineMember", data: { factory: "createAccountStore", member: "findById" } }]
    },
    {
      code: "function createLearningAccess() {\n  function activeMembers() { return []; }\n  function actorFromOptions(options) { return options.context.actor; }\n  return { activeMembers, actorFromOptions };\n}",
      errors: [{ messageId: "unfrozenResult", data: { factory: "createLearningAccess" } }]
    },
    {
      code: "const createRepository = ({ knex }) => Object.freeze({ withTransaction: (work) => knex.transaction(work) });",
      errors: [{ messageId: "inlineMember", data: { factory: "createRepository", member: "withTransaction" } }]
    },
    {
      code: "function createHostContextRegistry({ sessions }) {\n  return {\n    get size() { return sessions.size; }\n  };\n}",
      errors: [{ messageId: "unfrozenResult" }]
    }
  ]
});
