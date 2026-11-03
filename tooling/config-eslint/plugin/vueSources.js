// What the client rules read from a Vue component or a client module: the names Vue's functions are imported under,
// the <script setup> block, and the JSDoc type next to a node.

/**
 * The local names a module imports from "vue" for the given exports, such as inject or ref.
 * @param {any} program
 * @param {ReadonlySet<string>} exported
 */
function vueImportNames(program, exported) {
  return new Set(program.body
    .filter((statement) => statement.type === "ImportDeclaration" && statement.source.value === "vue")
    .flatMap((statement) => statement.specifiers)
    .filter((specifier) => specifier.type === "ImportSpecifier" && exported.has(specifier.imported.name || specifier.imported.value))
    .map((specifier) => specifier.local.name));
}

/**
 * The source ranges of a component's <script setup> blocks, whose top-level bindings belong to each instance; empty
 * for a plain module.
 * @param {any} sourceCode
 * @returns {Array<[number, number]>}
 */
function scriptSetupRanges(sourceCode) {
  const parserServices = sourceCode.parserServices;
  // readable-check: allow method-probe - platform object: only vue-eslint-parser gives a component's document fragment
  const fragment = typeof parserServices?.getDocumentFragment === "function" ? parserServices.getDocumentFragment() : null;
  return (fragment?.children || [])
    .filter((element) => element.type === "VElement" && element.name === "script" &&
      element.startTag.attributes.some((attribute) => !attribute.directive && attribute.key.name === "setup"))
    .map((element) => element.range);
}

/**
 * Whether a JSDoc block holding one of the tags ends on one of the two lines before a node.
 * @param {any} sourceCode
 * @param {any} node
 * @param {RegExp} tag
 */
function hasJsdocBefore(sourceCode, node, tag) {
  const line = node.loc.start.line;
  return sourceCode.getAllComments().some((comment) => comment.type === "Block" && comment.value.startsWith("*") &&
    comment.loc.end.line < line && comment.loc.end.line >= line - 2 && tag.test(comment.value));
}

/**
 * Whether a node is wrapped in a JSDoc type cast: `/** @type {X} *\/ (node)`.
 * @param {any} sourceCode
 * @param {any} node
 */
function hasTypeCast(sourceCode, node) {
  const open = sourceCode.getTokenBefore(node);
  if (open?.value !== "(") {
    return false;
  }
  const comment = sourceCode.getTokenBefore(open, { includeComments: true });
  return comment?.type === "Block" && comment.value.startsWith("*") && /@type\s*\{/u.test(comment.value);
}

export { hasJsdocBefore, hasTypeCast, scriptSetupRanges, vueImportNames };
