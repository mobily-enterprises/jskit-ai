import { createReporter, isFreezeCall, keyName, ruleMeta } from "../support.js";

const DEFINITION_CALLS = new Set(["defineFeature", "defineProvider"]);
const TOKEN_MAPS = new Set(["requires", "optional", "provides"]);

function calleeName(call) {
  if (call.callee.type === "Identifier") {
    return call.callee.name;
  }
  return call.callee.type === "MemberExpression" ? call.callee.property.name || "" : "";
}

/**
 * Where an object literal must hold one property per line, named for the message, or "" elsewhere: the frozen
 * object a return statement returns, and a feature's or provider's requires, optional and provides maps.
 * @param {import("estree").ObjectExpression & { parent?: any }} object
 */
function checkedPlace(object) {
  const parent = object.parent;
  if (isFreezeCall(parent) && parent.arguments[0] === object) {
    return parent.parent?.type === "ReturnStatement" ? "A frozen result" : "";
  }
  if (parent?.type !== "Property" || parent.value !== object || parent.computed || !TOKEN_MAPS.has(keyName(parent))) {
    return "";
  }
  const definition = parent.parent;
  const call = definition.parent;
  const defined = call?.type === "CallExpression" && call.arguments[0] === definition && DEFINITION_CALLS.has(calleeName(call));
  return defined ? `The ${keyName(parent)} map of ${calleeName(call)}()` : "";
}

/**
 * The fix that breaks after `{`, after each `,` and before `}` wherever the next token shares the line, indenting
 * each property two spaces past the line the object starts on; null when the object holds a comment, which the fix
 * would move.
 */
function splitObjectLines(sourceCode, object) {
  if (sourceCode.getCommentsInside(object).length > 0) {
    return null;
  }
  const indent = /^\s*/u.exec(sourceCode.lines[object.loc.start.line - 1])[0];
  const closing = sourceCode.getLastToken(object);
  const breaks = [];
  let left = sourceCode.getFirstToken(object);
  for (const property of object.properties) {
    breaks.push([left, sourceCode.getFirstToken(property), `${indent}  `]);
    const after = sourceCode.getTokenAfter(property);
    left = after.value === "," ? after : sourceCode.getLastToken(property);
  }
  breaks.push([left, closing, indent]);
  return (fixer) => breaks
    .filter(([before, next]) => before.loc.end.line === next.loc.start.line)
    .map(([before, next, lineIndent]) => fixer.replaceTextRange([before.range[1], next.range[0]], `\n${lineIndent}`));
}

// One property per line where a reader scans a list: a frozen result names each member a caller receives, and a
// feature's token maps each capability it requires, may use or provides. Short leaf literals elsewhere stay legal.
const onePropertyPerLine = Object.freeze({
  meta: {
    ...ruleMeta("Require one property per line in frozen results and in feature and provider token maps.", {
      sharedLine: "{{place}} has two properties on line {{line}}. Put each property on its own line."
    }),
    fixable: "whitespace"
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "one-property-per-line");
    return {
      ObjectExpression(node) {
        if (node.properties.length < 2) {
          return;
        }
        const place = checkedPlace(node);
        const shared = place ? node.properties.find((property, index) => index > 0 &&
          property.loc.start.line === node.properties[index - 1].loc.end.line) : null;
        if (!shared) {
          return;
        }
        report(node, "one-property-per-line", "sharedLine", { place, line: shared.loc.start.line },
          splitObjectLines(sourceCode, node));
      }
    };
  }
});

export { onePropertyPerLine };
