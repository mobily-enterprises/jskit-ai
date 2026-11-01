import { ruleMeta } from "../support.js";

const ALLOW_MARK = "readable-check: allow";
const ALLOW_FORM = /readable-check: allow (\S+) - (.+?)\s*$/u;

// A comment that describes the vocabulary itself names its rule as a
// placeholder: "readable-check: allow <rule> - <reason>".
const PLACEHOLDER = /readable-check: allow <[^>]+>/u;

// The fixed reason prefixes, each followed by what is true of the code.
const REASON_PREFIXES = Object.freeze([
  /^input validation: \S/u,
  /^data: \S/u,
  /^platform object: \S/u,
  /^optional operation: \S/u,
  /^safety invariant: \S/u,
  /^not a slot: \S/u,
  /^cycle: \S.* requires \S/u,
  /^deferred until boot: \S/u,
  /^filled by \S.*; convert with its supplier/u,
  /^cross-repository slot \S/u
]);
// A guard once kept because a test asserted its error now says what goes wrong
// without it, under safety invariant:.
const RETIRED_PREFIX = /^test asserts error:/u;

// A reason describes the code, never its tests or the state of a project.
const CITES_TESTS = /\b(tests?|testing|test doubles?|mock(?:s|ed)?|stub(?:s|bed)?|fixtures?|spies|spy)\b|\.test\./iu;
const PROJECT_WORK = "(?:converted|ported|migrated|typed|moved|split|removed|fixed)";
const CITES_STATUS = new RegExp(`\\b(?:not (?:yet )?${PROJECT_WORK}|un(?:converted|ported|migrated)|stays? unchanged|left as is|for now|later pass|` +
  `until (?:\\S+ ){1,3}(?:is|are) ${PROJECT_WORK}|pending (?:conversion|review|migration)|still pending|is pending|project status)\\b`, "iu");
const MARKER = /\b(?:TODO|FIXME|XXX)\b/u;
// data: excuses a field or value that is data, never a function. A parameter default is excused at its function,
// so the default rules' data: reasons may stand on one.
const DATA_PREFIX = /^data: /u;
const PARAMETER_RULES = new Set(["dependency-default", "required-collaborators"]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * Whether a node is a function, or declares or holds one: a function or arrow, an exported function, a variable
 * initialised with one, or a property, class field or method whose value is one.
 * @param {any} node
 */
function holdsFunction(node) {
  if (FUNCTION_TYPES.has(node.type)) {
    return true;
  }
  if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
    return Boolean(node.declaration) && holdsFunction(node.declaration);
  }
  if (node.type === "VariableDeclaration") {
    return node.declarations.some((declarator) => declarator.init && FUNCTION_TYPES.has(declarator.init.type));
  }
  if (node.type === "Property" || node.type === "PropertyDefinition" || node.type === "MethodDefinition") {
    return Boolean(node.value) && FUNCTION_TYPES.has(node.value.type);
  }
  return false;
}

/**
 * The construct a comment on its own line excuses: the outermost node that starts at the next token. Null for a
 * comment that trails code on its line or ends the file.
 * @param {any} sourceCode
 * @param {any} comment
 */
function excusedNode(sourceCode, comment) {
  const before = sourceCode.getTokenBefore(comment, { includeComments: true });
  if (before && before.loc.end.line === comment.loc.start.line) {
    return null;
  }
  const next = sourceCode.getTokenAfter(comment, { includeComments: false });
  if (!next) {
    return null;
  }
  let node = sourceCode.getNodeByRangeIndex(next.range[0]);
  while (node?.parent && node.parent.type !== "Program" && node.parent.range[0] === next.range[0]) {
    node = node.parent;
  }
  return node;
}

// Each line of a comment that carries an allow mark, with its position.
function allowLines(comment) {
  return comment.value.split(/\r?\n/u).flatMap((text, index) => {
    const column = text.indexOf(ALLOW_MARK);
    if (column < 0 || PLACEHOLDER.test(text)) {
      return [];
    }
    const line = comment.loc.start.line + index;
    const startColumn = index === 0 ? comment.loc.start.column + 2 + column : column;
    const body = text.slice(column).trimEnd();
    return [{ body, loc: { start: { line, column: startColumn }, end: { line, column: startColumn + body.length } } }];
  });
}

// Every "readable-check: allow <rule> - <reason>" comment names a rule or
// finding, then a reason that starts with one of the fixed prefixes and says
// what is true of the code.
const allowCommentForm = Object.freeze({
  meta: ruleMeta("Require readable-check allow comments to give a reason with a fixed prefix that describes the code.", {
    allowForm: "Write the exception as \"readable-check: allow <rule> - <reason>\".",
    allowPrefix: "\"{{reason}}\" starts with no reason prefix. Start it with input validation:, data:, platform object:, optional operation:, safety invariant:, not a slot:, cycle: <supplier> requires <owner>, deferred until boot:, filled by <repository>; convert with its supplier, or cross-repository slot <token>.",
    retiredPrefix: "\"{{reason}}\" uses the retired test asserts error:. Say what goes wrong without the guard under safety invariant: <what goes wrong>, or remove the guard.",
    citesTests: "\"{{reason}}\" cites tests. Describe the code; a guard that protects an internal invariant says what goes wrong without it under safety invariant:.",
    citesStatus: "\"{{reason}}\" cites the state of a project. Describe what is true of the code.",
    dataOnFunction: "\"{{reason}}\" excuses a function with data:, which is only for data. Give the function's real reason, or remove its duplicate."
  }),
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const { body, loc } of allowLines(comment)) {
            const match = ALLOW_FORM.exec(body);
            const reason = match?.[2] || "";
            const data = { reason: reason.length > 60 ? `${reason.slice(0, 57)}...` : reason };
            if (!match) {
              context.report({ loc, messageId: "allowForm" });
            } else if (RETIRED_PREFIX.test(reason)) {
              context.report({ loc, messageId: "retiredPrefix", data });
            } else if (!REASON_PREFIXES.some((prefix) => prefix.test(reason))) {
              context.report({ loc, messageId: "allowPrefix", data });
            } else if (CITES_TESTS.test(reason)) {
              context.report({ loc, messageId: "citesTests", data });
            } else if (CITES_STATUS.test(reason) || MARKER.test(reason)) {
              context.report({ loc, messageId: "citesStatus", data });
            } else if (DATA_PREFIX.test(reason) && !PARAMETER_RULES.has(match[1])) {
              const node = excusedNode(context.sourceCode, comment);
              if (node && holdsFunction(node)) {
                context.report({ loc, messageId: "dataOnFunction", data });
              }
            }
          }
        }
      }
    };
  }
});

export { allowCommentForm };
