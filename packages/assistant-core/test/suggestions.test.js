import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import { useAssistantSuggestions } from "../src/client/conversation/useAssistantSuggestions.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
const suggestion = prompt => ({ label: "Suggested next step", prompt });

test("suggestions debounce drafts and independently configure their generator", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = effectScope();
  t.after(() => scope.stop());
  const draft = ref("");
  const configuration = ref({ agent: "quick-suggestions", model: "small", instructions: "Suggest a next step" });
  const calls = [];
  const state = scope.run(() => useAssistantSuggestions({ draft, configuration,
    generate: async input => { calls.push(input); return [suggestion(input.draft || input.configuration.model)]; }
  }));
  draft.value = "First";
  t.mock.timers.tick(500);
  draft.value = "Second";
  t.mock.timers.tick(749);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].draft, "Second");
  assert.deepEqual(calls[0].configuration, configuration.value);
  assert.deepEqual(state.items.value, [suggestion("Second")]);
  configuration.value.model = "other";
  t.mock.timers.tick(750);
  await flush();
  assert.equal(calls[0].configuration.model, "small", "The in-flight configuration is a snapshot");
  assert.equal(calls[1].configuration.model, "other");
});

test("obsolete suggestions cannot return after scope, draft or agent changes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = effectScope();
  const requestKey = ref("conversation-one");
  const draft = ref("");
  const calls = [];
  const generate = ref(input => new Promise(resolve => calls.push({ ...input, resolve })));
  const state = scope.run(() => useAssistantSuggestions({ requestKey, draft, generate }));
  t.mock.timers.tick(750);
  requestKey.value = "conversation-two";
  assert.equal(calls[0].signal.aborted, true);
  t.mock.timers.tick(750);
  draft.value = "New draft";
  assert.equal(calls[1].signal.aborted, true);
  t.mock.timers.tick(750);
  generate.value = async () => [suggestion("New agent")];
  assert.equal(calls[2].signal.aborted, true);
  t.mock.timers.tick(750);
  await flush();
  for (const call of calls) call.resolve([suggestion("Obsolete")]);
  await flush();
  assert.deepEqual(state.items.value, [suggestion("New agent")]);
  requestKey.value = "conversation-three";
  scope.stop();
  t.mock.timers.tick(750);
  assert.equal(state.loading.value, false);
  assert.equal(state.items.value.length, 0);
});

test("suggestion previews preserve a draft and stale selections cannot submit", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = effectScope();
  t.after(() => scope.stop());
  const draft = ref("");
  const selected = [];
  const state = scope.run(() => useAssistantSuggestions({ draft,
    generate: async () => [suggestion("Next step")], onSelect: text => selected.push(text)
  }));
  t.mock.timers.tick(750);
  await flush();
  state.focus();
  assert.equal(state.previewSuggestion(state.items.value[0]), true);
  assert.equal(draft.value, "");
  assert.equal(state.preview.value, "Next step");
  assert.equal(state.select(suggestion("Next step")), true);
  assert.deepEqual(selected, ["Next step"]);
  state.dismiss();
  assert.equal(state.visible.value, false);
  assert.equal(state.select(suggestion("Next step")), false);
  state.blur();
  state.focus();
  t.mock.timers.tick(750);
  await flush();
  assert.equal(state.visible.value, true);
  draft.value = "Keep my text";
  assert.equal(state.preview.value, "");
  assert.equal(state.select(suggestion("Next step")), false);
  assert.equal(draft.value, "Keep my text");
});

test("a failing suggestion agent leaves the composer independent and stops retrying", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = effectScope();
  t.after(() => scope.stop());
  const draft = ref("Keep this");
  let requests = 0;
  const state = scope.run(() => useAssistantSuggestions({ draft,
    generate: async () => { requests++; throw new Error("Suggestion service unavailable"); }
  }));
  t.mock.timers.tick(750);
  await flush();
  assert.equal(state.error.value, "Suggestion service unavailable");
  assert.equal(state.loading.value, false);
  assert.equal(state.visible.value, false);
  assert.equal(draft.value, "Keep this");
  t.mock.timers.tick(60_000);
  assert.equal(requests, 1);
});
