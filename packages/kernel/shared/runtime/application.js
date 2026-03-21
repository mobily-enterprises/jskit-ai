import { createContainer } from "./container.js";
import {
  DuplicateProviderError,
  ProviderDependencyError,
  ProviderLifecycleError,
  ProviderNormalizationError
} from "./kernelErrors.js";
import { ServiceProvider } from "./serviceProvider.js";
import { normalizeText } from "../support/normalize.js";

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function nowMilliseconds() {
  return Date.now();
}

class Application {
  constructor({ profile = "", strict = true, container = null } = {}) {
    this.profile = normalizeText(profile);
    this.strict = strict !== false;
    this.container = container || createContainer({ scopeId: "app-root" });

    this.providerEntries = [];
    this.registeredProviders = [];
    this.bootedProviders = [];

    this.diagnostics = {
      profile: this.profile,
      providerOrder: [],
      registeredOrder: [],
      bootedOrder: [],
      timings: {
        register: {},
        boot: {},
        shutdown: {}
      }
    };
  }

  bind(token, factory) {
    this.container.bind(token, factory);
    return this;
  }

  singleton(token, factory) {
    this.container.singleton(token, factory);
    return this;
  }

  scoped(token, factory) {
    this.container.scoped(token, factory);
    return this;
  }

  instance(token, value) {
    this.container.instance(token, value);
    return this;
  }

  make(token) {
    return this.container.make(token);
  }

  has(token) {
    return this.container.has(token);
  }

  createScope(scopeId) {
    return this.container.createScope(scopeId);
  }

  tag(token, tagName) {
    this.container.tag(token, tagName);
    return this;
  }

  resolveTag(tagName) {
    return this.container.resolveTag(tagName);
  }

  normalizeProviderEntries(providers = []) {
    if (!Array.isArray(providers)) {
      throw new ProviderNormalizationError("Providers must be an array.");
    }

    const entries = [];
    const seenIds = new Set();

    for (const rawProvider of providers) {
      const entry = this.normalizeProviderEntry(rawProvider);
      if (seenIds.has(entry.id)) {
        throw new DuplicateProviderError(`Provider \"${entry.id}\" is duplicated.`);
      }
      seenIds.add(entry.id);
      entries.push(entry);
    }

    return entries.sort((left, right) => left.id.localeCompare(right.id));
  }

  normalizeProviderEntry(rawProvider) {
    if (!rawProvider) {
      throw new ProviderNormalizationError("Provider entry is required.");
    }

    if (typeof rawProvider === "function") {
      const providerInstance = new rawProvider(this);
      const providerId = normalizeText(rawProvider.id || providerInstance.id || rawProvider.name);
      if (!providerId) {
        throw new ProviderNormalizationError("Provider class must define a stable id.");
      }

      return {
        id: providerId,
        dependsOn: normalizeStringArray(rawProvider.dependsOn || providerInstance.dependsOn),
        provider: providerInstance
      };
    }

    if (typeof rawProvider === "object") {
      const provider = rawProvider;
      const providerId = normalizeText(provider.id || provider.constructor?.id || provider.constructor?.name);
      if (!providerId) {
        throw new ProviderNormalizationError("Provider object must define id.");
      }

      return {
        id: providerId,
        dependsOn: normalizeStringArray(provider.dependsOn || provider.constructor?.dependsOn),
        provider
      };
    }

    throw new ProviderNormalizationError("Provider entry must be a class or object instance.");
  }

  sortProviderGraph(entries = []) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const visited = new Set();
    const visiting = new Set();
    const ordered = [];

    const visit = (providerId, lineage = []) => {
      if (visited.has(providerId)) {
        return;
      }
      if (visiting.has(providerId)) {
        throw new ProviderDependencyError(`Provider dependency cycle detected: ${[...lineage, providerId].join(" -> ")}`);
      }

      const entry = byId.get(providerId);
      if (!entry) {
        throw new ProviderDependencyError(`Provider \"${lineage[lineage.length - 1] || "<unknown>"}\" depends on missing provider \"${providerId}\".`);
      }

      visiting.add(providerId);
      for (const dependencyId of entry.dependsOn) {
        visit(dependencyId, [...lineage, providerId]);
      }
      visiting.delete(providerId);
      visited.add(providerId);
      ordered.push(entry);
    };

    for (const entry of [...entries].sort((left, right) => left.id.localeCompare(right.id))) {
      visit(entry.id, []);
    }

    return ordered;
  }

  configureProviders(providers = []) {
    const normalized = this.normalizeProviderEntries(providers);
    const ordered = this.sortProviderGraph(normalized);

    this.providerEntries = ordered;
    this.diagnostics.providerOrder = ordered.map((entry) => entry.id);
    return this;
  }

  async registerProviders() {
    this.registeredProviders = [];

    for (const entry of this.providerEntries) {
      const startedAt = nowMilliseconds();
      try {
        if (typeof entry.provider.register === "function") {
          await entry.provider.register(this);
        }
      } catch (error) {
        throw new ProviderLifecycleError(`Provider \"${entry.id}\" failed during register().`, {
          providerId: entry.id,
          phase: "register",
          cause: error
        });
      } finally {
        this.diagnostics.timings.register[entry.id] = nowMilliseconds() - startedAt;
      }

      this.registeredProviders.push(entry);
      this.diagnostics.registeredOrder.push(entry.id);
    }

    return this;
  }

  async bootProviders() {
    this.bootedProviders = [];

    for (const entry of this.providerEntries) {
      const startedAt = nowMilliseconds();
      try {
        if (typeof entry.provider.boot === "function") {
          await entry.provider.boot(this);
        }
      } catch (error) {
        throw new ProviderLifecycleError(`Provider \"${entry.id}\" failed during boot().`, {
          providerId: entry.id,
          phase: "boot",
          cause: error
        });
      } finally {
        this.diagnostics.timings.boot[entry.id] = nowMilliseconds() - startedAt;
      }

      this.bootedProviders.push(entry);
      this.diagnostics.bootedOrder.push(entry.id);
    }

    return this;
  }

  async start({ providers = [] } = {}) {
    this.configureProviders(providers);
    await this.registerProviders();
    await this.bootProviders();
    return this;
  }

  async shutdown() {
    const shutdownOrder = [...this.bootedProviders].reverse();

    for (const entry of shutdownOrder) {
      const startedAt = nowMilliseconds();
      try {
        if (typeof entry.provider.shutdown === "function") {
          await entry.provider.shutdown(this);
        }
      } catch (error) {
        throw new ProviderLifecycleError(`Provider \"${entry.id}\" failed during shutdown().`, {
          providerId: entry.id,
          phase: "shutdown",
          cause: error
        });
      } finally {
        this.diagnostics.timings.shutdown[entry.id] = nowMilliseconds() - startedAt;
      }
    }

    return shutdownOrder.map((entry) => entry.id);
  }

  getDiagnostics() {
    return Object.freeze({
      profile: this.diagnostics.profile,
      providerOrder: Object.freeze([...this.diagnostics.providerOrder]),
      registeredOrder: Object.freeze([...this.diagnostics.registeredOrder]),
      bootedOrder: Object.freeze([...this.diagnostics.bootedOrder]),
      timings: Object.freeze({
        register: Object.freeze({ ...this.diagnostics.timings.register }),
        boot: Object.freeze({ ...this.diagnostics.timings.boot }),
        shutdown: Object.freeze({ ...this.diagnostics.timings.shutdown })
      })
    });
  }
}

function createApplication(options = {}) {
  return new Application(options);
}

function createProviderClass({ id, dependsOn = [], register = null, boot = null, shutdown = null } = {}) {
  const providerId = normalizeText(id);
  if (!providerId) {
    throw new ProviderNormalizationError("createProviderClass requires id.");
  }

  class DynamicProvider extends ServiceProvider {
    static id = providerId;

    static dependsOn = normalizeStringArray(dependsOn);

    async register(app) {
      if (typeof register === "function") {
        await register(app);
      }
    }

    async boot(app) {
      if (typeof boot === "function") {
        await boot(app);
      }
    }

    async shutdown(app) {
      if (typeof shutdown === "function") {
        await shutdown(app);
      }
    }
  }

  return DynamicProvider;
}

export { Application, createApplication, createProviderClass };
