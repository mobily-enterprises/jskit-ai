// Shared by the typed-features rules. Each rule reports what readable-check
// reports under its finding name, and each finding can be excused by a comment
// on the line before it: "// readable-check: allow <finding or rule> - <reason>"
// (in a template, an HTML comment above the element).
// The reason starts with one of these prefixes and says what is true of the
// code, never the state of a project: "input validation:", "data:",
// "platform object:", "optional operation:", "safety invariant:",
// "not a slot:", "cycle: <supplier> requires <owner>",
// "deferred until boot: <reason>",
// "filled by <repository>; convert with its supplier",
// "cross-repository slot <token>" or "shared resource:" (client state every
// instance on the page shares on purpose).

const FACTORY_NAME = /^(create|build)[A-Z]/u;
// In client code a composable (use<Name>) receives its collaborators the way a factory does.
const CLIENT_FACTORY_NAME = /^(create|build|use)[A-Z]/u;

// Whether the lint run is client code: clientFeaturesConfig sets `settings.jskit.client` for the files it selects,
// and the rules that also read composables, components and their module state read it.
function isClientLint(context) {
  return context.settings?.jskit?.client === true;
}

// A factory treats a received name as a collaborator when it calls it, calls a
// method on it, hands it to another create*/build* factory, or passes on one
// whose name says what it is.
const COLLABORATOR_NAME = /(service|store|repository|runtime|router|publisher|catalogue|registry|provider|manager|client|broker|gateway|resolver|engine)$/iu;

// accountPreferencesActions.js, actions.js and user-actions.js hold actions;
// transaction.js does not.
const ACTIONS_FILE = /(?:^|[^A-Za-z])[Aa]ctions?\.m?js$|Actions?\.m?js$/u;

// The probes one comment above a function can excuse for its whole body, and only under `input validation:`: a
// function whose one job is normalizing a documented external value of several shapes.
const PROBE_FINDINGS = new Set(["method-probe", "optional-call"]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const DECLARATION_TYPES = new Set(["VariableDeclarator", "VariableDeclaration", "ExportNamedDeclaration", "ExportDefaultDeclaration", "Property", "MethodDefinition"]);

// The line the nearest function around a node starts on, as a reader sees it: its export, the const that holds it,
// or the function itself; 0 outside a function.
function enclosingFunctionLine(node) {
  let fn = node.parent;
  while (fn && !FUNCTION_TYPES.has(fn.type)) {
    fn = fn.parent;
  }
  let site = fn;
  while (site && DECLARATION_TYPES.has(site.parent?.type)) {
    site = site.parent;
  }
  return site ? site.loc.start.line : 0;
}

// The line a template element starts on, for a node in a component's template; 0 in a script. One HTML comment above
// the element's opening tag excuses its bindings: `<!-- readable-check: allow optional-call - … -->`.
function templateElementLine(node) {
  let element = node.parent;
  while (element && element.type !== "VElement") {
    element = element.parent;
  }
  return element ? element.loc.start.line : 0;
}

function createReporter(context, ruleName) {
  const lines = context.sourceCode.lines;
  const names = [ruleName, `jskit/${ruleName}`];
  // Whether the line before `line` excuses the finding; `reason` narrows the excuse to one reason prefix.
  function allowedAbove(line, finding, reason = "") {
    const previous = line > 1 ? lines[line - 2] : "";
    const mark = reason ? ` - ${reason}` : "";
    return [finding, ...names].some((name) => previous.includes(`readable-check: allow ${name}${mark}`));
  }
  return function report(node, finding, messageId, data, fix = null) {
    if (allowedAbove(node.loc.start.line, finding) || allowedAbove(templateElementLine(node), finding) ||
      (PROBE_FINDINGS.has(finding) && allowedAbove(enclosingFunctionLine(node), finding, "input validation: "))) {
      return;
    }
    context.report({ node, messageId, data, ...(fix ? { fix } : {}) });
  };
}

function walk(node, visitorKeys, visit) {
  visit(node);
  for (const key of visitorKeys[node.type] || []) {
    const value = node[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === "string") {
        walk(child, visitorKeys, visit);
      }
    }
  }
}

function keyName(property) {
  return property?.key?.name || property?.key?.value;
}

// The node a reader sees as the function: a method's property or class member,
// otherwise the function itself.
function functionSite(fn) {
  const parent = fn.parent;
  if (parent?.type === "MethodDefinition" && parent.value === fn) {
    return parent;
  }
  if (parent?.type === "Property" && parent.value === fn && (parent.method || parent.kind === "get" || parent.kind === "set")) {
    return parent;
  }
  return fn;
}

function functionName(fn) {
  if (fn.id?.name) {
    return fn.id.name;
  }
  const site = functionSite(fn);
  if (site !== fn) {
    return site.key?.type === "PrivateIdentifier" ? "" : site.key?.name || "";
  }
  return fn.parent?.type === "VariableDeclarator" ? fn.parent.id?.name || "" : "";
}

function isConstructor(fn) {
  return fn.parent?.type === "MethodDefinition" && fn.parent.kind === "constructor" && fn.parent.value === fn;
}

// An object an action catalogue reads: an action definition (`id` and `execute`).
function isActionDefinition(object) {
  const keys = new Set(object.properties.map(keyName));
  return keys.has("id") && keys.has("execute");
}

// The keys only a JSKIT action definition holds beside `id` and `execute`; an agent tool has `inputSchema` instead.
// A shared-field constant spread into the literal counts as one.
const ACTION_ONLY_KEYS = new Set(["input", "kind", "version", "channels", "surfaces", "permission"]);

// An action definition a feature writes, as opposed to an agent tool or a catalogue's normalized copy of a
// definition (`execute: source.execute`).
function isWrittenActionDefinition(object) {
  if (!isActionDefinition(object)) {
    return false;
  }
  const execute = object.properties.find((property) => keyName(property) === "execute");
  if (execute.value?.type === "MemberExpression" && !execute.value.computed && execute.value.property.name === "execute") {
    return false;
  }
  return object.properties.some((property) => property.type === "SpreadElement" || ACTION_ONLY_KEYS.has(keyName(property)));
}

function isFreezeCall(node) {
  return node?.type === "CallExpression" && node.callee.type === "MemberExpression" &&
    node.callee.object.name === "Object" && node.callee.property.name === "freeze";
}

// The local names a module imports `deepFreeze` under (the kernel's, from
// `@jskit-ai/kernel/shared/support/deepFreeze`), which freezes a value and
// every value inside it.
function deepFreezeNames(program) {
  return new Set(program.body
    .filter((statement) => statement.type === "ImportDeclaration")
    .flatMap((statement) => statement.specifiers)
    .filter((specifier) => specifier.type === "ImportSpecifier" && (specifier.imported.name || specifier.imported.value) === "deepFreeze")
    .map((specifier) => specifier.local.name));
}

// A value is frozen when it is Object.freeze's argument, or stands, through
// array elements and object properties, inside the argument of deepFreeze.
function isFrozenValue(node, deepFreezing) {
  if (isFreezeCall(node.parent) && node.parent.arguments[0] === node) {
    return true;
  }
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === "CallExpression") {
      return parent.callee.type === "Identifier" && deepFreezing.has(parent.callee.name) && parent.arguments[0] === child;
    }
    if (parent.type !== "ArrayExpression" && parent.type !== "ObjectExpression" && parent.type !== "Property") {
      return false;
    }
  }
  return false;
}

// The execute of an action definition: a property of an object that also has an id.
function isActionExecute(node, owner) {
  return node?.type === "Property" && keyName(node) === "execute" && owner?.type === "ObjectExpression" &&
    owner.properties.some((property) => keyName(property) === "id");
}

function isActionsFile(filename) {
  return ACTIONS_FILE.test(filename.split(/[\\/]/u).at(-1));
}

function isInAction(context, node) {
  if (isActionsFile(context.filename)) {
    return true;
  }
  const ancestors = context.sourceCode.getAncestors(node);
  return ancestors.some((ancestor, index) => isActionExecute(ancestor, ancestors[index - 1]));
}

// True when the call or member is itself optional or follows an optional link
// of its chain (`a?.b.c()`), as opposed to one that only precedes it.
function followsOptionalLink(node) {
  for (let link = node; link?.type === "CallExpression" || link?.type === "MemberExpression";) {
    if (link.optional) {
      return true;
    }
    link = link.type === "CallExpression" ? link.callee : link.object;
  }
  return false;
}

function collaboratorNames(fn, names, visitorKeys) {
  const found = new Set();
  walk(fn.body, visitorKeys, (node) => {
    if (node.type !== "CallExpression") {
      return;
    }
    const callee = node.callee;
    if (callee.type === "Identifier" && names.has(callee.name)) {
      found.add(callee.name);
    }
    if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && names.has(callee.object.name)) {
      found.add(callee.object.name);
    }
    for (const argument of node.arguments) {
      if (argument.type === "Identifier" && names.has(argument.name) && COLLABORATOR_NAME.test(argument.name)) {
        found.add(argument.name);
      }
    }
    const calleeName = callee.type === "Identifier" ? callee.name : callee.property?.name || "";
    if (!FACTORY_NAME.test(calleeName)) {
      return;
    }
    for (const argument of node.arguments) {
      if (argument.type === "Identifier" && names.has(argument.name)) {
        found.add(argument.name);
      }
      if (argument.type !== "ObjectExpression") {
        continue;
      }
      for (const property of argument.properties) {
        if (property.type === "Property" && property.value.type === "Identifier" && names.has(property.value.name)) {
          found.add(property.value.name);
        }
      }
    }
  });
  return found;
}

// The object patterns that destructure a dependencies parameter in the
// function body's own statements (not nested blocks), wherever they stand:
// `const { store, clock } = dependencies;`.
function bodyDestructuring(fn, parameterName) {
  if (fn.body?.type !== "BlockStatement") {
    return [];
  }
  return fn.body.body.flatMap((statement) => statement.type === "VariableDeclaration"
    ? statement.declarations.filter((declarator) => declarator.id.type === "ObjectPattern" &&
      declarator.init?.type === "Identifier" && declarator.init.name === parameterName).map((declarator) => declarator.id)
    : []);
}

// The object pattern a factory receives its dependencies through: its first
// parameter's, or the body's destructuring of that parameter.
function dependenciesPattern(fn, first) {
  const parameter = first?.type === "AssignmentPattern" ? first.left : first;
  if (parameter?.type === "ObjectPattern") {
    return parameter;
  }
  if (parameter?.type !== "Identifier") {
    return null;
  }
  const patterns = bodyDestructuring(fn, parameter.name);
  if (!patterns.length) {
    return null;
  }
  return { type: "ObjectPattern", properties: patterns.flatMap((pattern) => pattern.properties) };
}

// A create*/build* factory (in client code also a use* composable) or class
// constructor that destructures collaborators from its first parameter, in its
// signature or in its body's own statements, or null.
function factoryDependencies(fn, sourceCode, client = false) {
  const name = functionName(fn);
  if (!(client ? CLIENT_FACTORY_NAME : FACTORY_NAME).test(name) && !isConstructor(fn)) {
    return null;
  }
  const first = fn.params[0];
  const pattern = dependenciesPattern(fn, first);
  if (!pattern) {
    return null;
  }
  const localName = (property) => (property.value?.type === "AssignmentPattern" ? property.value.left : property.value)?.name;
  const names = new Set(pattern.properties.map(localName).filter(Boolean));
  const collaborators = names.size ? collaboratorNames(fn, names, sourceCode.visitorKeys) : new Set();
  if (!collaborators.size) {
    return null;
  }
  return { name, first, pattern, collaborators };
}

// A node's source text on one line, for messages that quote it.
function compactText(sourceCode, node) {
  return sourceCode.getText(node).replace(/\s+/gu, " ");
}

// The typed-features guide. Each rule's section explains it with a good and a bad example.
const GUIDE_URL = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features";
// The client half of the guide: components, composables and client providers.
const CLIENT_GUIDE_URL = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features";

// A default that makes a collaborator absent: null, undefined, {}, [] or a no-op.
// A default that is the production implementation (a clock, the global fetch)
// is fine.
const ABSENT_DEFAULT = /^(null|undefined|\{\}|\[\]|(async\s*)?\(\)\s*=>\s*(null|undefined|\{\s*\}|\(\{\s*\}\)|\[\]))$/u;

/**
 * A rule's meta: its description, its messages, each ending with a link to the guide section that explains the rule,
 * and that link as its docs URL.
 * @param {string} description
 * @param {Record<string, string>} messages
 * @param {string} section The guide heading's anchor, such as "required-collaborators".
 * @param {string} [guide] The guide page: typed features, or the client page for rules only client code has.
 */
function ruleMeta(description, messages, section, guide = GUIDE_URL) {
  const url = `${guide}#${section}`;
  return {
    type: "suggestion",
    docs: { description, url },
    schema: [],
    messages: Object.fromEntries(Object.entries(messages).map(([id, text]) => [id, `${text} See ${url}`]))
  };
}

// The function that receives a name as a parameter (destructured or not), where a node stands, or null when the name
// is not a parameter there.
function receivingFunction(context, node, name) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) {
      return variable.defs.find((definition) => definition.type === "Parameter")?.node || null;
    }
  }
  return null;
}

// Whether a create*/build* factory (in client code also a use* composable) or a class constructor: the functions that
// receive collaborators.
function isFactory(fn, client = false) {
  return (client ? CLIENT_FACTORY_NAME : FACTORY_NAME).test(functionName(fn)) || isConstructor(fn);
}

export {
  ABSENT_DEFAULT,
  CLIENT_GUIDE_URL,
  GUIDE_URL,
  compactText,
  createReporter,
  deepFreezeNames,
  factoryDependencies,
  followsOptionalLink,
  functionName,
  functionSite,
  isActionDefinition,
  isActionExecute,
  isActionsFile,
  isFreezeCall,
  isFrozenValue,
  isFactory,
  isClientLint,
  isInAction,
  isWrittenActionDefinition,
  keyName,
  receivingFunction,
  ruleMeta,
  walk
};
