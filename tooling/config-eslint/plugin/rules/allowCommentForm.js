import { DATA_ACCESS_GUIDE_URL, ruleMeta } from "../support.js";

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
  /^cross-repository slot \S/u,
  /^shared resource: \S/u,
  /^infrastructure: \S/u
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
// The data-access rules. A module whose job is data access itself (a migration runner, test databases, protocol state)
// is excused from the first two as a whole, by an `infrastructure:` comment in its first lines, before any code. No
// other rule takes that prefix, and the other four data-access rules take no excuse at all.
const INFRASTRUCTURE_RULES = new Set(["no-direct-knex", "no-transaction-reader"]);
const UNEXCUSABLE_RULES = new Set(["sql-literal", "no-hand-scope", "no-hand-context", "knex-reason"]);
const INFRASTRUCTURE_PREFIX = /^infrastructure:/u;

/**
 * The rule or finding and the reason of one "readable-check: allow <rule> - <reason>" text, or null when it is not in
 * that form.
 * @param {string} text
 */
function readAllow(text) {
  const match = ALLOW_FORM.exec(text);
  return match ? { rule: match[1], reason: match[2] } : null;
}

/**
 * What is wrong with an exception's reason, as a message id of jskit/allow-comment-form, or "" for a good reason: it
 * starts with a fixed prefix and says what is true of the code, never its tests or the state of a project.
 * @param {string} reason
 */
function reasonProblem(reason) {
  if (RETIRED_PREFIX.test(reason)) {
    return "retiredPrefix";
  }
  if (!REASON_PREFIXES.some((prefix) => prefix.test(reason))) {
    return "allowPrefix";
  }
  if (CITES_TESTS.test(reason)) {
    return "citesTests";
  }
  return CITES_STATUS.test(reason) || MARKER.test(reason) ? "citesStatus" : "";
}

/**
 * Whether one comment line excuses a whole file from a data-access rule as infrastructure: it names the rule, and its
 * reason starts with `infrastructure:` and passes jskit/allow-comment-form. Only a comment before the file's first
 * token counts; the caller selects those.
 * @param {string} line
 * @param {string} ruleName The rule's name without the plugin, such as "no-direct-knex".
 */
function isInfrastructureExcuse(line, ruleName) {
  const allow = readAllow(line);
  return Boolean(allow) && (allow.rule === ruleName || allow.rule === `jskit/${ruleName}`) &&
    INFRASTRUCTURE_PREFIX.test(allow.reason) && !reasonProblem(allow.reason);
}

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

// Each line of a comment that carries an allow mark, with its position; `opening` is the length of the comment's
// opening mark (`//` or `/*`, or a template's `<!--`).
function allowLines(comment, opening = 2) {
  return comment.value.split(/\r?\n/u).flatMap((text, index) => {
    const column = text.indexOf(ALLOW_MARK);
    if (column < 0 || PLACEHOLDER.test(text)) {
      return [];
    }
    const line = comment.loc.start.line + index;
    const startColumn = index === 0 ? comment.loc.start.column + opening + column : column;
    const body = text.slice(column).trimEnd();
    return [{ body, loc: { start: { line, column: startColumn }, end: { line, column: startColumn + body.length } } }];
  });
}

// What is wrong with a data-access rule's exception, or "": the four rules no comment excuses, and the infrastructure
// excuse anywhere but a whole data-access file's first lines.
function dataAccessProblem(rule, reason, inHeader) {
  const name = rule.replace(/^jskit\//u, "");
  if (UNEXCUSABLE_RULES.has(name)) {
    return "dataAccessUnexcusable";
  }
  const infrastructure = INFRASTRUCTURE_PREFIX.test(reason);
  if (!infrastructure && !INFRASTRUCTURE_RULES.has(name)) {
    return "";
  }
  return infrastructure && INFRASTRUCTURE_RULES.has(name) && inHeader ? "" : "infrastructureExcuse";
}

// Every "readable-check: allow <rule> - <reason>" comment names a rule or
// finding, then a reason that starts with one of the fixed prefixes and says
// what is true of the code; a component template's HTML comments are read too.
const allowCommentForm = Object.freeze({
  meta: ruleMeta("Require readable-check allow comments to give a reason with a fixed prefix that describes the code.", {
    allowForm: "Write the exception as \"readable-check: allow <rule> - <reason>\".",
    allowPrefix: "\"{{reason}}\" starts with no reason prefix. Start it with input validation:, data:, platform object:, optional operation:, safety invariant:, not a slot:, cycle: <supplier> requires <owner>, deferred until boot:, filled by <repository>; convert with its supplier, cross-repository slot <token>, shared resource:, or (for a data-access infrastructure module) infrastructure:.",
    retiredPrefix: "\"{{reason}}\" uses the retired test asserts error:. Say what goes wrong without the guard under safety invariant: <what goes wrong>, or remove the guard.",
    citesTests: "\"{{reason}}\" cites tests. Describe the code; a guard that protects an internal invariant says what goes wrong without it under safety invariant:.",
    citesStatus: "\"{{reason}}\" cites the state of a project. Describe what is true of the code.",
    dataOnFunction: "\"{{reason}}\" excuses a function with data:, which is only for data. Give the function's real reason, or remove its duplicate.",
    dataAccessUnexcusable: `{{rule}} takes no exception; change the code (${DATA_ACCESS_GUIDE_URL}#hard-rules).`,
    infrastructureExcuse: "The infrastructure exception excuses a whole file from no-direct-knex or no-transaction-reader, and nothing else: " +
      "\"readable-check: allow no-direct-knex - infrastructure: <what the module is>\", one line per rule, in the file's first lines, " +
      `before any code (${DATA_ACCESS_GUIDE_URL}#hard-rules).`
  }, "exceptions"),
  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const firstToken = sourceCode.ast.tokens[0];
        const templateComments = (sourceCode.ast.templateBody?.comments || [])
          .filter((comment) => comment.type === "HTMLComment")
          .map((comment) => ({ comment, opening: 4 }));
        const scriptComments = sourceCode.getAllComments().map((comment) => ({ comment, opening: 2 }));
        for (const { comment, opening } of [...scriptComments, ...templateComments]) {
          const inHeader = opening === 2 && (!firstToken || comment.range[1] <= firstToken.range[0]);
          for (const { body, loc } of allowLines(comment, opening)) {
            const allow = readAllow(body);
            const reason = allow?.reason || "";
            const data = { reason: reason.length > 60 ? `${reason.slice(0, 57)}...` : reason, rule: allow?.rule || "" };
            const problem = allow ? dataAccessProblem(allow.rule, reason, inHeader) || reasonProblem(reason) : "allowForm";
            if (problem) {
              context.report({ loc, messageId: problem, data });
            } else if (DATA_PREFIX.test(reason) && !PARAMETER_RULES.has(allow.rule) && opening === 2) {
              const node = excusedNode(sourceCode, comment);
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

export { allowCommentForm, isInfrastructureExcuse, reasonProblem };
