import { ruleMeta } from "../support.js";

// Line comments that configure a tool rather than describe the code below.
const DIRECTIVE = /^\s*(?:eslint(?:-disable|-enable)?\b|globals?\b|exported\b|@ts-|istanbul\b|c8\b|prettier-ignore\b|readable-check:|#(?:end)?region\b)/u;

function startsItsLine(lines, comment) {
  return lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column).trim() === "";
}

// A JSDoc block holds its own description: a `//` line comment directly above
// a `/** */` block says what the block should say.
const jsdocDescriptionInside = Object.freeze({
  meta: ruleMeta("Require a JSDoc block's description inside the block, not in a line comment above it.", {
    descriptionOutside: "This // comment describes the JSDoc block below it. Move the description inside the /** */ block."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const lines = sourceCode.lines;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        comments.forEach((block, index) => {
          if (block.type !== "Block" || !block.value.startsWith("*") || !startsItsLine(lines, block)) {
            return;
          }
          let first = null;
          let last = null;
          for (let previous = index - 1, line = block.loc.start.line - 1; previous >= 0; previous -= 1, line -= 1) {
            const comment = comments[previous];
            if (comment.type !== "Line" || comment.loc.end.line !== line || !startsItsLine(lines, comment) || DIRECTIVE.test(comment.value)) {
              break;
            }
            first = comment;
            last ||= comment;
          }
          if (first) {
            context.report({ loc: { start: first.loc.start, end: last.loc.end }, messageId: "descriptionOutside" });
          }
        });
      }
    };
  }
});

export { jsdocDescriptionInside };
