import { compactText, createReporter, keyName, ruleMeta, unwrapAwait, unwrapChain } from "../support.js";
import { KNEX_NAMES, calledMethod, literalText } from "../dataAccess.js";

// A read asks the store for exactly the rows the code uses: the filter, sort, limit, existence check and count go in the
// read, never in code over what it answered. This rule follows, within one function, the rows an awaited read answers
// (a handle's query(), queryAll() and queryPages(), json-rest-api's api.resources.<name>.query(), a Knex builder) and
// reports where code narrows them. A read of every row then narrowed is slow; a page or a capped read then narrowed is
// also wrong, since a wanted row past the page is never seen. Code that needs every row it read narrows nothing: rows
// also handed on whole (returned, passed, stored, mapped or walked in full) with a subset derived beside them, rows
// matched against something else in a loop or a callback (an in-memory join or grouping, which saves a read per item),
// a read of at most one row, and the `.slice()` of a read that asks for one row more than it keeps to learn whether
// more follow.

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
// The array methods whose answer keeps every row: mapped, walked, folded, sorted, joined.
const WHOLE_METHODS = new Set([
  "map", "flatMap", "forEach", "reduce", "reduceRight", "sort", "toSorted", "reverse", "toReversed", "concat", "entries",
  "values", "keys", "join"
]);
// Where an expression is handed on whole: returned, passed, stored in an object or array, spread or yielded.
const HANDED_ON = new Set([
  "ReturnStatement", "CallExpression", "NewExpression", "Property", "ArrayExpression", "SpreadElement",
  "ArrowFunctionExpression", "YieldExpression", "AssignmentExpression"
]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

// The property of an object literal by key, or undefined; null when a spread may set it, so it is not known: the literal
// spreads and writes no such key after its last spread (`{ ...params, page: { size: 1 } }` still sets page).
function literalProperty(object, key) {
  if (object?.type !== "ObjectExpression") {
    return null;
  }
  const lastSpread = object.properties.findLastIndex((property) => property.type === "SpreadElement");
  const index = object.properties.findLastIndex((property) => property.type === "Property" && keyName(property) === key);
  if (index < lastSpread) {
    return null;
  }
  return index < 0 ? undefined : object.properties[index];
}

// A read's params as written: the object literal itself, or the one a wrapper call takes first, which hands it on with
// more set (`query(forViewer({ filters, page: { size: 1 } }, options))`).
function paramsLiteral(node) {
  return node?.type === "CallExpression" && node.arguments[0]?.type === "ObjectExpression" ? node.arguments[0] : node;
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

// Whether a count is written as one more than another (`size + 1`): a read that asks for one row more than it keeps,
// to learn whether more follow.
function isOneMore(node) {
  return node?.type === "BinaryExpression" && node.operator === "+" && node.right.type === "Literal" && node.right.value === 1;
}

// How far a query()'s params let it read, as { bound, size, peek }: bound "unpaged" when its params, an object literal
// (or json-rest-api's queryParams in one), name no page, and "page" otherwise, including params the file does not spell
// out; size the page size when it is written as a number; peek when the size is written as one more than another.
function pageBound(sourceCode, params) {
  if (params === undefined) {
    return { bound: "unpaged", size: null, peek: false };
  }
  const written = paramsLiteral(params);
  const queryParams = literalProperty(written, "queryParams");
  const holder = queryParams?.value?.type === "ObjectExpression" ? queryParams.value : written;
  const page = literalProperty(holder, "page");
  if (page === undefined) {
    return { bound: "unpaged", size: null, peek: false };
  }
  const pageObject = objectLiteral(sourceCode, page?.value);
  return { bound: "page", size: literalNumber(pageObject, "size"), peek: isOneMore(literalProperty(pageObject, "size")?.value) };
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

// The count the call `back` links before the end of a builder chain gives: `.limit(1)` gives the literal 1.
function limitCount(end, back) {
  let call = unwrapChain(end);
  for (let step = 0; step < back; step += 1) {
    call = unwrapChain(calledMethod(call).object);
  }
  return call.arguments[0];
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
 * The read an awaited call makes, as { kind, bound, single, peek, text }, or null for any other call. `kind` is "rows"
 * when the read answers the rows themselves (queryAll(), a Knex builder) and "page" when it answers them in `records` or
 * `data` (query()). `bound` is "every" for a read of every matching row, "page" for a page or a capped read, and
 * "unpaged" for a query() whose params name no page size, which answers only a default-capped page. `single` is true
 * for a read of at most one row: a page of size 1, `take: 1`, `.limit(1)`. `peek` is true for a read that asks for one
 * row more than it keeps (`take: size + 1`, `.limit(size + 1)`, a page of `size + 1`).
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
    const params = paramsLiteral(first);
    const take = literalProperty(params, "take");
    return {
      kind: "rows",
      bound: take === undefined ? "every" : "page",
      single: literalNumber(params, "take") === 1,
      peek: isOneMore(take?.value),
      text: `${compactText(sourceCode, method.object)}.queryAll()`
    };
  }
  if (method?.name === "query" && literalText(first) === null && first?.type !== "TemplateLiteral") {
    const { bound, size, peek } = pageBound(sourceCode, first);
    return { kind: "page", bound, single: size === 1, peek, text: `${compactText(sourceCode, method.object)}.query()` };
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
  const count = limit >= 0 ? limitCount(node, methods.length - 1 - limit) : null;
  const single = count?.type === "Literal" && count.value === 1;
  return { kind: "rows", bound: limit >= 0 ? "page" : "every", single, peek: isOneMore(count), text: "the Knex query" };
}

// Whether an expression is read for the rows of a page: `page.records` or `page.data`.
function isRowsMember(expression) {
  const parent = expression.parent;
  return parent?.type === "MemberExpression" && parent.object === expression && !parent.computed && ROWS_KEYS.has(parent.property.name);
}

/**
 * What code does with an expression that holds a read's rows: "narrow" (a narrowing method called on them), "length",
 * "loop" (a for...of over them), "whole" (a method whose answer keeps every row, or the rows handed on: returned,
 * passed, stored, spread), or "other" (an index, a comparison).
 * @param {any} expression
 */
function useOf(expression) {
  const parent = expression.parent;
  if (parent?.type === "ForOfStatement" && parent.right === expression) {
    return "loop";
  }
  if (parent?.type === "MemberExpression" && parent.object === expression) {
    if (parent.computed) {
      return "other";
    }
    const called = parent.parent?.type === "CallExpression" && parent.parent.callee === parent;
    if (parent.property.name === "length") {
      return "length";
    }
    if (called && NARROWING_METHODS.has(parent.property.name)) {
      return "narrow";
    }
    return called && WHOLE_METHODS.has(parent.property.name) ? "whole" : "other";
  }
  if (parent?.type === "CallExpression" || parent?.type === "NewExpression") {
    return parent.callee === expression ? "other" : "whole";
  }
  if (parent?.type === "AssignmentExpression" || parent?.type === "Property") {
    return parent.right === expression || parent.value === expression ? "whole" : "other";
  }
  return HANDED_ON.has(parent?.type) ? "whole" : "other";
}

/**
 * Whether code at a node runs again for each item of something else: a loop or a function (a callback) stands between it
 * and the read, so the rows are matched against other items (an in-memory join or grouping), not narrowed once.
 * @param {any} node
 * @param {any} readNode The read: its await, or the for await...of over queryPages().
 */
function repeatsPerItem(node, readNode) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.range[0] <= readNode.range[0] && readNode.range[1] <= current.range[1]) {
      return false;
    }
    if (LOOPS.has(current.type) || FUNCTIONS.has(current.type)) {
      return true;
    }
  }
  return false;
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

    // The statements of a loop over rows that skip some with `if (...) continue;` before the loop does anything with
    // every row: they filter the rows in code.
    function loopSkips(loop) {
      const body = loop.body.type === "BlockStatement" ? loop.body.body : [loop.body];
      const label = loop.parent?.type === "LabeledStatement" ? loop.parent.label.name : "";
      const skips = (statement) => statement?.type === "ContinueStatement" && (!statement.label || statement.label.name === label);
      const found = [];
      for (const statement of body) {
        const consequent = statement.type === "IfStatement" && !statement.alternate ? statement.consequent : null;
        if (skips(consequent) || (consequent?.type === "BlockStatement" && consequent.body.length === 1 && skips(consequent.body[0]))) {
          found.push(statement);
        } else if (statement.type !== "VariableDeclaration") {
          break;
        }
      }
      return found;
    }

    /**
     * Judges every expression that holds one read's rows together. Rows also used whole, a read of at most one row, and
     * narrowing that runs once per item of something else narrow nothing; otherwise each narrowing is reported, and a
     * length read alone is a count or an existence test.
     * @param {any[]} uses
     * @param {any} read
     * @param {boolean} [handedOn] The page that holds the rows is handed on whole.
     */
    function judge(uses, read, handedOn = false) {
      const kinds = uses.map((use) => ({ use, kind: useOf(use) }));
      const loops = kinds.filter(({ kind }) => kind === "loop").map(({ use }) => ({ loop: use.parent, skips: loopSkips(use.parent) }));
      if (handedOn || read.single || kinds.some(({ kind }) => kind === "whole") || loops.some(({ skips }) => skips.length === 0)) {
        return;
      }
      const lengthOnly = kinds.every(({ kind }) => kind === "length");
      for (const { use, kind } of kinds) {
        const name = use.parent.property?.name;
        if (kind === "narrow" && !repeatsPerItem(use.parent.parent, read.node) && !(name === "slice" && read.peek)) {
          report(use.parent.parent, `.${name}()`, read);
        } else if (kind === "length" && lengthOnly) {
          report(use.parent, "Its .length alone (a count or an existence test)", read);
        }
      }
      for (const { loop, skips } of loops) {
        if (!repeatsPerItem(loop, read.node)) {
          skips.forEach((statement) => report(statement, "A loop that skips rows with continue", read));
        }
      }
    }

    const readsOf = (variable) => variable.references.filter((reference) => reference.isRead()).map((reference) => reference.identifier);

    // The rows of a page read: `page.records` and `page.data`, read, destructured or held.
    function checkPageValue(expression, read) {
      const parent = expression.parent;
      const rowsRead = { ...read, kind: "rows" };
      if (isRowsMember(expression)) {
        checkValue(parent, rowsRead);
        return;
      }
      if (parent?.type !== "VariableDeclarator" || parent.init !== expression) {
        return;
      }
      for (const variable of sourceCode.getDeclaredVariables(parent)) {
        if (parent.id.type === "Identifier") {
          const rows = [];
          let handedOn = false;
          for (const use of readsOf(variable)) {
            if (isRowsMember(use) && use.parent.parent?.type === "VariableDeclarator" && use.parent.parent.init === use.parent) {
              checkValue(use.parent, rowsRead);
            } else if (isRowsMember(use)) {
              rows.push(use.parent);
            } else if (use.parent?.type === "VariableDeclarator" && use.parent.init === use) {
              checkPageValue(use, read);
            } else {
              handedOn ||= useOf(use) === "whole";
            }
          }
          judge(rows, rowsRead, handedOn);
          continue;
        }
        const property = parent.id.type === "ObjectPattern" &&
          parent.id.properties.find((entry) => entry.type === "Property" && (entry.value === variable.identifiers[0] ||
            (entry.value.type === "AssignmentPattern" && entry.value.left === variable.identifiers[0])));
        if (property && ROWS_KEYS.has(keyName(property))) {
          judge(readsOf(variable), rowsRead);
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
          sourceCode.getDeclaredVariables(parent).forEach((variable) => judge(readsOf(variable), read));
        }
        return;
      }
      judge([expression], read);
    }

    return {
      AwaitExpression(node) {
        const read = readOf(sourceCode, node.argument);
        if (read) {
          checkValue(node, { ...read, node, line: statementLine(node) });
        }
      },
      // `for await (const records of handle.queryPages(...))`: each page's records, every matching row in all.
      ForOfStatement(node) {
        const call = unwrapChain(node.right);
        const method = node.await && call?.type === "CallExpression" ? calledMethod(call) : null;
        if (method?.name !== "queryPages" || node.left.type !== "VariableDeclaration") {
          return;
        }
        const read = {
          kind: "rows",
          bound: "every",
          single: false,
          peek: false,
          text: `${compactText(sourceCode, method.object)}.queryPages()`,
          node,
          line: node.loc.start.line
        };
        sourceCode.getDeclaredVariables(node.left.declarations[0]).forEach((variable) => judge(readsOf(variable), read));
      }
    };
  }
});

export { narrowInQuery };
