import { createHash } from "node:crypto";
import path from "node:path";

// Syntax helpers over Babel trees: static values, bindings, scopes and the
// source evidence an observation cites.

const FUNCTION_NODE_PATTERN = /Function/u;

function hashBytes(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function isCanonicalPath(value) {
  if (typeof value !== "string" || value.length === 0 || value === ".") {
    return false;
  }
  if (/[\\\0]/u.test(value) || path.posix.isAbsolute(value)) {
    return false;
  }
  return path.posix.normalize(value) === value && !value.split("/").includes("..");
}

function propertyKey(entry) {
  return entry.key.name || entry.key.value;
}

function isStaticObjectProperty(entry) {
  return entry.type === "ObjectProperty" && !entry.computed;
}

function objectProperty(node, key) {
  if (node?.type !== "ObjectExpression") {
    return undefined;
  }
  return node.properties.find((entry) => isStaticObjectProperty(entry) && propertyKey(entry) === key)?.value;
}

function hasOnlyStaticProperties(node) {
  return node.properties.every(isStaticObjectProperty);
}

function isFunctionNode(node) {
  return FUNCTION_NODE_PATTERN.test(node.type);
}

function directoryPrefixes(filePath) {
  const parts = filePath.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Every AST node with its ancestor chain, depth first.
// Node records link to their parent record. `ancestors` (outermost first) is
// built on demand, so a module's records stay linear in its size.
const NODE_RECORD = Object.freeze({
  get ancestors() {
    const chain = [];
    for (let current = this.parent; current; current = current.parent) {
      chain.push(current.node);
    }
    return chain.reverse();
  }
});

function nodeRecord(node, parent) {
  return Object.assign(Object.create(NODE_RECORD), { node, parent });
}

function collectNodes(root) {
  const result = [];
  const pending = [nodeRecord(root, null)];
  while (pending.length) {
    const current = pending.pop();
    const { node } = current;
    if (!node || typeof node.type !== "string") {
      continue;
    }
    result.push(current);
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : value?.type ? [value] : [];
      for (const child of children) {
        if (child?.type) {
          pending.push(nodeRecord(child, current));
        }
      }
    }
  }
  return result;
}

// The literal value of an expression, following local bindings; undefined when
// any part is dynamic.
function staticValue(node, bindings, seen = new Set(), environment = null) {
  if (!node) {
    return undefined;
  }
  if (node.type === "Identifier" && environment?.has(node.name)) {
    return environment.get(node.name);
  }
  if (["StringLiteral", "BooleanLiteral", "NumericLiteral"].includes(node.type)) {
    return node.value;
  }
  if (node.type === "NullLiteral") {
    return null;
  }
  if (node.type === "Identifier" && !seen.has(node.name)) {
    return staticValue(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  }
  if (node.type === "ArrayExpression") {
    const values = node.elements.map((entry) => staticValue(entry, bindings, seen, environment));
    return values.every((value) => value !== undefined) ? values : undefined;
  }
  if (node.type === "ObjectExpression") {
    return staticObjectValue(node, bindings, seen, environment);
  }
  if (node.type === "TemplateLiteral") {
    const values = node.expressions.map((entry) => staticValue(entry, bindings, seen, environment));
    if (values.some((value) => typeof value !== "string")) {
      return undefined;
    }
    return node.quasis.map((entry, index) => entry.value.cooked + (values[index] || "")).join("");
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticValue(node.left, bindings, seen, environment);
    const right = staticValue(node.right, bindings, seen, environment);
    return typeof left === "string" && typeof right === "string" ? left + right : undefined;
  }
  return undefined;
}

function staticObjectValue(node, bindings, seen, environment) {
  const result = {};
  for (const entry of node.properties) {
    if (!isStaticObjectProperty(entry)) {
      return undefined;
    }
    const value = staticValue(entry.value, bindings, seen, environment);
    if (value === undefined) {
      return undefined;
    }
    result[propertyKey(entry)] = value;
  }
  return result;
}

// The node an identifier is bound to locally, or the node itself.
function bindingNode(node, bindings, seen = new Set()) {
  if (node?.type !== "Identifier" || seen.has(node.name) || !bindings.has(node.name)) {
    return node;
  }
  return bindingNode(bindings.get(node.name), bindings, new Set([...seen, node.name]));
}

function isShadowed({ ancestors }, name) {
  return ancestors.some((node) =>
    node.params?.some((parameter) =>
      collectNodes(parameter).some(({ node: binding }) => binding.type === "Identifier" && binding.name === name)
    )
  );
}

function isLocalCall(record, names) {
  const { node } = record;
  return node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    names.has(node.callee.name) &&
    !isShadowed(record, node.callee.name);
}

function importedNames(module, source, imported) {
  const names = [...module.imports]
    .filter(([, entry]) => entry.source === source && entry.imported === imported)
    .map(([name]) => name);
  return new Set(names);
}

function findRecord(module, node) {
  return module.nodes.find((entry) => entry.node === node);
}

function kebabCase(name) {
  return name.replace(/[A-Z]/gu, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`);
}

// The imported local name a template tag refers to, by exact or kebab-case name.
function templateTagImport(module, tag) {
  return [...module.imports.keys()].find((name) => name === tag || kebabCase(name) === tag);
}

function sourcePoint(module, index) {
  const lines = module.source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function sourceEvidence(module, node, offset = 0) {
  const sourceEnd = Math.max(1, module.source.length - (module.source.endsWith("\n") ? 1 : 0));
  return [{
    path: module.path,
    hash: module.hash,
    start: sourcePoint(module, offset + (node?.start || 0)),
    end: sourcePoint(module, offset + (node?.end || sourceEnd))
  }];
}

export {
  bindingNode,
  collectNodes,
  directoryPrefixes,
  findRecord,
  hasOnlyStaticProperties,
  hashBytes,
  importedNames,
  isCanonicalPath,
  isFunctionNode,
  isLocalCall,
  isShadowed,
  isStaticObjectProperty,
  objectProperty,
  propertyKey,
  sourceEvidence,
  staticValue,
  templateTagImport
};
