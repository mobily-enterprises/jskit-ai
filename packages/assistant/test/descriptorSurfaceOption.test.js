import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

function findFileMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.files) ? descriptor.mutations.files : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

function findTextMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.text) ? descriptor.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant descriptor exposes configurable workspace surface option", () => {
  const option = descriptor?.options?.surfaces;
  assert.equal(option?.required, true);
  assert.equal(option?.inputType, "text");
  assert.equal(option?.defaultValue, "admin");
});

test("assistant descriptor routes workspace page + placements through surface option", () => {
  const workspacePage = findFileMutation("assistant-page-admin-workspace-assistant-index");
  const menuPlacement = findTextMutation("assistant-placement-menu");
  const workspaceSettingsPlacement = findTextMutation("assistant-workspace-settings-form-placement");
  const consoleSettingsPlacement = findTextMutation("assistant-console-settings-form-placement");

  assert.equal(workspacePage?.toSurface, "${option:surfaces|lower}");
  assert.match(String(menuPlacement?.value || ""), /"\$\{option:surfaces\|lower\}"/);
  assert.match(String(menuPlacement?.value || ""), /\.split\(","\)/);
  assert.match(String(menuPlacement?.value || ""), /surfaces: assistantWorkspaceSurfaceIds\.length > 0 \? assistantWorkspaceSurfaceIds : \["\*"\]/);
  assert.doesNotMatch(String(menuPlacement?.value || ""), /surface:\s*"/);
  assert.match(String(workspaceSettingsPlacement?.value || ""), /host: "admin-settings"/);
  assert.match(String(workspaceSettingsPlacement?.value || ""), /surfaces: \["admin"\]/);
  assert.match(String(consoleSettingsPlacement?.value || ""), /host: "console-settings"/);
  assert.match(String(consoleSettingsPlacement?.value || ""), /surfaces: \["console"\]/);
});
