import assert from "node:assert/strict";
import test from "node:test";

import { resolveActionContributorModuleIds } from "../../server/framework/composeActions.js";
import { composeRealtimePolicy } from "../../server/framework/composeRealtime.js";
import { REALTIME_TOPICS } from "../../shared/eventTypes.js";

test("resolveActionContributorModuleIds derives action contributors from module registry", () => {
  const allModuleIds = resolveActionContributorModuleIds();

  const expectedModuleIds = [
    "auth",
    "workspace",
    "console",
    "chat",
    "social",
    "billing",
    "settings",
    "alerts",
    "projects",
    "history",
    "ai",
    "consoleErrors",
    "communications"
  ];

  for (const moduleId of expectedModuleIds) {
    assert.equal(allModuleIds.has(moduleId), true, `Missing action-contributor module ${moduleId}.`);
  }

  const filteredModuleIds = resolveActionContributorModuleIds({
    enabledModuleIds: ["auth", "workspace", "health"]
  });
  assert.deepEqual(Array.from(filteredModuleIds).sort((left, right) => left.localeCompare(right)), [
    "auth",
    "workspace"
  ]);
});

test("composeRealtimePolicy returns topic/rule artifacts by surface", () => {
  const appRealtime = composeRealtimePolicy({
    surface: "app"
  });

  assert.equal(appRealtime.topics.includes(REALTIME_TOPICS.PROJECTS), true);
  assert.equal(appRealtime.topics.includes(REALTIME_TOPICS.CONSOLE_MEMBERS), false);
  assert.ok(appRealtime.rules[REALTIME_TOPICS.PROJECTS]);

  const consoleRealtime = composeRealtimePolicy({
    surface: "console"
  });
  assert.equal(consoleRealtime.topics.includes(REALTIME_TOPICS.CONSOLE_MEMBERS), true);
  assert.equal(consoleRealtime.topics.includes(REALTIME_TOPICS.PROJECTS), false);
});
