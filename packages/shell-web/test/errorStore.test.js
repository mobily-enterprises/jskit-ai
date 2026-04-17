import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
import { createErrorPresentationStore } from "../src/client/error/store.js";
import { useShellErrorPresentationStore } from "../src/client/stores/useShellErrorPresentationStore.js";

test("error presentation store keeps banner channel singleton", () => {
  const store = createErrorPresentationStore({ now: () => 1000 });
  const firstId = store.present("banner", { message: "First banner" });
  const secondId = store.present("banner", { message: "Second banner" });

  const state = store.getState();
  assert.equal(state.channels.banner.length, 1);
  assert.equal(state.channels.banner[0].id, secondId);
  assert.equal(state.channels.banner[0].message, "Second banner");
  assert.notEqual(firstId, secondId);
});

test("error presentation store still queues snackbar channel entries", () => {
  const store = createErrorPresentationStore({ now: () => 1000 });
  store.present("snackbar", { message: "One" });
  store.present("snackbar", { message: "Two" });

  const state = store.getState();
  assert.equal(state.channels.snackbar.length, 2);
  assert.equal(state.channels.snackbar[0].message, "One");
  assert.equal(state.channels.snackbar[1].message, "Two");
});

test("shell error presentation Pinia store mirrors runtime presentation state", () => {
  const pinia = createPinia();
  const runtimeStore = createErrorPresentationStore({ now: () => 1000 });
  const store = useShellErrorPresentationStore(pinia);

  store.attachRuntimeStore(runtimeStore);
  runtimeStore.present("snackbar", { message: "Hello" });

  assert.equal(store.channels.snackbar.length, 1);
  assert.equal(store.channels.snackbar[0].message, "Hello");
  assert.equal(store.getState().channels.snackbar[0].message, "Hello");
});
