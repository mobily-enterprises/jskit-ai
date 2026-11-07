import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noHandScope } from "../plugin/rules/noHandScope.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-hand-scope", noHandScope, {
  valid: [
    "query.where(\"status\", \"open\").whereIn(\"lotId\", ids).whereNull(\"settledAt\");",
    "query.where({ status: \"open\", lotId });",
    "query.where(\"workspace_name\", name).where(\"r.previous_workspace_id\", id);",
    "export const receivalResource = defineTableResource({ name: \"receivals\", tableName: \"receivals\", ownership: \"workspace\" });",
    "const schema = { workspaceId: { type: \"id\", storage: { column: \"workspace_id\" } } };",
    "query.where({ [column]: value });"
  ],
  invalid: [
    {
      code: "query.where(\"workspace_id\", workspaceId);",
      errors: [{ messageId: "handScope", data: { method: "where", column: "\"workspace_id\"" } }]
    },
    {
      code: "query.andWhere(\"receivals.workspace_id\", id).orWhere(\"r.workspace_id\", \"=\", id);",
      errors: [{ messageId: "handScope", data: { method: "andWhere", column: "\"receivals.workspace_id\"" } }, { messageId: "handScope", data: { method: "orWhere", column: "\"r.workspace_id\"" } }]
    },
    {
      code: "query.where(`${table}.workspace_id`, id).whereIn(`workspace_id`, ids);",
      errors: [{ messageId: "handScope" }, { messageId: "handScope" }]
    },
    {
      code: "query.whereNull(\"workspace_id\").whereNot(\"workspace_id\", id).whereNotIn(\"pets.workspace_id\", ids);",
      errors: [{ messageId: "handScope" }, { messageId: "handScope" }, { messageId: "handScope" }]
    },
    {
      code: "query.where({ workspace_id: id, status: \"open\" }).andWhere({ \"r.workspace_id\": id });",
      errors: [
        { messageId: "handScope", data: { method: "where", column: "workspace_id" } },
        { messageId: "handScope", data: { method: "andWhere", column: "\"r.workspace_id\"" } }
      ]
    },
    {
      code: "function yoursOrShared({ query, context }) {\n  query.where((q) => q.where(\"rooms.workspace_id\", context.workspaceId).orWhereNull(\"rooms.workspace_id\"));\n  return true;\n}",
      errors: [{ messageId: "handScope", line: 2 }, { messageId: "handScope", line: 2 }]
    },
    {
      code: "// readable-check: allow no-hand-scope - safety invariant: the row policy needs the workspace\nquery.where(\"workspace_id\", id);",
      errors: [{ messageId: "handScope" }]
    }
  ]
});
