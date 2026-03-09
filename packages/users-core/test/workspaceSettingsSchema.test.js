import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { workspaceSettingsSchema } from "../src/shared/schemas/resources/workspaceSettingsSchema.js";

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "body",
    value: payload
  });
}

test("workspace settings patch body validates valid payload without normalization", () => {
  const parsed = parseBody(workspaceSettingsSchema.operations.patch, {
    name: "Team Mercury",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0F6B54",
    invitesEnabled: false,
    appDenyEmails: ["foo@example.com", "bar@example.com"],
    appDenyUserIds: [1, 2, 3]
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fieldErrors, {});
  assert.deepEqual(parsed.value, {
    name: "Team Mercury",
    avatarUrl: "https://example.com/avatar.png",
    color: "#0F6B54",
    invitesEnabled: false,
    appDenyEmails: ["foo@example.com", "bar@example.com"],
    appDenyUserIds: [1, 2, 3]
  });
});

test("workspace settings patch body returns field error for invalid deny-list IDs", () => {
  const parsed = parseBody(workspaceSettingsSchema.operations.patch, {
    appDenyUserIds: ["x", "3"]
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.appDenyUserIds, "appDenyUserIds must be an array of positive integers.");
});

test("workspace settings patch body validates avatar URL protocol", () => {
  const parsed = parseBody(workspaceSettingsSchema.operations.patch, {
    avatarUrl: "ftp://example.com/avatar.png"
  });

  assert.equal(parsed.ok, false);
  assert.equal(
    parsed.fieldErrors.avatarUrl,
    "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
  );
});

test("workspace settings patch body keeps max-length name rule", () => {
  const parsed = parseBody(workspaceSettingsSchema.operations.patch, {
    name: "x".repeat(161)
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.name, "Workspace name must be at most 160 characters.");
});

test("workspace settings create body requires full-write fields", () => {
  const parsed = parseBody(workspaceSettingsSchema.operations.create, {
    name: "Mercury Workspace"
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.color, "Workspace color is required.");
  assert.equal(parsed.fieldErrors.invitesEnabled, "invitesEnabled is required.");
});
