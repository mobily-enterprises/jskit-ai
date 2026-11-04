import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_WEB_PLACEMENT_RUNTIME,
  SHELL_WEB_PLACEMENT_RUNTIME_KEY,
  useWebPlacementContext,
  useWebPlacementRevision,
  useWebPlacementRuntime
} from "../src/client/placement/inject.js";
import { createWebPlacementRuntime } from "../src/client/placement/runtime.js";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import { mountComposable } from "./support/mountComposable.js";

function mountWithRuntime(useComposable) {
  const runtime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
  return { runtime, ...mountComposable(useComposable(runtime), { provide: [[SHELL_WEB_PLACEMENT_RUNTIME_KEY, runtime]] }) };
}

test("an application without the provider places nothing", () => {
  const { app, result } = mountComposable(() => ({
    runtime: useWebPlacementRuntime(),
    placement: useWebPlacementContext()
  }));

  assert.equal(result.runtime, NO_WEB_PLACEMENT_RUNTIME);
  assert.deepEqual(result.runtime.getPlacements(), []);
  assert.deepEqual(result.placement.context.value, {});
  assert.deepEqual(result.placement.mergeContext({ a: 1 }), {});
  app.unmount();
});

test("the placement context follows the runtime while mounted", () => {
  const { app, result, runtime } = mountWithRuntime(() => useWebPlacementContext);

  runtime.setContext({ surface: "app" });
  assert.equal(result.context.value.surface, "app");

  result.mergeContext({ extra: true }, "test");
  assert.deepEqual(runtime.getContext(), { surface: "app", extra: true });

  result.replaceContext({ only: true }, "test");
  assert.deepEqual(runtime.getContext(), { only: true });

  app.unmount();
  runtime.setContext({ after: true });
  assert.equal(result.context.value.after, undefined);
});

test("the placement revision follows the runtime while mounted", () => {
  const { app, result, runtime } = mountWithRuntime((target) => () => useWebPlacementRevision(target));
  assert.equal(result.value, 0);

  runtime.setContext({ surface: "app" });
  assert.equal(result.value, runtime.getRevision());

  app.unmount();
  const stopped = result.value;
  runtime.setContext({ surface: "admin" });
  assert.equal(result.value, stopped);
});
