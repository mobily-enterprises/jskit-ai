import {
  ABSENT_DEFAULT,
  compactText,
  createReporter,
  factoryDependencies,
  isClientLint,
  isFactory,
  receivingFunction,
  ruleMeta,
  unwrapChain,
  walk
} from "../support.js";

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
// A received name that says it is a collaborator, so `x?.method()` on it probes a collaborator, not data.
const COLLABORATOR_NAME = /(service|store|repository|runtime|router|publisher|catalogue|registry|provider|manager|client|broker|gateway|resolver|engine|logger)$/iu;

// The positional parameters a create*/build* factory or constructor calls, or calls a method on, with a default:
// `function createReader(store, logger = null)`.
function positionalCollaboratorDefaults(fn, visitorKeys) {
  const defaults = fn.params.filter((parameter) => parameter.type === "AssignmentPattern" && parameter.left.type === "Identifier");
  if (!defaults.length) {
    return [];
  }
  const called = new Set();
  walk(fn.body, visitorKeys, (node) => {
    if (node.type !== "CallExpression") {
      return;
    }
    const callee = node.callee.type === "MemberExpression" ? node.callee.object : node.callee;
    if (callee.type === "Identifier") {
      called.add(callee.name);
    }
  });
  return defaults.filter((parameter) => called.has(parameter.left.name) || FUNCTION_TYPES.has(parameter.right.type));
}

// Collaborators are required: no absent default, no `typeof x.y === "function"`
// probe and no `x?.y?.()` call. A received value is not probed either: no
// `received?.()`, no `receivedService?.method()`, and no `typeof x === "function"`
// on a collaborator a factory receives.
// The capability runtime already refuses to start without a required token.
// In client code use* composables count as factories, and a component's
// template is held to the same probes and optional calls as its script.
const requiredCollaborators = Object.freeze({
  meta: ruleMeta("Require collaborators instead of defaulting, probing or optionally calling them.", {
    dependenciesDefault: "{{name}}'s dependencies default to {{fallback}}, which hides a missing collaborator. Require them.",
    collaboratorDefault: "{{name}} = {{fallback}} makes a collaborator absent. Require it.",
    methodProbe: "typeof {{probe}} probes a collaborator. Require it and call it.",
    optionalCall: "{{callee}}?.() calls a collaborator that may be absent. Require it and call it.",
    optionalLink: "{{callee}}() calls a collaborator that may be absent. Require it and call it."
  }, "required-collaborators"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "required-collaborators");
    const client = isClientLint(context);
    function checkDefaults(fn) {
      const dependencies = factoryDependencies(fn, sourceCode, client);
      if (isFactory(fn, client)) {
        for (const parameter of positionalCollaboratorDefaults(fn, sourceCode.visitorKeys)) {
          const fallback = compactText(sourceCode, parameter.right);
          if (parameter !== dependencies?.first && ABSENT_DEFAULT.test(fallback)) {
            report(parameter, "dependency-default", "collaboratorDefault", { name: parameter.left.name, fallback: fallback.slice(0, 40) });
          }
        }
      }
      if (!dependencies) {
        return;
      }
      const { first, pattern, collaborators } = dependencies;
      // `= {}` on the whole object is fine when every property has its own
      // default (an options bag); otherwise it hides a missing collaborator.
      const everyPropertyDefaulted = pattern.properties.every((property) => property.type === "Property" && property.value.type === "AssignmentPattern");
      if (first.type === "AssignmentPattern" && !everyPropertyDefaulted) {
        report(first, "dependency-default", "dependenciesDefault", { name: dependencies.name, fallback: sourceCode.getText(first.right) });
      }
      for (const property of pattern.properties) {
        if (property.type !== "Property" || property.value.type !== "AssignmentPattern" || property.value.left.type !== "Identifier") {
          continue;
        }
        const local = property.value.left.name;
        if (!collaborators.has(local) && !FUNCTION_TYPES.has(property.value.right.type)) {
          continue;
        }
        const fallback = compactText(sourceCode, property.value.right);
        if (ABSENT_DEFAULT.test(fallback)) {
          report(property, "dependency-default", "collaboratorDefault", { name: local, fallback: fallback.slice(0, 40) });
        }
      }
    }
    // The `typeof x === "function"` comparison's probed expression, or null.
    function probedArgument(node) {
      if (!["===", "!==", "==", "!="].includes(node.operator)) {
        return null;
      }
      const [probe, literal] = node.left.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
      if (probe?.type !== "UnaryExpression" || probe.operator !== "typeof" || literal?.type !== "Literal" || literal.value !== "function") {
        return null;
      }
      return probe.argument;
    }
    function checkProbe(node) {
      const probed = probedArgument(node);
      const argument = unwrapChain(probed);
      const receiver = argument?.type === "Identifier" ? receivingFunction(context, node, argument.name) : null;
      if (argument?.type === "MemberExpression" || (receiver && isFactory(receiver, client))) {
        report(node, "method-probe", "methodProbe", { probe: sourceCode.getText(probed) });
      }
    }
    // A template has no parameters of its own, so only member probes are read there.
    function checkTemplateProbe(node) {
      const probed = probedArgument(node);
      const argument = unwrapChain(probed);
      if (argument?.type === "MemberExpression") {
        report(node, "method-probe", "methodProbe", { probe: sourceCode.getText(probed) });
      }
    }
    const scriptVisitor = {
      FunctionDeclaration: checkDefaults,
      FunctionExpression: checkDefaults,
      ArrowFunctionExpression: checkDefaults,
      BinaryExpression: checkProbe,
      CallExpression(node) {
        const callee = node.callee;
        const optionalReceived = (identifier) => identifier.type === "Identifier" && Boolean(receivingFunction(context, node, identifier.name));
        if (node.optional && (callee.type === "MemberExpression" || optionalReceived(callee))) {
          report(node, "optional-call", "optionalCall", { callee: sourceCode.getText(callee) });
          return;
        }
        if (callee.type === "MemberExpression" && callee.optional && optionalReceived(callee.object) && COLLABORATOR_NAME.test(callee.object.name)) {
          report(node, "optional-call", "optionalLink", { callee: sourceCode.getText(callee) });
        }
      }
    };
    const parserServices = sourceCode.parserServices;
    // readable-check: allow method-probe - platform object: only vue-eslint-parser gives a component's template a visitor
    if (!client || typeof parserServices?.defineTemplateBodyVisitor !== "function") {
      return scriptVisitor;
    }
    return parserServices.defineTemplateBodyVisitor({
      BinaryExpression: checkTemplateProbe,
      CallExpression(node) {
        if (node.optional && node.callee.type === "MemberExpression") {
          report(node, "optional-call", "optionalCall", { callee: sourceCode.getText(node.callee) });
        }
      }
    }, scriptVisitor);
  }
});

export { requiredCollaborators };
