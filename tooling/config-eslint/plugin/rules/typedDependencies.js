import { createReporter, factoryDependencies, functionSite, ruleMeta } from "../support.js";

// A JSDoc block with a typed @param ends on one of the two lines before the node.
function hasParamJsdoc(sourceCode, node) {
  const line = node.loc.start.line;
  return sourceCode.getAllComments().some((comment) => comment.type === "Block" && comment.value.startsWith("*") &&
    comment.loc.end.line < line && comment.loc.end.line >= line - 2 && /@param\s*\{/u.test(comment.value));
}

// A create*/build* factory or class constructor that receives collaborators
// names their types in a JSDoc @param, so a reader and the code map follow each
// call to its owner.
const typedDependencies = Object.freeze({
  meta: ruleMeta("Require a JSDoc @param type on every factory or constructor that receives collaborators.", {
    untypedDependencies: "{{name}} receives untyped collaborators ({{collaborators}}). Name each owner's type in a JSDoc @param."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "typed-dependencies");
    function check(fn) {
      const dependencies = factoryDependencies(fn, sourceCode);
      if (!dependencies) {
        return;
      }
      const site = functionSite(fn);
      const owner = fn.type === "FunctionDeclaration"
        ? fn
        : sourceCode.getAncestors(fn).findLast((node) => node.type === "VariableDeclaration" || node.type === "ExportNamedDeclaration") || site;
      if (hasParamJsdoc(sourceCode, owner) || hasParamJsdoc(sourceCode, site)) {
        return;
      }
      report(site, "untyped-dependencies", "untypedDependencies", {
        name: dependencies.name || "constructor",
        collaborators: [...dependencies.collaborators].slice(0, 4).join(", ")
      });
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check
    };
  }
});

export { typedDependencies };
