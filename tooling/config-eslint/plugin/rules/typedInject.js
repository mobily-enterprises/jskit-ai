import { ABSENT_DEFAULT, CLIENT_GUIDE_URL, compactText, createReporter, ruleMeta } from "../support.js";
import { hasJsdocBefore, hasTypeCast, vueImportNames } from "../vueSources.js";

const INJECT = new Set(["inject"]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const TYPE_TAG = /@type\s*\{/u;
const RETURNS_TAG = /@returns?\s*\{/u;
// A key owner's named disabled default: `NO_WORKSPACE_SCOPE`.
const NAMED_DISABLED_DEFAULT = /^NO_[A-Z0-9_]+$/u;

/**
 * Whether the value an inject() call resolves names its type: a JSDoc cast around the call, a JSDoc @type on the
 * declaration it initialises, or a JSDoc @returns on the function that holds it (the owner's use<Name>() accessor).
 * @param {any} sourceCode
 * @param {any} call
 */
function isTypedInjection(sourceCode, call) {
  if (hasTypeCast(sourceCode, call)) {
    return true;
  }
  const declarator = call.parent?.type === "VariableDeclarator" && call.parent.init === call ? call.parent : null;
  const declaration = declarator?.parent;
  if (declaration && hasJsdocBefore(sourceCode, declaration.parent?.type === "ExportNamedDeclaration" ? declaration.parent : declaration, TYPE_TAG)) {
    return true;
  }
  const holder = sourceCode.getAncestors(call).findLast((ancestor) => FUNCTION_TYPES.has(ancestor.type));
  if (!holder) {
    return false;
  }
  const owner = holder.type === "FunctionDeclaration"
    ? (holder.parent?.type === "ExportNamedDeclaration" ? holder.parent : holder)
    : sourceCode.getAncestors(holder).findLast((ancestor) => ancestor.type === "VariableDeclaration" || ancestor.type === "ExportNamedDeclaration") || holder;
  return hasJsdocBefore(sourceCode, owner, RETURNS_TAG);
}

// An injected value is a capability lookup: it takes the owner's exported key,
// names its type, and resolves once, either required (`inject(KEY)`) or to the
// owner's named default (`inject(KEY, NO_X)`), never to null or {} that is then
// probed. A consumer that cannot depend on the key's owner writes the key in
// place, typed and with a named NO_* default, as a server token is written.
const typedInject = Object.freeze({
  meta: ruleMeta("Require inject() to take an exported key, name the injected type and never default to nothing.", {
    literalKey: "inject({{key}}) names its key in place. Import the owner's exported key constant.",
    absentDefault: "inject(…, {{fallback}}) resolves to nothing, so every use probes it. Inject it required, or default to the owner's named default.",
    untypedInject: "inject({{key}}) has no type. Name it with a JSDoc @type on the binding, a cast, or the accessor's @returns."
  }, "injected-values", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "typed-inject");
    let injectNames = new Set();
    return {
      Program(program) {
        injectNames = vueImportNames(program, INJECT);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !injectNames.has(node.callee.name) || !node.arguments.length) {
          return;
        }
        const [key, fallback] = node.arguments;
        const keyText = compactText(sourceCode, key).slice(0, 60);
        const literal = (key.type === "Literal" && typeof key.value === "string") || key.type === "TemplateLiteral";
        const typedLookup = fallback?.type === "Identifier" && NAMED_DISABLED_DEFAULT.test(fallback.name) && isTypedInjection(sourceCode, node);
        if (literal && !typedLookup) {
          report(node, "untyped-inject", "literalKey", { key: keyText });
        }
        if (fallback && ABSENT_DEFAULT.test(compactText(sourceCode, fallback))) {
          report(fallback, "inject-default", "absentDefault", { fallback: compactText(sourceCode, fallback).slice(0, 40) });
        }
        if (!isTypedInjection(sourceCode, node)) {
          report(node, "untyped-inject", "untypedInject", { key: keyText });
        }
      }
    };
  }
});

export { typedInject };
