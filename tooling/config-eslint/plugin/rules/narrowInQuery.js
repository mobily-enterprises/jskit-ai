import { compactText, createReporter, keyName, ruleMeta, unwrapAwait, unwrapChain } from "../support.js";
import { KNEX_NAMES, calledMethod, literalText } from "../dataAccess.js";

// A read asks the store for exactly the rows the code uses: the filter, sort, limit, existence check and count go in the
// read, never in code over what it answered. This rule follows, within one function, the rows an awaited read answers
// (a handle's query(), queryAll() and queryPages(), json-rest-api's api.resources.<name>.query(), a Knex builder) and
// reports where code narrows them. A read of every row then narrowed is slow; a page or a capped read then narrowed is
// also wrong, since a wanted row past the page is never seen.

// The array methods that narrow rows in code: a filter, a lookup, an existence test, a cut.
const NARROWING_METHODS = new Set(["filter", "find", "findLast", "findIndex", "findLastIndex", "some", "every", "slice"]);
// The keys of a page read's answer that hold its rows: a handle's `{ records, page }`, json-rest-api's `{ data, meta }`.
const ROWS_KEYS = new Set(["records", "data"]);
// Knex calls whose answer is no list of rows: a write, one row, a total.
const NOT_ROWS = new Set([
  "first", "insert", "update", "del", "delete", "increment", "decrement", "truncate", "upsert", "merge",
  "count", "countDistinct", "sum", "sumDistinct", "avg", "avgDistinct", "min", "max"
]);
// The handle calls that hand back a scoped Knex builder, as `{ query }`.
const BUILDER_CALLS = new Set(["scopedQuery", "joinSource"]);
const EXCUSE = /readable-check: allow (?:jskit\/)?narrow-in-query - /u;
const STATEMENTS = new Set(["VariableDeclaration", "ExpressionStatement", "ReturnStatement", "ForOfStatement", "IfStatement"]);

// The property of an object literal by key, or undefined; null when the literal spreads, so its keys are not all known.
function literalProperty(object, key) {
  if (object?.type !== "ObjectExpression") {
    return null;
  }
  if (object.properties.some((property) => property.type === "SpreadElement")) {
    return null;
  }
  return object.properties.find((property) => keyName(property) === key);
}

// The object literal a value is written as, directly or as a const the module or function declares with one.
function objectLiteral(sourceCode, node) {
  if (node?.type === "ObjectExpression") {
    return node;
  }
  if (node?.type !== "Identifier") {
    return null;
  }
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const definition = scope.set.get(node.name)?.defs[0];
    if (definition) {
      const init = definition.type === "Variable" && definition.parent.kind === "const" ? definition.node.init : null;
      // `const FIRST = Object.freeze({ size: 1 })` holds its literal too.
      const frozen = init?.type === "CallExpression" && init.callee.type === "MemberExpression" &&
        init.callee.object.name === "Object" && init.callee.property.name === "freeze" ? init.arguments[0] : init;
      return frozen?.type === "ObjectExpression" ? frozen : null;
    }
  }
  return null;
}

// The number a property of an object literal holds, written as a numeric literal, or null.
function literalNumber(object, key) {
  const value = literalProperty(object, key)?.value;
  return value?.type === "Literal" && typeof value.value === "number" ? value.value : null;
}

// How far a query()'s params let it read, as { bound, size }: bound "unpaged" when its params, an object literal (or
// json-rest-api's queryParams in one), name no page, and "page" otherwise, including params the file does not spell
// out; size the page size when it is written as a number.
function pageBound(sourceCode, params) {
  if (params === undefined) {
    return { bound: "unpaged", size: null };
  }
  const queryParams = literalProperty(params, "queryParams");
  const holder = queryParams?.value?.type === "ObjectExpression" ? queryParams.value : params;
  const page = literalProperty(holder, "page");
  if (page === undefined) {
    return { bound: "unpaged", size: null };
  }
  return { bound: "page", size: literalNumber(objectLiteral(sourceCode, page?.value), "size") };
}

// The Knex builder chain a call ends, as { root, methods }, or null: `knex("tasks").where(...).select(...)` gives the
// root call `knex("tasks")` and the methods where, select.
function builderChain(node) {
  const methods = [];
  let current = unwrapChain(node);
  while (current?.type === "CallExpression") {
    const method = calledMethod(current);
    if (!method) {
      return { root: current, methods };
    }
    methods.unshift(method.name);
    current = unwrapChain(method.object);
  }
  return { root: current, methods };
}

// Whether the call `back` links before the end of a builder chain is `.limit(1)`.
function limitOfOne(end, back) {
  let call = unwrapChain(end);
  for (let step = 0; step < back; step += 1) {
    call = unwrapChain(calledMethod(call).object);
  }
  const count = call.arguments[0];
  return count?.type === "Literal" && count.value === 1;
}

/**
 * Whether an identifier holds a scoped Knex builder: destructured as `query` from an awaited scopedQuery() or
 * joinSource() (`const { query } = await tasks.scopedQuery(params, options)`).
 * @param {any} sourceCode
 * @param {any} identifier
 */
function isScopedBuilder(sourceCode, identifier) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (!variable) {
      continue;
    }
    const definition = variable.defs[0];
    const declarator = definition?.type === "Variable" ? definition.node : null;
    const call = unwrapAwait(declarator?.init);
    const property = declarator?.id.type === "ObjectPattern" &&
      declarator.id.properties.find((entry) => entry.type === "Property" && entry.value === definition.name);
    return Boolean(property && keyName(property) === "query" && call?.type === "CallExpression" &&
      BUILDER_CALLS.has(calledMethod(call)?.name));
  }
  return false;
}

/**
 * The read an awaited call makes, as { kind, bound, single, text }, or null for any other call. `kind` is "rows" when
 * the read answers the rows themselves (queryAll(), a Knex builder) and "page" when it answers them in `records` or
 * `data` (query()). `bound` is "every" for a read of every matching row, "page" for a page or a capped read, and
 * "unpaged" for a query() whose params name no page size, which answers only a default-capped page. `single` is true
 * for a read of at most one row: a page of size 1, `take: 1`, `.limit(1)`.
 * @param {any} sourceCode
 * @param {any} call
 */
function readOf(sourceCode, call) {
  const node = unwrapChain(call);
  if (node?.type !== "CallExpression") {
    return null;
  }
  const method = calledMethod(node);
  const first = node.arguments[0];
  if (method?.name === "queryAll") {
    const take = literalProperty(first, "take");
    return {
      kind: "rows",
      bound: take === undefined ? "every" : "page",
      single: literalNumber(first, "take") === 1,
      text: `${compactText(sourceCode, method.object)}.queryAll()`
    };
  }
  if (method?.name === "query" && literalText(first) === null && first?.type !== "TemplateLiteral") {
    const { bound, size } = pageBound(sourceCode, first);
    return { kind: "page", bound, single: size === 1, text: `${compactText(sourceCode, method.object)}.query()` };
  }
  const { root, methods } = builderChain(node);
  if (methods.length < 1 || methods.some((name) => NOT_ROWS.has(name))) {
    return null;
  }
  // `knex("tasks")...`, `knex.select(...).from("tasks")`, or a scoped builder's `query...`.
  const knexRoot = root?.type === "CallExpression" && root.callee.type === "Identifier" && KNEX_NAMES.has(root.callee.name) &&
    root.arguments.length > 0;
  const knexFrom = root?.type === "Identifier" && KNEX_NAMES.has(root.name) && methods.some((name) => name === "from" || name === "table");
  const scopedRoot = root?.type === "Identifier" && isScopedBuilder(sourceCode, root);
  if (!knexRoot && !knexFrom && !scopedRoot) {
    return null;
  }
  const limit = methods.lastIndexOf("limit");
  const single = limit >= 0 && limitOfOne(node, methods.length - 1 - limit);
  return { kind: "rows", bound: limit >= 0 ? "page" : "every", single, text: "the Knex query" };
}

// Whether an expression's value is read only for its length: `rows.length`.
function isLengthRead(expression) {
  const parent = expression.parent;
  return parent?.type === "MemberExpression" && parent.object === expression && !parent.computed && parent.property.name === "length";
}

// Whether an expression is read for the rows of a page: `page.records` or `page.data`.
function isRowsMember(expression) {
  const parent = expression.parent;
  return parent?.type === "MemberExpression" && parent.object === expression && !parent.computed && ROWS_KEYS.has(parent.property.name);
}

// The line of the statement a read stands in, where a comment above excuses everything the code does with its rows.
function statementLine(node) {
  let current = node;
  while (current.parent && !STATEMENTS.has(current.type)) {
    current = current.parent;
  }
  return current.loc.start.line;
}

// The narrowing messages, one per kind of read, each saying what to do instead.
const PUT_IN_READ = "Put the filter, sort, limit, existence check or count in the read: a searchSchema filter (a field, " +
  "an id list, q), queryAll's take, a page of size 1, or aggregate() for a count.";

const narrowInQuery = Object.freeze({
  meta: ruleMeta("Report rows a read answered that code then narrows, instead of asking the store for exactly those rows.", {
    narrowsEvery: `{{use}} narrows in code what {{read}} read: the store sends every matching row and the code drops the rest. ${PUT_IN_READ}`,
    narrowsPage: `{{use}} narrows in code what {{read}} read, a page or a capped read: a wanted row past it is never seen, so the answer turns wrong as the table grows. ${PUT_IN_READ}`,
    narrowsDefaultPage: `{{use}} narrows in code what {{read}} read, which names no page size or limit and so answers only a default-capped page: every row past it is silently missing, and the answer is wrong once the table outgrows that page. ${PUT_IN_READ}`
  }, "narrow-in-the-query"),
  create(context) {
    const sourceCode = context.sourceCode;
    const lines = sourceCode.lines;
    const reportFinding = createReporter(context, "narrow-in-query");
    const messages = { every: "narrowsEvery", page: "narrowsPage", unpaged: "narrowsDefaultPage" };

    function report(node, use, read) {
      const line = read.line;
      if (line > 1 && EXCUSE.test(lines[line - 2])) {
        return;
      }
      reportFinding(node, "narrow-in-query", messages[read.bound], { use, read: read.text });
    }

    // A loop over rows that skips some with `if (...) continue;` filters them in code.
    function checkLoop(loop, read) {
      const body = loop.body.type === "BlockStatement" ? loop.body.body : [loop.body];
      const label = loop.parent?.type === "LabeledStatement" ? loop.parent.label.name : "";
      const skips = (statement) => statement?.type === "ContinueStatement" && (!statement.label || statement.label.name === label);
      for (const statement of body) {
        const consequent = statement.type === "IfStatement" ? statement.consequent : null;
        if (skips(consequent) || (consequent?.type === "BlockStatement" && consequent.body.length === 1 && skips(consequent.body[0]))) {
          report(statement, "A loop that skips rows with continue", read);
        }
      }
    }

    // What code does with an expression that holds a read's rows.
    function checkRows(expression, read, lengthOnly) {
      const parent = expression.parent;
      if (parent?.type === "ForOfStatement" && parent.right === expression) {
        checkLoop(parent, read);
        return;
      }
      if (parent?.type !== "MemberExpression" || parent.object !== expression || parent.computed) {
        return;
      }
      const name = parent.property.name;
      if (NARROWING_METHODS.has(name) && parent.parent?.type === "CallExpression" && parent.parent.callee === parent) {
        report(parent.parent, `.${name}()`, read);
      } else if (name === "length" && lengthOnly && !read.single) {
        // The length of a read of one row (a page of size 1, take: 1, limit(1)) is an existence test done right.
        report(parent, "Its .length alone (a count or an existence test)", read);
      }
    }

    // Every read of a variable that holds a read's rows; one read only for its length is a count or an existence test.
    function checkRowsVariable(variable, read) {
      const uses = variable.references.filter((reference) => reference.isRead()).map((reference) => reference.identifier);
      const lengthOnly = uses.length > 0 && uses.every(isLengthRead);
      for (const use of uses) {
        checkRows(use, read, lengthOnly);
      }
    }

    // The rows of a page read: `page.records` and `page.data`, read, destructured or held.
    function checkPageValue(expression, read) {
      const parent = expression.parent;
      if (isRowsMember(expression)) {
        checkValue(parent, { ...read, kind: "rows" });
      } else if (parent?.type === "VariableDeclarator" && parent.init === expression) {
        if (parent.id.type === "Identifier") {
          for (const variable of sourceCode.getDeclaredVariables(parent)) {
            const uses = variable.references.filter((entry) => entry.isRead()).map((entry) => entry.identifier);
            // `page.records` read only for its length, however many times, is a count or an existence test.
            const rows = uses.filter(isRowsMember).map((use) => use.parent);
            const lengthOnly = rows.length > 0 && rows.every(isLengthRead);
            for (const use of uses) {
              if (isRowsMember(use) && use.parent.parent?.type === "VariableDeclarator") {
                checkValue(use.parent, { ...read, kind: "rows" });
              } else if (isRowsMember(use)) {
                checkRows(use.parent, { ...read, kind: "rows" }, lengthOnly);
              } else {
                checkPageValue(use, read);
              }
            }
          }
          return;
        }
        for (const variable of sourceCode.getDeclaredVariables(parent)) {
          const property = parent.id.type === "ObjectPattern" &&
            parent.id.properties.find((entry) => entry.type === "Property" && (entry.value === variable.identifiers[0] ||
              (entry.value.type === "AssignmentPattern" && entry.value.left === variable.identifiers[0])));
          if (property && ROWS_KEYS.has(keyName(property))) {
            checkRowsVariable(variable, read);
          }
        }
      }
    }

    // A read's value where it stands: held in a variable, destructured, or used at once.
    function checkValue(expression, read) {
      if (read.kind === "page") {
        checkPageValue(expression, read);
        return;
      }
      const parent = expression.parent;
      if (parent?.type === "VariableDeclarator" && parent.init === expression) {
        // `const [first] = rows` takes the first row, which a unique filter or a size-1 page already narrowed.
        if (parent.id.type === "Identifier") {
          sourceCode.getDeclaredVariables(parent).forEach((variable) => checkRowsVariable(variable, read));
        }
        return;
      }
      checkRows(expression, read, isLengthRead(expression));
    }

    return {
      AwaitExpression(node) {
        const read = readOf(sourceCode, node.argument);
        if (read) {
          checkValue(node, { ...read, line: statementLine(node) });
        }
      },
      // `for await (const records of handle.queryPages(...))`: each page's records, every matching row in all.
      ForOfStatement(node) {
        const call = unwrapChain(node.right);
        const method = node.await && call?.type === "CallExpression" ? calledMethod(call) : null;
        if (method?.name !== "queryPages" || node.left.type !== "VariableDeclaration") {
          return;
        }
        const read = { kind: "rows", bound: "every", text: `${compactText(sourceCode, method.object)}.queryPages()`, line: node.loc.start.line };
        sourceCode.getDeclaredVariables(node.left.declarations[0]).forEach((variable) => checkRowsVariable(variable, read));
      }
    };
  }
});

export { narrowInQuery };
