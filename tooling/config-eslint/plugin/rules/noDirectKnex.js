import { DATA_ACCESS_GUIDE_URL, compactText, keyName, ruleMeta, unwrapChain } from "../support.js";
import {
  INFRASTRUCTURE_HINT,
  KNEX_NAMES,
  calledMethod,
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
// A table named through a variable or property for one of them: its name says table or name (`PETS_TABLE`, `name`,
// `owners.tableName`), or its object's says table (`tables.lots`). Any other reference is judged by the const it reads
// (`const target = "pets"`); a join of another table's scopedQuery() subquery, or a variable holding one, is scoped.
const TABLE_REFERENCE = /table|name$/iu;
const TABLES_OBJECT = /table/iu;
// The Knex methods whose function argument builds a subquery (`whereIn("id", (sub) => sub.from(...))`): the builder it
// receives is Knex's own, unscoped, so a table it names by any variable that holds no subquery reads past its owner.
const SUBQUERY_METHODS = /^(?:(?:and|or)?where(?:Not)?(?:In|Exists)?|(?:or)?having(?:Not)?(?:In|Exists)?|union(?:All)?|intersect|except|with(?:Recursive|Materialized|NotMaterialized)?|from)$/u;
// What a transaction is opened on by hand: `knex.transaction(`, `db.transaction(`, `database.transaction(`.
const TRANSACTION_OWNERS = new Set(["knex", "db", "database"]);
const DOOR = "Every read and write goes through the table owner's resource handle; a report the resource cannot express starts from the owner's scopedQuery().";
const HINT = INFRASTRUCTURE_HINT;

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

// A table name written as text: a literal, a template (one with `${}` builds the name from an expression, which reaches
// whatever table it names as much as a literal does), or text joined to an expression with `+` (`prefix + "_items"`).
function isTableText(node) {
  if (isText(node)) {
    return true;
  }
  return node?.type === "BinaryExpression" && node.operator === "+" && (isTableText(node.left) || isTableText(node.right));
}

/**
 * Whether the first argument of a Knex-named call names a table: text (see isTableText); for `knex(...)` and `trx(...)` any
 * variable, property or template; for the other Knex names (db, client, ...) a variable or property whose name says
 * table, since `client(model)` and `transaction(saved)` are other libraries' calls.
 * @param {import("estree").Node} callee
 * @param {import("estree").Node | undefined} first
 */
function namesTable(callee, first) {
  if (isTableText(first)) {
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

// The value a const (or a variable written once) is given where it is declared; undefined for anything else, such as a
// parameter or an import.
function declaredValue(sourceCode, identifier) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      const [definition] = variable.defs;
      const writes = variable.references.filter((reference) => reference.isWrite()).length;
      return variable.defs.length === 1 && definition.type === "Variable" && definition.node.id.type === "Identifier" &&
        definition.node.init && writes <= 1 ? definition.node.init : undefined;
    }
  }
  return undefined;
}

// Whether a node passed to a function is a subquery callback: its call is one of SUBQUERY_METHODS.
function isSubqueryCallback(fn) {
  const call = fn.parent;
  const method = call?.type === "CallExpression" && call.arguments.includes(fn) ? calledMethod(call) : null;
  return Boolean(method && SUBQUERY_METHODS.test(method.name));
}

// Whether a node stands in a subquery callback's own body (not in a function nested inside it).
function inSubqueryCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") {
      return isSubqueryCallback(current);
    }
    if (current.type === "FunctionDeclaration") {
      return false;
    }
  }
  return false;
}

/**
 * Whether the first argument of from, table, into or a join names a table: text (see isTableText); an alias object with
 * one (`{ p: "projects" }`, `{ p: PROJECTS_TABLE }`); a variable or property whose name says table or name, or whose
 * object's says table; or a const that holds one of these. In a subquery callback (`strict`), any other variable but one
 * holding a builder (a scopedQuery() subquery) names a table too.
 * @param {import("eslint").SourceCode} sourceCode
 * @param {import("estree").Node | undefined} first
 * @param {boolean} strict
 * @param {number} [depth] How many consts deep the value was followed.
 */
function namesTableArgument(sourceCode, first, strict, depth = 0) {
  const value = unwrapChain(first);
  if (isTableText(value)) {
    return true;
  }
  if (value?.type === "ObjectExpression") {
    return value.properties.some((property) => property.type === "Property" && namesTableArgument(sourceCode, property.value, false, depth));
  }
  if (value?.type !== "Identifier" && value?.type !== "MemberExpression") {
    return false;
  }
  if (TABLE_REFERENCE.test(lastName(value)) || (value.type === "MemberExpression" && TABLES_OBJECT.test(lastName(value.object)))) {
    return true;
  }
  const declared = value.type === "Identifier" && depth < 3 ? declaredValue(sourceCode, value) : undefined;
  if (declared) {
    return namesTableArgument(sourceCode, declared, false, depth + 1);
  }
  return strict && value.type === "Identifier";
}

// Whether a knex(...) or trx(...) call's first argument is an alias object naming a table (`knex({ p: "projects" })`),
// not a connection's settings (`knex({ client, connection })`).
function aliasesTable(sourceCode, callee, first) {
  const isSettings = first.properties.some((property) => property.type === "Property" && keyName(property) === "client");
  return namesBuilder(callee) && !isSettings && namesTableArgument(sourceCode, first, false);
}

// Knex reached past the resource: a table builder called with a table name (`knex("t")`, `(trx || knex)("t")`,
// `knex(tables.messages)`, `client(MODELS_TABLE)`, `knex({ p: "projects" })`), a `.knex` read or a `knex` destructured
// (`const { knex: q } = database`), a transaction opened by hand, and a table named to from, table, into or a join
// (see namesTableArgument), in a scopedQuery() report and in a subquery callback alike.
const noDirectKnex = Object.freeze({
  meta: ruleMeta("Disallow reaching a table with Knex past its resource.", {
    tableBuilder: `{{text}}(...) starts a query on a table by name, outside its resource. ${DOOR} ${HINT}`,
    knexMember: `{{text}} reaches Knex past the resource. ${DOOR} ${HINT}`,
    knexDestructured: `{ {{text}} } takes Knex out of an object, past the resource. ${DOOR} ${HINT}`,
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
        const aliased = first?.type === "ObjectExpression" && aliasesTable(sourceCode, node.callee, first);
        if (namesKnex(node.callee) && (aliased || namesTable(node.callee, first))) {
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
        } else if (TABLE_METHODS.has(method.name) && !isOtherLibrary(method.name, method.object, node.arguments) &&
          namesTableArgument(sourceCode, first, inSubqueryCallback(node))) {
          context.report({ node: first, messageId: "literalTable", data: { method: method.name, table: compactText(sourceCode, first) } });
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.name === "knex" && !isAssignmentTarget(node)) {
          context.report({ node, messageId: "knexMember", data: { text: compactText(sourceCode, node) } });
        }
      },
      Property(node) {
        if (node.parent.type === "ObjectPattern" && !node.computed && keyName(node) === "knex") {
          context.report({ node, messageId: "knexDestructured", data: { text: compactText(sourceCode, node) } });
        }
      }
    };
  }
});

export { noDirectKnex };
