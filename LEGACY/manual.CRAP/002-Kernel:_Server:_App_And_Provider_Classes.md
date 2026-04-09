# JSKIT Manual: App + Provider (Everyday Developer)

This chapter continues directly from Chapter 1 (`manual-app` with `@local/main` and `MainServiceProvider`).

The goal of this chapter is practical:

- Understand what `app` is in concrete terms.
- Understand what a provider actually "provides."
- Learn `app` methods through useful mini tutorials you can run and adapt.

This chapter has two parts:

- Part 1 (this file now): use-focused `app` + provider workflow.
- Part 2 (later): routing-focused patterns (not written yet).

## Full Kernel Class Map (Public Exports)

This is the full list of kernel classes currently exposed to users.

Non-error classes:

- `Application` (`@jskit-ai/kernel/server/kernel`)
- `ServiceProvider` (`@jskit-ai/kernel/server/kernel`)
- `Container` (`@jskit-ai/kernel/server/container`)
- `HttpRouter` (`@jskit-ai/kernel/server/http`)
- `ContainerCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `HttpFastifyServiceProvider` (`@jskit-ai/kernel/server`)
- `KernelCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `PlatformServerRuntimeServiceProvider` (`@jskit-ai/kernel/server`)
- `ServerRuntimeCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `SupportCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `SurfaceRoutingServiceProvider` (`@jskit-ai/kernel/server`)

Error classes:

- `KernelError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderNormalizationError` (`@jskit-ai/kernel/server/kernel`)
- `DuplicateProviderError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderDependencyError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderLifecycleError` (`@jskit-ai/kernel/server/kernel`)
- `ContainerError` (`@jskit-ai/kernel/server/container`)
- `InvalidTokenError` (`@jskit-ai/kernel/server/container`)
- `InvalidFactoryError` (`@jskit-ai/kernel/server/container`)
- `DuplicateBindingError` (`@jskit-ai/kernel/server/container`)
- `UnresolvedTokenError` (`@jskit-ai/kernel/server/container`)
- `CircularDependencyError` (`@jskit-ai/kernel/server/container`)
- `HttpKernelError` (`@jskit-ai/kernel/server/http`)
- `RouteDefinitionError` (`@jskit-ai/kernel/server/http`)
- `RouteRegistrationError` (`@jskit-ai/kernel/server/http`)
- `AppError` (`@jskit-ai/kernel/server/runtime`)


## Where We Pick Up From Chapter 1

In Chapter 1, you already built `manual-app`, edited `MainServiceProvider`, and wired a first endpoint.

At that point, you already touched the central backend runtime object:

- `app`, passed into provider lifecycle methods.

Most backend development in JSKIT is:

- declare capabilities in `register(app)`
- consume/wire capabilities in `boot(app)`

## The `app` Object, In Plain English

`app` is the runtime application object that providers use to collaborate.

It gives you:

- a DI/container API (`bind`, `singleton`, `scoped`, `instance`, `make`, `has`)
- grouping APIs (`tag`, `resolveTag`)
- scope creation (`createScope`)
- provider lifecycle execution (`register`, `boot`, `shutdown` via provider classes)

In normal app work, you do not manually create `app`; runtime bootstrap does it and passes it to your providers.

You still need to understand the full class because:

- it explains why provider order works
- it explains where bindings live
- it explains how lifecycle failures are reported

## Everyday Method Tutorials

The tutorials below are all implemented in a functional example module:

- `docs/examples/02.kernel`

Source of truth for the main mini-tutorial providers in this chapter:

- `docs/examples/02.kernel/src/server/providers/BindExampleProvider.js`
- `docs/examples/02.kernel/src/server/providers/SingletonExampleProvider.js`
- `docs/examples/02.kernel/src/server/providers/ScopedExampleProvider.js`
- `docs/examples/02.kernel/src/server/providers/InstanceExampleProvider.js`

The providers are named exactly as they appear in this chapter and can be used as reference implementations.

### Binding APIs

These methods define what other code can resolve later.

- `bind(token, factory)`
  - transient factory binding (fresh object each `make` call).
- `singleton(token, factory)`
  - one shared instance per app container.
- `scoped(token, factory)`
  - one instance per scope.
- `instance(token, value)`
  - prebuilt value/object registered directly.

All four return `this`, so they can be chained.

### `bind(token, factory)` + `make(token)` with `BindExampleProvider`

Use `bind` when each `make(token)` should return a fresh object.

Typical use case:

- request-local builder object
- temporary formatter
- short-lived helper that should never be shared globally

Step 1: start with a provider skeleton.

```js
class BindExampleProvider {
  static id = "docs.examples.02.bind";

  register(app) {}

  boot(app) {}
}
```

Step 2: register a transient factory with `bind`.

```js
const GREETING_FACTORY = "docs.examples.02.bind.greetingFactory";

register(app) {
  app.bind(GREETING_FACTORY, () => {
    const factoryId = `bind-${Math.random().toString(36).slice(2, 8)}`;
    return {
      factoryId,
      greet(name) {
        const normalizedName = String(name || "").trim() || "world";
        return `Hello, ${normalizedName}. [factory:${factoryId}]`;
      }
    };
  });
}
```

Important behavior before continuing:

- `app.bind(...)` does not execute the factory immediately.
- It only registers a recipe under `GREETING_FACTORY`.
- The factory runs when `app.make(GREETING_FACTORY)` is called.
- Because this is `bind`, each `make(...)` call gets a fresh object.

Step 3: consume it in `boot` and verify transient behavior.

```js
boot(app) {
  const firstFactory = app.make(GREETING_FACTORY);
  const secondFactory = app.make(GREETING_FACTORY);

  // Example: "Hello, alice. [factory:bind-a1b2c3]"
  const firstMessage = firstFactory.greet("alice");
  // Example: "Hello, bob. [factory:bind-d4e5f6]"
  const secondMessage = secondFactory.greet("bob");
  const distinctObjects = firstFactory !== secondFactory;
  const distinctFactoryIds = firstFactory.factoryId !== secondFactory.factoryId;

  if (!distinctObjects || !distinctFactoryIds) {
    throw new Error("Expected bind() to resolve a fresh object on each make().");
  }
}
```

Why this is useful:

- It proves `bind` creates fresh objects.
- It keeps the `bind` example focused on factory lifecycle behavior.

### `singleton(token, factory)`  + `make(token)` with `SingletonExampleProvider`

Use `singleton` when all consumers should share one stateful object.

Typical use case:

- in-memory counters
- caches
- reusable clients initialized once

Step 1: register a stateful singleton.

```js
const COUNTER = "docs.examples.02.singleton.counter";

register(app) {
  app.singleton(COUNTER, () => {
    let count = 0;
    return {
      increment() {
        count += 1;
        return count;
      },
      current() {
        return count;
      }
    };
  });
}
```

Step 2: resolve twice in `boot` and prove it is shared.

```js
boot(app) {
  const firstResolve = app.make(COUNTER);
  const secondResolve = app.make(COUNTER);

  // Example: 1
  const firstIncrement = firstResolve.increment();
  // Example: 2
  const secondIncrement = secondResolve.increment();
  const sharedObject = firstResolve === secondResolve;
  const finalValue = firstResolve.current();

  if (!sharedObject || firstIncrement !== 1 || secondIncrement !== 2 || finalValue !== 2) {
    throw new Error("Expected singleton() to return one shared object with stable state.");
  }
}
```

Why this is useful:

- It demonstrates shared mutable state explicitly.
- It gives a practical template for metrics/counters.

### `app.scoped(token, factory)` + `app.createScope(scopeId)` + `make(token)` with `ScopedExampleProvider`

 Use these two methods together. They are a pair.

Core concept:
- `app.scoped(token, factory)` registers a scoped binding on the app/root container.
- `scope_1 = app.createScope(scope_1_id)` creates the first scope boundary.
- `scope_2 = app.createScope(scope_2_id)` creates the second scope boundary.
- `scope_1.make(token)` resolves that binding in `scope_1`. Calling `scope_1.make(token)` again returns the same instance in `scope_1`.
- `scope_2.make(token)` returns a different instance for `scope_2`.
- `app.make(token)` resolves in root scope. Calling `app.make(token)` again returns the same instance in root scope.

Mental model:
- `scoped` = policy
- `createScope` = boundary
- `make` on that scope = instance for that boundary

Typical use case:
- per-request context in HTTP handlers
- per-job state in background workers
- temporary operation state that must not leak across operations

Step 1: define a scoped binding (the policy).

```js
const CART = "docs.examples.02.scoped.cart";

register(app) {
  app.scoped(CART, (scope) => {
    const items = [];
    return {
      scopeId: scope?.scopeId || "unknown",
      add(item) {
        items.push(item);
      },
      list() {
        return [...items];
      }
    };
  });
}
```

Step 2: create two scopes and resolve in each (the boundary).

```js
boot(app) {
  // Create a scope for checkout flow state.
  const checkoutScope = app.createScope("checkout-request");
  // Create a separate scope for profile flow state.
  const profileScope = app.createScope("profile-request");

  // First resolve in checkout scope.
  const checkoutCartA = checkoutScope.make(CART);
  // Second resolve in the same scope; should be the same instance as checkoutCartA.
  const checkoutCartB = checkoutScope.make(CART);
  // Resolve in a different scope; should be a different instance.
  const profileCart = profileScope.make(CART);

  // Add one item to checkout scope state.
  checkoutCartA.add("keyboard");
  // Add one item to profile scope state.
  profileCart.add("mouse");

  // Example: true (same scope returns same scoped instance)
  const sameWithinScope = checkoutCartA === checkoutCartB;
  // Example: true (different scopes return different scoped instances)
  const differentAcrossScopes = checkoutCartA !== profileCart;

  if (!sameWithinScope || !differentAcrossScopes) {
    throw new Error("Expected scoped() to share within one scope and isolate across scopes.");
  }
}
```

Step 3: understand root-scope behavior when no child scope is created.

```js
const rootCartA = app.make(CART);
const rootCartB = app.make(CART);

// Example: true (both are resolved in the same root scope)
const sameInRootScope = rootCartA === rootCartB;
```

Why this is useful:

- It states the caveat directly: in root scope, `scoped` looks like `singleton`.
- The difference appears only when you compare multiple scopes.
- It makes clear why explicit `createScope(...)` boundaries are required.

Real-world examples:

- HTTP request context: request `A` and request `B` each resolve their own scoped `RequestContext`.
- Background jobs: each job gets its own scoped job-state object while running concurrently.
- Multi-step checkout flow: each checkout attempt gets isolated in-memory state.
- Correlation/log context: each operation carries its own scoped trace metadata.

### `instance(token, value)`  + `make(token)` with `InstanceExampleProvider`

Use `instance` when you already have the exact object/value you want to store, right now, during setup.

Plain-language meaning:

- You give the container a finished value immediately (`app.instance(token, value)`).
- The token is a label/name for that value.
- Later, any provider can refetch it with `app.make(token)` without passing it manually through function arguments.
- There is no factory function to run later.
- Every `app.make(token)` returns that same stored value/reference.
- This is the simplest option when nothing needs to be constructed on demand.
- Useful mental model: it behaves like a named shared variable for the container lifetime (root app lifetime by default; request-lifetime when using a request scope container).

What "lazy factory behavior" means here:

- `bind`/`singleton`/`scoped` store a function and run it later when `make(...)` is called.
- `instance` stores the final value itself, so there is nothing to "run later."

Typical use case:

- static app metadata
- immutable config snapshots
- feature flags resolved during bootstrap

Step 1: register an immutable object directly.

```js
const APP_METADATA = "docs.examples.02.instance.appMetadata";

register(app) {
  app.instance(
    APP_METADATA,
    Object.freeze({
      module: "02.kernel",
      environment: "docs-example",
      featureFlags: Object.freeze({
        auditEnabled: true,
        tracingEnabled: false
      })
    })
  );
}
```

Step 2: resolve in `boot` and verify stable reference.

```js
const INSTANCE_REPORT = "docs.examples.02.instance.report";

boot(app) {
  const firstResolve = app.make(APP_METADATA);
  const secondResolve = app.make(APP_METADATA);

  app.instance(INSTANCE_REPORT, {
    sameReference: firstResolve === secondResolve,
    module: firstResolve.module,
    auditEnabled: firstResolve.featureFlags.auditEnabled
  });
}
```

Step 3: persist the exact bind diagnostics object with `instance`.

```js
const GREETING_FACTORY = "docs.examples.02.bind.greetingFactory";
const BIND_REPORT = "docs.examples.02.bind.report";

boot(app) {
  const firstFactory = app.make(GREETING_FACTORY);
  const secondFactory = app.make(GREETING_FACTORY);

  app.instance(BIND_REPORT, {
    // Example: "Hello, alice. [factory:bind-a1b2c3]"
    firstMessage: firstFactory.greet("alice"),
    // Example: "Hello, bob. [factory:bind-d4e5f6]"
    secondMessage: secondFactory.greet("bob"),
    distinctObjects: firstFactory !== secondFactory,
    distinctFactoryIds: firstFactory.factoryId !== secondFactory.factoryId
  });
}
```

Why this is useful:

- It avoids unnecessary factory complexity.
- It is ideal for read-mostly boot metadata.
- It is the correct place to publish computed diagnostics like `BIND_REPORT`.

### Using `make(token)` for Required Values with `MakeExampleProvider`

`make(token)` means: "give me the value registered under this label, right now."

Important rule:

- Use `make(...)` when the value is required.
- If the token is missing, boot should fail immediately.
- If the value is optional, first check with `app.has(token)` (returns `true`/`false`), then provide a fallback when absent.

What "missing" means:

- no provider registered that token at all
- provider exists but never called `bind`/`singleton`/`scoped`/`instance` for that token
- required provider did not load or run (configuration/order/`dependsOn` issue)
- token typo or mismatch (for example `"app.meta"` vs `"app.metadata"`)

In plain terms:

- `make(...)` is the strict path.
- `has(...)` + fallback is the optional path (explained in detail in the next `has(token)` section).

Typical use case:

- your provider cannot start without another provider's value
- startup should stop if required configuration/service is missing

Step 1: declare provider dependency order so required tokens are registered first.

```js
class MakeExampleProvider {
  static id = "docs.examples.02.make";
  static dependsOn = ["docs.examples.02.instance", "docs.examples.02.singleton"];

  register() {}

  boot(app) {}
}
```

Step 2: resolve required values with `make`.

```js
const APP_METADATA = "docs.examples.02.instance.appMetadata";
const COUNTER = "docs.examples.02.singleton.counter";
const MAKE_REPORT = "docs.examples.02.make.report";

boot(app) {
  // Required: if missing, boot should fail right away.
  const metadata = app.make(APP_METADATA);
  // Required: shared counter from singleton provider.
  const counter = app.make(COUNTER);

  const before = counter.current();
  const after = counter.increment();

  app.instance(MAKE_REPORT, {
    module: metadata.module,
    counterBefore: before,
    counterAfter: after
  });
}
```

Why this is useful:

- The code is simple: required means `make(...)`.
- Missing required values fail at startup instead of causing hidden bugs later.

### `static dependsOn` with `DependsOnExampleProvider`

Use `dependsOn` to enforce provider startup order when your provider requires another provider's bindings during `register` or `boot`.

Typical use case:

- provider B calls `app.make(...)` for tokens created by provider A
- provider B must not run first

Core concept:

- `dependsOn` is provider lifecycle ordering, not object injection.
- If `B.dependsOn = ["A"]`, then the lifecycle order is:
  - `register(A)` -> `register(B)` -> `boot(A)` -> `boot(B)`

Step 1: create a base provider that publishes a recorder.

```js
const DEPENDS_ON_SEQUENCE = "docs.examples.02.dependsOn.sequence";
const DEPENDS_ON_RECORDER = "docs.examples.02.dependsOn.recorder";

class DependsOnBaseExampleProvider {
  static id = "docs.examples.02.dependsOn.base";

  register(app) {
    app.instance(DEPENDS_ON_SEQUENCE, []);

    app.singleton(DEPENDS_ON_RECORDER, (scope) => ({
      record(step) {
        const sequence = scope.make(DEPENDS_ON_SEQUENCE);
        sequence.push(step);
      },
      list() {
        return [...scope.make(DEPENDS_ON_SEQUENCE)];
      }
    }));

    app.make(DEPENDS_ON_RECORDER).record("base.register");
  }

  boot(app) {
    app.make(DEPENDS_ON_RECORDER).record("base.boot");
  }
}
```

Step 2: create dependent provider with explicit `dependsOn`.

```js
const DEPENDS_ON_REPORT = "docs.examples.02.dependsOn.report";

class DependsOnExampleProvider {
  static id = "docs.examples.02.dependsOn";

  static dependsOn = ["docs.examples.02.dependsOn.base"];

  register(app) {
    app.make(DEPENDS_ON_RECORDER).record("dependsOn.register");
  }

  boot(app) {
    const recorder = app.make(DEPENDS_ON_RECORDER);
    recorder.record("dependsOn.boot");

    app.instance(DEPENDS_ON_REPORT, {
      dependsOn: [...DependsOnExampleProvider.dependsOn],
      observedOrder: recorder.list()
    });
  }
}
```

Step 3: read the recorded sequence.

Expected `observedOrder`:

- `base.register`
- `dependsOn.register`
- `base.boot`
- `dependsOn.boot`

Why this is useful:

- It prevents subtle race/order bugs between providers.
- It makes startup contracts explicit and reviewable.

When not to use `dependsOn`:

- optional integrations; use `app.has(...)` + fallback.

Failure modes to expect:

- missing provider ID in `dependsOn` -> dependency error at startup
- cycle (`A -> B -> A`) -> dependency error at startup

### `has(token)` with `HasExampleProvider`

Use `has` when dependency is optional and your feature has fallback behavior.

Typical use case:

- optional integrations
- optional plugin hook
- progressive enhancement based on installed packages

Step 1: check optional token.

```js
const OPTIONAL_AUDIT_SINK = "docs.examples.02.optional.auditSink";

boot(app) {
  const hasOptionalAuditSink = app.has(OPTIONAL_AUDIT_SINK);
}
```

Step 2: integrate conditionally, then report fallback path.

```js
const HAS_REPORT = "docs.examples.02.has.report";

boot(app) {
  const hasOptionalAuditSink = app.has(OPTIONAL_AUDIT_SINK);

  if (hasOptionalAuditSink) {
    const sink = app.make(OPTIONAL_AUDIT_SINK);
    if (sink && typeof sink.record === "function") {
      sink.record({ event: "has-example-provider.boot" });
    }
  }

  app.instance(HAS_REPORT, {
    hasOptionalAuditSink,
    usedFallbackPath: !hasOptionalAuditSink
  });
}
```

Why this is useful:

- It keeps packages composable.
- It avoids hard failures for non-required capabilities.

### `tag(token, tagName)` with `TagExampleProvider`

Use `tag` when many tokens belong to one logical group.

Typical use case:

- plugin contributors
- formatter/adapter registries
- policy strategy catalogs

Step 1: register multiple concrete bindings.

```js
const FORMATTER_UPPER = "docs.examples.02.tag.formatter.upper";
const FORMATTER_LOWER = "docs.examples.02.tag.formatter.lower";
const FORMATTER_TAG = "docs.examples.02.tag.formatters";

register(app) {
  app.singleton(FORMATTER_UPPER, () => ({
    id: "upper",
    format(value) {
      return String(value || "").toUpperCase();
    }
  }));

  app.singleton(FORMATTER_LOWER, () => ({
    id: "lower",
    format(value) {
      return String(value || "").toLowerCase();
    }
  }));
}
```

Step 2: tag both tokens to one group.

```js
register(app) {
  // existing singleton registrations...
  app.tag(FORMATTER_UPPER, FORMATTER_TAG);
  app.tag(FORMATTER_LOWER, FORMATTER_TAG);
}
```

Step 3: leave a simple report token for downstream providers.

```js
const TAG_REPORT = "docs.examples.02.tag.report";

boot(app) {
  app.instance(TAG_REPORT, {
    tagName: FORMATTER_TAG,
    taggedTokens: [FORMATTER_UPPER, FORMATTER_LOWER]
  });
}
```

Why this is useful:

- It decouples producers from consumers.
- New contributors can be added without editing consumer code.

### `resolveTag(tagName)` with `ResolveTagExampleProvider`

Use `resolveTag` to get all implementations for a tag and process them as a set.

Typical use case:

- run all contributors
- build a dynamic strategy list
- aggregate outputs from multiple providers

Step 1: ensure dependency on tag-producing provider.

```js
class ResolveTagExampleProvider {
  static id = "docs.examples.02.resolveTag";
  static dependsOn = ["docs.examples.02.tag"];

  register() {}

  boot(app) {}
}
```

Step 2: resolve and apply all formatters.

```js
const FORMATTER_TAG = "docs.examples.02.tag.formatters";
const RESOLVE_TAG_REPORT = "docs.examples.02.resolveTag.report";

boot(app) {
  const formatters = app.resolveTag(FORMATTER_TAG);
  const sample = "HeLLo";

  app.instance(RESOLVE_TAG_REPORT, {
    formatterCount: formatters.length,
    output: formatters.map((formatter) => ({
      id: formatter.id,
      value: formatter.format(sample)
    }))
  });
}
```

Why this is useful:

- Consumers scale without hardcoding provider token lists.
- Provider ecosystem remains open for extension.

### `createScope(scopeId)` (Additional Patterns) with `CreateScopeExampleProvider`

This section extends the scoped/createScope pair above with another concrete pattern.

Typical use case:

- per-request state
- per-background-job context
- per-transaction temporary data

Step 1: create multiple scopes.

```js
const searchScope = app.createScope("search-request");
const checkoutScope = app.createScope("checkout-request");
```

Step 2: use scoped binding in each scope.

```js
const CART = "docs.examples.02.scoped.cart";
const CREATE_SCOPE_REPORT = "docs.examples.02.createScope.report";

boot(app) {
  const searchScope = app.createScope("search-request");
  const checkoutScope = app.createScope("checkout-request");

  const searchCart = searchScope.make(CART);
  const checkoutCart = checkoutScope.make(CART);

  searchCart.add("preview-item");
  checkoutCart.add("final-item");

  app.instance(CREATE_SCOPE_REPORT, {
    differentScopeObjects: searchScope !== checkoutScope,
    searchItems: searchCart.list(),
    checkoutItems: checkoutCart.list(),
    searchScopeId: searchCart.scopeId,
    checkoutScopeId: checkoutCart.scopeId
  });
}
```

Why this is useful:

- It prevents state bleed between operations.
- It makes scoped bindings genuinely practical.

## Provider Lifecycle: `register`, `boot`, `shutdown`

You use these methods every day in provider classes.

`register(app)`:

- declare bindings (`bind`, `singleton`, `scoped`, `instance`)

`boot(app)`:

- consume bindings (`make`, `has`, `resolveTag`, `createScope`) and compose behavior

`shutdown(app)`:

- release resources safely in reverse provider order

Mini tutorial with `ShutdownExampleProvider`:

Step 1: register a resource.

```js
const RESOURCE = "docs.examples.02.shutdown.resource";

register(app) {
  app.singleton(RESOURCE, () => {
    const state = {
      startedAt: new Date().toISOString(),
      closedAt: null
    };

    return {
      state,
      close() {
        state.closedAt = new Date().toISOString();
      }
    };
  });
}
```

Step 2: observe startup state in `boot`.

```js
const SHUTDOWN_REPORT = "docs.examples.02.shutdown.report";

boot(app) {
  const resource = app.make(RESOURCE);
  app.instance(SHUTDOWN_REPORT, {
    startedAt: resource.state.startedAt,
    closedAt: resource.state.closedAt
  });
}
```

Step 3: close resource in `shutdown`.

```js
shutdown(app) {
  if (!app.has(RESOURCE)) {
    return;
  }

  const resource = app.make(RESOURCE);
  resource.close();
}
```

Why this is useful:

- It keeps startup and teardown explicit.
- It helps prevent resource leaks in long-running services.

## Error Classes

This section answers four practical questions:

- who emits each error class
- whether everyday app developers should throw it
- what real-life mistake triggers it
- what the shortest example looks like

Direct rule first:

- Everyday app code should usually throw `AppError`.
- Most other error classes below are emitted by framework internals when contracts are broken.

### `KernelError` (`@jskit-ai/kernel/server/kernel`)

Emitted by: Kernel internals via subclasses (`ProviderNormalizationError`, `ProviderDependencyError`, etc.).

Solution: Do not throw it directly in normal app code. Catch it when you want a single startup-failure bucket.
Practical real case:

```js
import { createApplication, KernelError } from "@jskit-ai/kernel/server/kernel";

try {
  await createApplication().start({ providers: [] });
} catch (error) {
  if (error instanceof KernelError) {
    console.error("Kernel startup failure:", error.message);
  }
}
```

### `ProviderNormalizationError` (`@jskit-ai/kernel/server/kernel`)

Emitted by: `Application` while normalizing provider entries.

Solution: Usually no. Fix provider shape/metadata.

Practical real case:

```js
import { createApplication } from "@jskit-ai/kernel/server/kernel";

class PaymentsProvider {
  // Missing: static id = "app.payments";
  register() {}
}

await createApplication().start({ providers: [PaymentsProvider] });
```

### `DuplicateProviderError` (`@jskit-ai/kernel/server/kernel`)

Emitted by: `Application` when two providers share the same `id`.

Solution: Usually no. Make IDs unique.

Practical real case:

```js
import { createApplication } from "@jskit-ai/kernel/server/kernel";

class DbProviderA {
  static id = "app.db";
}

class DbProviderB {
  static id = "app.db";
}

await createApplication().start({ providers: [DbProviderA, DbProviderB] });
```

### `ProviderDependencyError` (`@jskit-ai/kernel/server/kernel`)

Emitted by: `Application` when `dependsOn` is missing or cyclic.

Solution: Usually no. Fix dependency graph.

Practical real case:

```js
import { createApplication } from "@jskit-ai/kernel/server/kernel";

class BillingProvider {
  static id = "app.billing";
  static dependsOn = ["app.database"]; // not loaded
}

await createApplication().start({ providers: [BillingProvider] });
```

### `ProviderLifecycleError` (`@jskit-ai/kernel/server/kernel`)

Emitted by: `Application` when provider `register`, `boot`, or `shutdown` throws.

Solution: Usually no. Your provider throws a normal error; framework wraps it.

Practical real case:

```js
import { createApplication } from "@jskit-ai/kernel/server/kernel";

class DatabaseProvider {
  static id = "app.database";

  boot() {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required.");
    }
  }
}

await createApplication().start({ providers: [DatabaseProvider] });
```

### `ContainerError` (`@jskit-ai/kernel/server/container`)

Emitted by: Container internals via subclasses (`InvalidTokenError`, `UnresolvedTokenError`, etc.).

Solution: Do not throw it directly in normal app code. Catch it when you want one DI/container-failure bucket.

Practical real case:

```js
import { createContainer, ContainerError } from "@jskit-ai/kernel/server/container";

try {
  const container = createContainer();
  container.make("missing.token");
} catch (error) {
  if (error instanceof ContainerError) {
    console.error("Container error:", error.message);
  }
}
```

### `InvalidTokenError` (`@jskit-ai/kernel/server/container`)

Emitted by: `Container` when token is invalid (empty string, unsupported type).

Solution: Usually no. Fix token shape.

Practical real case:

```js
import { createContainer } from "@jskit-ai/kernel/server/container";

const container = createContainer();
container.bind("   ", () => ({}));
```

### `InvalidFactoryError` (`@jskit-ai/kernel/server/container`)

Emitted by: `Container` when `bind`/`singleton`/`scoped` receives non-function factory.

Solution: Usually no. Pass a function.

Practical real case:

```js
import { createContainer } from "@jskit-ai/kernel/server/container";

const container = createContainer();
container.singleton("app.db", { url: "not-a-factory" });
```

### `DuplicateBindingError` (`@jskit-ai/kernel/server/container`)

Emitted by: `Container` when the same token is registered twice.

Solution: Usually no. Register each token once.

Practical real case:

```js
import { createContainer } from "@jskit-ai/kernel/server/container";

const container = createContainer();
container.bind("app.cache", () => new Map());
container.instance("app.cache", new Map());
```

### `UnresolvedTokenError` (`@jskit-ai/kernel/server/container`)

Emitted by: `Container` when `make(token)` or `tag(token, ...)` uses unknown token.

Solution: Usually no. Register token first or use `has(...)` for optional values.

Practical real case:

```js
import { createContainer } from "@jskit-ai/kernel/server/container";

const container = createContainer();
container.make("app.mailer");
```

### `CircularDependencyError` (`@jskit-ai/kernel/server/container`)

Emitted by: `Container` during `make(...)` when resolution cycle exists.

Solution: Usually no. Break cycle by refactoring dependencies.

Practical real case:

```js
import { createContainer } from "@jskit-ai/kernel/server/container";

const container = createContainer();

container.singleton("A", (scope) => ({ b: scope.make("B") }));
container.singleton("B", (scope) => ({ a: scope.make("A") }));

container.make("A");
```

### `HttpKernelError` (`@jskit-ai/kernel/server/http`)

Emitted by: HTTP internals via subclasses (`RouteDefinitionError`, `RouteRegistrationError`).

Solution: Do not throw it directly in normal app code. Catch it to bucket HTTP wiring failures.

Practical real case:

```js
import { createRouter, HttpKernelError } from "@jskit-ai/kernel/server/http";

try {
  const router = createRouter();
  router.get("users", () => {}); // invalid path (missing leading '/')
} catch (error) {
  if (error instanceof HttpKernelError) {
    console.error("HTTP wiring error:", error.message);
  }
}
```

### `RouteDefinitionError` (`@jskit-ai/kernel/server/http`)

Emitted by: `HttpRouter` while defining invalid routes.

Solution: Usually no. Fix route declaration.

Practical real case:

```js
import { createRouter } from "@jskit-ai/kernel/server/http";

const router = createRouter();
router.get("users", () => {}); // must start with '/'
```

### `RouteRegistrationError` (`@jskit-ai/kernel/server/http`)

Emitted by: HTTP kernel registration functions when Fastify/app wiring is invalid.

Solution: Usually no. Fix runtime wiring inputs.

Practical real case:

```js
import { registerRoutes } from "@jskit-ai/kernel/server/http";

registerRoutes({}, { routes: [] }); // not a Fastify instance
```

### `AppError` (`@jskit-ai/kernel/server/runtime`)

Emitted by: Runtime helpers and app code for expected request/API failures.

Solution: Yes. This is the primary error class for business/API failures.

Practical real case:

```js
import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime";

function updateProfile(request) {
  if (!request?.body?.email) {
    throw createValidationError({ email: "Email is required." });
  }

  if (!request.user) {
    throw new AppError(401, "Authentication required.", {
      code: "AUTH_REQUIRED"
    });
  }
}
```

Practical debugging tip:

- Start with `error.name`, `error.message`, and `error.details`.
- For provider startup issues, check provider `id` and `dependsOn` first.
- For request-time API failures, prefer explicit `AppError` over generic `Error`.

## Chapter 2 Part 2 Routing Coverage Mock

Part 2 is not fully written yet, but this is the API surface we consider covered for routing in Chapter 2.

Routing definition APIs to cover:

- `@jskit-ai/kernel/server/http` `HttpRouter`
- `HttpRouter.register(method, path, optionsOrHandler, maybeHandler)`
- `HttpRouter.get(path, optionsOrHandler, maybeHandler)`
- `HttpRouter.post(path, optionsOrHandler, maybeHandler)`
- `HttpRouter.put(path, optionsOrHandler, maybeHandler)`
- `HttpRouter.patch(path, optionsOrHandler, maybeHandler)`
- `HttpRouter.delete(path, optionsOrHandler, maybeHandler)`
- `HttpRouter.group({ prefix, middleware }, defineRoutes)`
- `HttpRouter.resource(name, controller, options)`
- `HttpRouter.apiResource(name, controller, options)`
- `HttpRouter.list()`
- `@jskit-ai/kernel/server/http` `createRouter(options)`
- `@jskit-ai/kernel/server/http` `joinPath(left, right)`

Routing runtime wiring APIs to cover:

- `@jskit-ai/kernel/server/http` `registerRoutes(fastify, options)`
- `@jskit-ai/kernel/server/http` `registerHttpRuntime(app, options)`
- `@jskit-ai/kernel/server/http` `createHttpRuntime({ app, fastify, router })`
- `@jskit-ai/kernel/server/http` `defaultApplyRoutePolicy(routeOptions, route)`
- `@jskit-ai/kernel/server/http` `normalizeRoutePolicyConfig(routeOptions, route)`
- `@jskit-ai/kernel/server/http` `defaultMissingHandler(request, reply)`

Routing error APIs to cover:

- `@jskit-ai/kernel/server/http` `HttpKernelError`
- `@jskit-ai/kernel/server/http` `RouteDefinitionError`
- `@jskit-ai/kernel/server/http` `RouteRegistrationError`
- `@jskit-ai/kernel/server/runtime` `AppError` (request-time handling path)

Related runtime route-registration API to cover:

- `@jskit-ai/kernel/server/runtime` `registerApiRouteDefinitions(fastify, options)`
