// Shared by the typed-features rules. Each rule reports what readable-check
// reports under its finding name, and each finding can be excused by a comment
// on the line before it: "// readable-check: allow <finding or rule> - <reason>".

const FACTORY_NAME = /^(create|build)[A-Z]/u;

// A factory treats a received name as a collaborator when it calls it, calls a
// method on it, hands it to another create*/build* factory, or passes on one
// whose name says what it is.
const COLLABORATOR_NAME = /(service|store|repository|runtime|router|publisher|catalogue|registry|provider|manager|client|broker|gateway|resolver|engine)$/iu;

// accountPreferencesActions.js, actions.js and user-actions.js hold actions;
// transaction.js does not.
const ACTIONS_FILE = /(?:^|[^A-Za-z])[Aa]ctions?\.m?js$|Actions?\.m?js$/u;

function createReporter(context, ruleName) {
  const lines = context.sourceCode.lines;
  const names = [ruleName, `jskit/${ruleName}`];
  return function report(node, finding, messageId, data) {
    const previous = lines[node.loc.start.line - 2] || "";
    if ([finding, ...names].some((name) => previous.includes(`readable-check: allow ${name}`))) {
      return;
    }
    context.report({ node, messageId, data });
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

// A create*/build* factory or class constructor that destructures collaborators
// from its first parameter, or null.
function factoryDependencies(fn, sourceCode) {
  const name = functionName(fn);
  if (!FACTORY_NAME.test(name) && !isConstructor(fn)) {
    return null;
  }
  const first = fn.params[0];
  const pattern = first?.type === "AssignmentPattern" ? first.left : first;
  if (pattern?.type !== "ObjectPattern") {
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

function ruleMeta(description, messages) {
  return {
    type: "suggestion",
    docs: { description },
    schema: [],
    messages
  };
}

export {
  createReporter,
  factoryDependencies,
  followsOptionalLink,
  functionSite,
  isActionExecute,
  isActionsFile,
  isInAction,
  ruleMeta,
  walk
};
