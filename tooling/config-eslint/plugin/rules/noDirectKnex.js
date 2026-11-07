import { DATA_ACCESS_GUIDE_URL, compactText, ruleMeta, unwrapChain } from "../support.js";
import {
  KNEX_NAMES,
  calledMethod,
  infrastructureHint,
  isAssignmentTarget,
  isInfrastructureFile,
  isText,
  lastName
} from "../dataAccess.js";

// The Knex methods that take a table name first; a literal there names a table outside its resource.
const TABLE_METHODS = new Set([
  "from",
  "table",
  "into",
  "join",
  "innerJoin",
  "leftJoin",
  "leftOuterJoin",
  "rightJoin",
  "rightOuterJoin",
  "fullOuterJoin",
  "outerJoin",
  "crossJoin"
]);
// What a transaction is opened on by hand: `knex.transaction(`, `db.transaction(`, `database.transaction(`.
const TRANSACTION_OWNERS = new Set(["knex", "db", "database"]);
const DOOR = "Every read and write goes through the table owner's resource handle; a report the resource cannot express starts from the owner's scopedQuery().";
const HINT = infrastructureHint("no-direct-knex");

// A callee that names a Knex instance or transaction: `knex`, `trx`, or a branch of `trx || knex`, `a ? trx : knex`.
function namesKnex(node) {
  const value = unwrapChain(node);
  if (value?.type === "Identifier") {
    return KNEX_NAMES.has(value.name);
  }
  if (value?.type === "LogicalExpression") {
    return namesKnex(value.left) || namesKnex(value.right);
  }
  return value?.type === "ConditionalExpression" && (namesKnex(value.consequent) || namesKnex(value.alternate));
}

// The unambiguous Knex names: a call of one is a table builder whatever names its table.
const BUILDER_NAMES = new Set(["knex", "trx"]);
// A table named through a variable or a property: `MODELS_TABLE`, `tableName`, `tables.messages`, `config.usersTable`.
const TABLE_NAME = /table/iu;

// Whether a callee is `knex` or `trx`, or a branch of `trx || knex`, `a ? trx : knex`.
function namesBuilder(node) {
  const value = unwrapChain(node);
  if (value?.type === "Identifier") {
    return BUILDER_NAMES.has(value.name);
  }
  if (value?.type === "LogicalExpression") {
    return namesBuilder(value.left) || namesBuilder(value.right);
  }
  return value?.type === "ConditionalExpression" && (namesBuilder(value.consequent) || namesBuilder(value.alternate));
}

function isReference(node) {
  return node?.type === "Identifier" || node?.type === "MemberExpression" || node?.type === "TemplateLiteral";
}

/**
 * Whether the first argument of a Knex-named call names a table: a literal; for `knex(...)` and `trx(...)` any
 * variable, property or template; for the other Knex names (db, client, ...) a variable or property whose name says
 * table, since `client(model)` and `transaction(saved)` are other libraries' calls.
 * @param {import("estree").Node} callee
 * @param {import("estree").Node | undefined} first
 */
function namesTable(callee, first) {
  if (isText(first)) {
    return true;
  }
  if (!isReference(first)) {
    return false;
  }
  return namesBuilder(callee) || (first.type !== "TemplateLiteral" && TABLE_NAME.test(lastName(first)));
}

// A call of another library's method of the same name: a class's static method (Buffer.from("…"), Array.from("…")),
// console.table, a path module's join("a", "b") and an array's join(", ").
function isOtherLibrary(method, object, args) {
  const name = lastName(object);
  if (/^[A-Z]/u.test(name) || name === "console") {
    return true;
  }
  return method === "join" && (args.length < 2 || /path|^posix$|^win32$/iu.test(name));
}

// Knex reached past the resource: a table builder called with a table name (`knex("t")`, `(trx || knex)("t")`,
// `knex(tables.messages)`, `client(MODELS_TABLE)`), a
// `.knex` read, a transaction opened by hand, and a literal table name given to from, table, into or a join.
const noDirectKnex = Object.freeze({
  meta: ruleMeta("Disallow reaching a table with Knex past its resource.", {
    tableBuilder: `{{text}}(...) starts a query on a table by name, outside its resource. ${DOOR} ${HINT}`,
    knexMember: `{{text}} reaches Knex past the resource. ${DOOR} ${HINT}`,
    handTransaction: `{{text}}() opens a transaction by hand. Open it with the handle's withTransaction(options, work) and pass its txOptions on. ${HINT}`,
    literalTable: `.{{method}}({{table}}) names a table outside its resource. ${DOOR} A row policy reads its owner's own tables through ownTable(). ${HINT}`
  }, "the-resource-is-the-only-door", DATA_ACCESS_GUIDE_URL),
  create(context) {
    if (isInfrastructureFile(context, "no-direct-knex")) {
      return {};
    }
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        const [first] = node.arguments;
        if (namesKnex(node.callee) && namesTable(node.callee, first)) {
          context.report({ node, messageId: "tableBuilder", data: { text: compactText(sourceCode, node.callee) } });
          return;
        }
        const method = calledMethod(node);
        if (!method) {
          return;
        }
        const owner = lastName(method.object);
        const ownerIsKnexRead = owner === "knex" && unwrapChain(method.object).type === "MemberExpression";
        if (method.name === "transaction" && TRANSACTION_OWNERS.has(owner) && !ownerIsKnexRead) {
          context.report({ node, messageId: "handTransaction", data: { text: compactText(sourceCode, node.callee) } });
        } else if (TABLE_METHODS.has(method.name) && isText(first) && !isOtherLibrary(method.name, method.object, node.arguments)) {
          context.report({ node: first, messageId: "literalTable", data: { method: method.name, table: compactText(sourceCode, first) } });
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.name === "knex" && !isAssignmentTarget(node)) {
          context.report({ node, messageId: "knexMember", data: { text: compactText(sourceCode, node) } });
        }
      }
    };
  }
});

export { noDirectKnex };
