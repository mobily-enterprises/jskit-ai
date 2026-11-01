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
    citesStatus: "\"{{reason}}\" cites the state of a project. Describe what is true of the code."
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
            }
          }
        }
      }
    };
  }
});

export { allowCommentForm };
