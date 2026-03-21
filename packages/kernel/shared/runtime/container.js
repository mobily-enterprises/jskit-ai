import {
  CircularDependencyError,
  DuplicateBindingError,
  InvalidFactoryError,
  InvalidTokenError,
  UnresolvedTokenError
} from "./containerErrors.js";

const LIFETIME_TRANSIENT = "transient";
const LIFETIME_SINGLETON = "singleton";
const LIFETIME_SCOPED = "scoped";

function normalizeToken(token) {
  const kind = typeof token;
  if (kind === "string") {
    const normalized = token.trim();
    if (!normalized) {
      throw new InvalidTokenError("Container token string cannot be empty.");
    }
    return normalized;
  }

  if (kind === "symbol" || kind === "function") {
    return token;
  }

  throw new InvalidTokenError("Container token must be a non-empty string, symbol, or function.", {
    receivedType: kind
  });
}

function tokenLabel(token) {
  if (typeof token === "string") {
    return token;
  }

  if (typeof token === "symbol") {
    return token.description ? `Symbol(${token.description})` : String(token);
  }

  if (typeof token === "function") {
    return token.name ? `Function(${token.name})` : "Function(<anonymous>)";
  }

  return String(token);
}

function ensureFactory(factory, token) {
  if (typeof factory !== "function") {
    throw new InvalidFactoryError(`Factory for token \"${tokenLabel(token)}\" must be a function.`);
  }
}

function normalizeTagName(tagName) {
  const normalized = String(tagName || "").trim();
  if (!normalized) {
    throw new TypeError("Tag name is required.");
  }
  return normalized;
}

function normalizeScopeId(scopeId) {
  const normalized = String(scopeId || "").trim();
  return normalized || "scope";
}

class Container {
  constructor({ parent = null, scopeId = "root" } = {}) {
    this.parent = parent instanceof Container ? parent : null;
    this.scopeId = normalizeScopeId(scopeId);
    this.bindings = new Map();
    this.instances = new Map();
    this.scopedInstances = new Map();

    if (!this.parent) {
      this.tags = new Map();
      this.resolutionStack = [];
    }
  }

  root() {
    let node = this;
    while (node.parent) {
      node = node.parent;
    }
    return node;
  }

  has(token) {
    const normalizedToken = normalizeToken(token);
    return this.findBindingRecord(normalizedToken) !== null || this.findInstanceRecord(normalizedToken) !== null;
  }

  bind(token, factory) {
    return this.setBinding(token, factory, LIFETIME_TRANSIENT);
  }

  singleton(token, factory) {
    return this.setBinding(token, factory, LIFETIME_SINGLETON);
  }

  scoped(token, factory) {
    return this.setBinding(token, factory, LIFETIME_SCOPED);
  }

  instance(token, value) {
    const normalizedToken = normalizeToken(token);
    if (this.bindings.has(normalizedToken) || this.instances.has(normalizedToken)) {
      throw new DuplicateBindingError(`Token \"${tokenLabel(normalizedToken)}\" is already bound.`);
    }

    this.instances.set(normalizedToken, value);
    return this;
  }

  tag(token, tagName) {
    const normalizedToken = normalizeToken(token);
    const normalizedTagName = normalizeTagName(tagName);

    if (!this.has(normalizedToken)) {
      throw new UnresolvedTokenError(`Cannot tag unresolved token \"${tokenLabel(normalizedToken)}\".`);
    }

    const rootContainer = this.root();
    if (!rootContainer.tags.has(normalizedTagName)) {
      rootContainer.tags.set(normalizedTagName, new Set());
    }
    rootContainer.tags.get(normalizedTagName).add(normalizedToken);
    return this;
  }

  resolveTag(tagName) {
    const normalizedTagName = normalizeTagName(tagName);
    const rootContainer = this.root();
    const tokens = rootContainer.tags.get(normalizedTagName);
    if (!tokens || tokens.size < 1) {
      return [];
    }

    return [...tokens]
      .sort((left, right) => tokenLabel(left).localeCompare(tokenLabel(right)))
      .map((token) => this.make(token));
  }

  createScope(scopeId = "scope") {
    return new Container({
      parent: this,
      scopeId: normalizeScopeId(scopeId)
    });
  }

  make(token) {
    const normalizedToken = normalizeToken(token);
    const instanceRecord = this.findInstanceRecord(normalizedToken);
    if (instanceRecord) {
      return instanceRecord.value;
    }

    const bindingRecord = this.findBindingRecord(normalizedToken);
    if (!bindingRecord) {
      throw new UnresolvedTokenError(`Token \"${tokenLabel(normalizedToken)}\" is not registered.`);
    }

    const rootContainer = this.root();
    const stack = rootContainer.resolutionStack;
    const stackIndex = stack.indexOf(normalizedToken);
    if (stackIndex >= 0) {
      const cycle = stack
        .slice(stackIndex)
        .concat([normalizedToken])
        .map((entry) => tokenLabel(entry));
      throw new CircularDependencyError(`Circular dependency detected: ${cycle.join(" -> ")}.`, {
        cycle
      });
    }

    stack.push(normalizedToken);
    try {
      return this.resolveFromBindingRecord(bindingRecord);
    } finally {
      stack.pop();
    }
  }

  setBinding(token, factory, lifetime) {
    const normalizedToken = normalizeToken(token);
    ensureFactory(factory, normalizedToken);

    if (this.bindings.has(normalizedToken) || this.instances.has(normalizedToken)) {
      throw new DuplicateBindingError(`Token \"${tokenLabel(normalizedToken)}\" is already bound.`);
    }

    this.bindings.set(normalizedToken, {
      token: normalizedToken,
      factory,
      lifetime
    });

    return this;
  }

  findBindingRecord(token) {
    let node = this;
    while (node) {
      if (node.bindings.has(token)) {
        return {
          container: node,
          binding: node.bindings.get(token)
        };
      }
      node = node.parent;
    }

    return null;
  }

  findInstanceRecord(token) {
    let node = this;
    while (node) {
      if (node.instances.has(token)) {
        return {
          container: node,
          value: node.instances.get(token)
        };
      }
      node = node.parent;
    }

    return null;
  }

  resolveFromBindingRecord(record) {
    const { container, binding } = record;

    if (binding.lifetime === LIFETIME_SINGLETON) {
      if (container.instances.has(binding.token)) {
        return container.instances.get(binding.token);
      }
      const created = binding.factory(this);
      container.instances.set(binding.token, created);
      return created;
    }

    if (binding.lifetime === LIFETIME_SCOPED) {
      if (this.scopedInstances.has(binding.token)) {
        return this.scopedInstances.get(binding.token);
      }
      const created = binding.factory(this);
      this.scopedInstances.set(binding.token, created);
      return created;
    }

    return binding.factory(this);
  }
}

function createContainer(options = {}) {
  return new Container(options);
}

export { Container, createContainer, tokenLabel };
