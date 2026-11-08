// Shared by the data-access rules: the resource is the only door to a table. Each rule reports one shape a reader can
// see in the file's own syntax; aliasing Knex (`const q = knex; q("t")`) escapes them, and the guide's check-and-judge
// list covers it. Only no-direct-knex, no-transaction-reader, no-hand-scope and sql-literal take an exception, and only
// for a whole file whose job is data access itself: "// readable-check: allow <rule> - infrastructure: <what the module is>" before
// its first line of code. jskit/allow-comment-form checks that comment's reason as it checks every other.

import { isInfrastructureExcuse } from "./rules/allowCommentForm.js";
import { unwrapChain } from "./support.js";

// The names a Knex instance or a transaction goes by: called with a table name, each one starts a query.
const KNEX_NAMES = new Set(["knex", "trx", "db", "database", "client", "tx", "transaction"]);

/**
 * The text of a string literal or of a template without expressions, or null for any other node.
 * @param {any} node
 */
function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0].value.cooked ?? "" : null;
}

/**
 * Whether a node is written text: a string literal or a template, with or without expressions.
 * @param {any} node
 */
function isText(node) {
  return literalText(node) !== null || node?.type === "TemplateLiteral";
}

/**
 * The last name of an expression: `a` for `a`, `b` for `a.b` or `a?.b`; "" for any other node.
 * @param {any} node
 */
function lastName(node) {
  const value = unwrapChain(node);
  if (value?.type === "Identifier") {
    return value.name;
  }
  return value?.type === "MemberExpression" && !value.computed ? value.property.name : "";
}

/**
 * The method a call calls: "where" for `q.where(...)` and `q?.where(...)`, with the object it is called on; null for a
 * call of anything else.
 * @param {any} node A CallExpression.
 */
function calledMethod(node) {
  const callee = unwrapChain(node.callee);
  return callee.type === "MemberExpression" && !callee.computed ? { name: callee.property.name, object: callee.object } : null;
}

/**
 * Whether a member expression is written to rather than read: the target of an assignment.
 * @param {any} node
 */
function isAssignmentTarget(node) {
  return node.parent?.type === "AssignmentExpression" && node.parent.left === node;
}

/**
 * Whether the file's first lines, before any code, excuse it from a rule as an infrastructure module.
 * @param {any} context
 * @param {string} ruleName The rule's name without the plugin, such as "no-direct-knex".
 */
function isInfrastructureFile(context, ruleName) {
  const sourceCode = context.sourceCode;
  const firstToken = sourceCode.ast.tokens[0];
  return sourceCode.getAllComments()
    .filter((comment) => !firstToken || comment.range[1] <= firstToken.range[0])
    .some((comment) => comment.value.split(/\r?\n/u).some((line) => isInfrastructureExcuse(line, ruleName)));
}

// The closing sentence of the two excusable rules' messages: which modules the infrastructure exception is for, the
// same list as the guide's Exceptions.
const INFRASTRUCTURE_HINT = "Only a module whose job is data access itself (a database runtime, a migration runner, " +
  "test-database setup, an operator's data import or cutover tool, a console that runs the person's own SQL) takes the " +
  "infrastructure exception, as a whole file.";

export { INFRASTRUCTURE_HINT, KNEX_NAMES, calledMethod, isAssignmentTarget, isInfrastructureFile, isText, lastName, literalText };
