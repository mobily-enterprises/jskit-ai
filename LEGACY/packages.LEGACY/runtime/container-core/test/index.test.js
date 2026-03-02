import assert from "node:assert/strict";
import test from "node:test";
import {
  CircularDependencyError,
  DuplicateBindingError,
  UnresolvedTokenError,
  createContainer
} from "../src/lib/index.js";

test("bind resolves transient factory on every make", () => {
  const container = createContainer();
  let createdCount = 0;

  container.bind("counter", () => ({ id: ++createdCount }));

  const first = container.make("counter");
  const second = container.make("counter");
  assert.notStrictEqual(first, second);
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
});

test("singleton resolves factory once", () => {
  const container = createContainer();
  let createdCount = 0;

  container.singleton("settings", () => ({ id: ++createdCount }));

  const first = container.make("settings");
  const second = container.make("settings");
  assert.strictEqual(first, second);
  assert.equal(createdCount, 1);
});

test("scoped lifetime is isolated across scopes", () => {
  const container = createContainer();
  let createdCount = 0;

  container.scoped("requestId", () => ({ id: ++createdCount }));

  const scopeA = container.createScope("request-A");
  const scopeB = container.createScope("request-B");

  const a1 = scopeA.make("requestId");
  const a2 = scopeA.make("requestId");
  const b1 = scopeB.make("requestId");

  assert.strictEqual(a1, a2);
  assert.notStrictEqual(a1, b1);
  assert.equal(a1.id, 1);
  assert.equal(b1.id, 2);
});

test("instance binds concrete values", () => {
  const container = createContainer();
  const clock = { now: () => 123 };

  container.instance("clock", clock);

  assert.strictEqual(container.make("clock"), clock);
});

test("duplicate binding fails fast", () => {
  const container = createContainer();
  container.bind("logger", () => ({ info() {} }));

  assert.throws(
    () => container.bind("logger", () => ({ warn() {} })),
    DuplicateBindingError
  );
});

test("unresolved token throws explicit error", () => {
  const container = createContainer();
  assert.throws(() => container.make("missing"), UnresolvedTokenError);
});

test("tag resolution is deterministic", () => {
  const container = createContainer();
  container.bind("plugin.zeta", () => "zeta");
  container.bind("plugin.alpha", () => "alpha");
  container.bind("plugin.beta", () => "beta");

  container.tag("plugin.zeta", "plugins");
  container.tag("plugin.alpha", "plugins");
  container.tag("plugin.beta", "plugins");

  const resolved = container.resolveTag("plugins");
  assert.deepEqual(resolved, ["alpha", "beta", "zeta"]);
});

test("circular dependencies include cycle path", () => {
  const container = createContainer();
  container.bind("a", (scope) => ({ value: scope.make("b") }));
  container.bind("b", (scope) => ({ value: scope.make("a") }));

  assert.throws(
    () => container.make("a"),
    (error) => {
      assert(error instanceof CircularDependencyError);
      assert.match(String(error.message), /a -> b -> a/);
      return true;
    }
  );
});
