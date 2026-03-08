const DEFAULT_DEBUG_DEPTH = 4;

function describeFunction(fn) {
  return `[Function ${fn?.name || "anonymous"}]`;
}

function describeSymbol(value) {
  return value?.toString ? value.toString() : "[Symbol]";
}

function explodePayload(value, depth = DEFAULT_DEBUG_DEPTH) {
  const visited = new WeakSet();

  function walk(node, remaining) {
    if (node === null || typeof node !== "object") {
      if (typeof node === "function") {
        return describeFunction(node);
      }
      if (typeof node === "symbol") {
        return describeSymbol(node);
      }
      return node;
    }

    if (visited.has(node)) {
      return "[Circular]";
    }
    visited.add(node);

    if (remaining <= 0) {
      return Array.isArray(node) ? "[Array]" : "[Object]";
    }

    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry, remaining - 1));
    }

    if (node instanceof Date) {
      return node.toISOString();
    }

    const next = {};
    for (const [key, child] of Object.entries(node)) {
      next[key] = walk(child, remaining - 1);
    }
    return next;
  }

  return walk(value, depth);
}

export { DEFAULT_DEBUG_DEPTH, explodePayload };
