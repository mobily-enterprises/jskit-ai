import { DATA_ACCESS_GUIDE_URL, compactText, keyName, ruleMeta } from "../support.js";
import { calledMethod, literalText } from "../dataAccess.js";

// The Knex filters a hand-written workspace predicate goes through.
const WHERE_METHODS = new Set([
  "where",
  "andWhere",
  "orWhere",
  "whereNot",
  "andWhereNot",
  "orWhereNot",
  "whereIn",
  "orWhereIn",
  "whereNotIn",
  "orWhereNotIn",
  "whereNull",
  "orWhereNull",
  "whereNotNull",
  "orWhereNotNull"
]);
// workspace_id, or one table's: receivals.workspace_id.
const WORKSPACE_COLUMN = /^(?:[\w$]+\.)?workspace_id$/u;

// A column name the source writes as workspace_id: a literal, or a template that ends with it (`${table}.workspace_id`).
function isWorkspaceColumn(node) {
  const text = literalText(node);
  if (text !== null) {
    return WORKSPACE_COLUMN.test(text);
  }
  return node?.type === "TemplateLiteral" && /(?:^|\.)workspace_id$/u.test(node.quasis.at(-1).value.cooked ?? "");
}

// The workspace predicate belongs to the table resource's ownership, which adds it to every statement the handle runs.
// A hand-written one is the one a query forgets.
const noHandScope = Object.freeze({
  meta: ruleMeta("Disallow filtering by workspace by hand.", {
    handScope: "{{method}}({{column}}) filters by workspace by hand. The table resource's ownership adds the workspace to every statement its handle runs, joins, includes and locks included; drop this filter and pass the call's options."
  }, "layer-1-the-table-resource", DATA_ACCESS_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        const method = calledMethod(node);
        const [first] = node.arguments;
        if (!method || !WHERE_METHODS.has(method.name)) {
          return;
        }
        if (isWorkspaceColumn(first)) {
          context.report({ node: first, messageId: "handScope", data: { method: method.name, column: compactText(sourceCode, first) } });
          return;
        }
        for (const property of first?.type === "ObjectExpression" ? first.properties : []) {
          if (property.type === "Property" && !property.computed && WORKSPACE_COLUMN.test(String(keyName(property)))) {
            context.report({ node: property, messageId: "handScope", data: { method: method.name, column: compactText(sourceCode, property.key) } });
          }
        }
      }
    };
  }
});

export { noHandScope };
