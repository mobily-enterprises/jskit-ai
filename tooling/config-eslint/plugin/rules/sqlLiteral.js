import { DATA_ACCESS_GUIDE_URL, compactText, ruleMeta } from "../support.js";
import { calledMethod, isInfrastructureFile, lastName, literalText } from "../dataAccess.js";

// The Knex methods that take SQL text first.
const RAW_METHODS = new Set(["raw", "whereRaw", "orWhereRaw", "havingRaw", "orderByRaw", "groupByRaw", "joinRaw", "fromRaw", "selectRaw"]);
// A Knex placeholder: ? for a value, ?? for an identifier. \? is a question mark.
const PLACEHOLDER = /(?<!\\)\?/u;
// A statement's or a subquery's words. Raw SQL is an expression inside a scoped query, so a statement or a subquery in it
// would reach rows outside the scope. The FROM inside EXTRACT, TRIM, SUBSTRING, OVERLAY and POSITION is an expression's.
const STATEMENT_WORD = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE|INSERT)\b/iu;
const FROM_FUNCTION = /\b(?:EXTRACT|TRIM|SUBSTRING|OVERLAY|POSITION)\s*\([^()]*\)/giu;

function shortText(sourceCode, node) {
  const text = compactText(sourceCode, node);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// SQL is one literal written in the source, and every value and identifier in it is a binding: never text built at run
// time, which is how values and names end up spliced into a statement. In a file the infrastructure exception lifts
// past no-direct-knex, raw SQL runs on Knex itself, not inside a scoped query, so a statement in it is that module's
// job; it is still one literal with its bindings.
const sqlLiteral = Object.freeze({
  meta: ruleMeta("Require raw SQL to be one string literal with its values as bindings.", {
    notLiteral: "{{method}}() takes SQL built at run time ({{text}}). Write the SQL as one string literal and pass every value as a ? binding and every identifier as a ?? binding of column().",
    noBindings: "{{method}}() has placeholders but no bindings. Pass the values as its second argument.",
    statement: "{{method}}() holds {{word}}, a statement or a subquery, which reaches rows outside the scope. Raw SQL is one expression; read other tables through the resource's includes, scopedQuery() or a row policy's ownTable()."
  }, "layer-5-reports-the-resource-cannot-express", DATA_ACCESS_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const onKnex = isInfrastructureFile(context, "no-direct-knex");
    return {
      CallExpression(node) {
        const method = calledMethod(node);
        const [sql, bindings] = node.arguments;
        // String.raw is the template tag, not SQL.
        if (!method || !RAW_METHODS.has(method.name) || lastName(method.object) === "String" || !sql) {
          return;
        }
        const text = literalText(sql);
        if (text === null) {
          context.report({ node: sql, messageId: "notLiteral", data: { method: method.name, text: shortText(sourceCode, sql) } });
        } else if (!bindings && PLACEHOLDER.test(text)) {
          context.report({ node: sql, messageId: "noBindings", data: { method: method.name } });
        } else {
          const word = onKnex ? undefined : text.replace(FROM_FUNCTION, "").match(STATEMENT_WORD)?.[0];
          if (word) {
            context.report({ node: sql, messageId: "statement", data: { method: method.name, word: word.toUpperCase() } });
          }
        }
      }
    };
  }
});

export { sqlLiteral };
