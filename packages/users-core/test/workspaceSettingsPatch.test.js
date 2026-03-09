import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceSettingsPatch } from "../src/shared/workspaceSettingsPatch.js";

test("parseWorkspaceSettingsPatch normalizes valid patch payload", () => {
  const parsed = parseWorkspaceSettingsPatch({
    name: "  Team Mercury  ",
    avatarUrl: " https://example.com/avatar.png ",
    color: "#0f6b54",
    invitesEnabled: false,
    appDenyEmails: ["  FOO@Example.com ", "foo@example.com", "bar@example.com"],
    appDenyUserIds: ["1", 2, "2", "003"]
  });

  assert.deepEqual(parsed.fieldErrors, {});
  assert.deepEqual(parsed.workspacePatch, {
    name: "Team Mercury",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0F6B54"
  });
  assert.deepEqual(parsed.settingsPatch, {
    invitesEnabled: false,
    appDenyEmails: ["foo@example.com", "bar@example.com"],
    appDenyUserIds: [1, 2, 3]
  });
});

test("parseWorkspaceSettingsPatch returns field errors for invalid deny-list IDs", () => {
  const parsed = parseWorkspaceSettingsPatch({
    appDenyUserIds: ["x", "3"]
  });

  assert.deepEqual(parsed.workspacePatch, {});
  assert.deepEqual(parsed.settingsPatch, {});
  assert.equal(parsed.fieldErrors.appDenyUserIds, "appDenyUserIds must be an array of positive integers.");
});

test("parseWorkspaceSettingsPatch validates avatar URL protocol", () => {
  const parsed = parseWorkspaceSettingsPatch({
    avatarUrl: "ftp://example.com/avatar.png"
  });

  assert.deepEqual(parsed.workspacePatch, {});
  assert.deepEqual(parsed.settingsPatch, {});
  assert.equal(
    parsed.fieldErrors.avatarUrl,
    "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
  );
});

test("parseWorkspaceSettingsPatch keeps max-length name rule", () => {
  const parsed = parseWorkspaceSettingsPatch({
    name: "x".repeat(161)
  });

  assert.deepEqual(parsed.workspacePatch, {});
  assert.deepEqual(parsed.settingsPatch, {});
  assert.equal(parsed.fieldErrors.name, "Workspace name must be at most 160 characters.");
});
