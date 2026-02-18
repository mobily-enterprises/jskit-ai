import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import {
  coerceWorkspaceColor,
  listRoleDescriptors,
  mapWorkspaceSummary,
  normalizeEmail,
  parsePositiveInteger,
  parseWorkspaceSettingsPatch,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults
} from "../server/modules/workspace/lib/workspaceAdminHelpers.js";

test("workspace admin helper primitives normalize values", () => {
  assert.equal(normalizeEmail(" User@Example.com "), "user@example.com");
  assert.equal(parsePositiveInteger("42"), 42);
  assert.equal(parsePositiveInteger(0), null);
  assert.equal(parsePositiveInteger("1.5"), null);

  assert.equal(coerceWorkspaceColor("#0f6b54"), "#0F6B54");
  assert.equal(coerceWorkspaceColor("bad-color"), "#0F6B54");
});

test("workspace admin role helpers build descriptors and assignable ids", () => {
  const descriptors = listRoleDescriptors({
    roles: {
      owner: {
        assignable: false,
        permissions: ["*", "workspace.settings.update"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", "history.read"]
      },
      viewer: {
        assignable: false,
        permissions: ["history.read"]
      }
    }
  });

  assert.equal(descriptors[0].id, "owner");
  assert.equal(descriptors.find((descriptor) => descriptor.id === "member").assignable, true);
  assert.deepEqual(descriptors.find((descriptor) => descriptor.id === "member").permissions, ["history.read"]);

  assert.deepEqual(
    resolveAssignableRoleIds({ roles: { owner: { assignable: false }, member: { assignable: true } } }),
    ["member"]
  );

  const descriptorsFromInvalidManifest = listRoleDescriptors(null);
  assert.deepEqual(descriptorsFromInvalidManifest, []);

  const descriptorsWithNullRole = listRoleDescriptors({
    roles: {
      "": {
        assignable: true,
        permissions: [null, "history.read", "history.read"]
      },
      member: null,
      owner: {
        assignable: false,
        permissions: ["*"]
      }
    }
  });
  assert.equal(descriptorsWithNullRole.find((descriptor) => descriptor.id === "member").assignable, false);
});

test("resolveWorkspaceDefaults validates policy ranges and fallback values", () => {
  const defaults = resolveWorkspaceDefaults({
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 4,
    defaultHistoryPageSize: 25
  });
  assert.equal(defaults.defaultMode, "pv");
  assert.equal(defaults.defaultTiming, "due");
  assert.equal(defaults.defaultPaymentsPerYear, 4);
  assert.equal(defaults.defaultHistoryPageSize, 25);

  const fallbackDefaults = resolveWorkspaceDefaults({
    defaultMode: "invalid",
    defaultTiming: "invalid",
    defaultPaymentsPerYear: 0,
    defaultHistoryPageSize: 999
  });
  assert.equal(fallbackDefaults.defaultMode, "fv");
  assert.equal(fallbackDefaults.defaultTiming, "ordinary");
  assert.equal(fallbackDefaults.defaultPaymentsPerYear, 12);
  assert.equal(fallbackDefaults.defaultHistoryPageSize, 10);

  const nullPolicyDefaults = resolveWorkspaceDefaults(null);
  assert.equal(nullPolicyDefaults.defaultMode, "fv");
  assert.equal(nullPolicyDefaults.defaultTiming, "ordinary");
});

test("parseWorkspaceSettingsPatch parses valid fields and reports field-level errors", () => {
  const parsed = parseWorkspaceSettingsPatch({
    name: "Acme Prime",
    avatarUrl: "https://example.com/acme.png",
    color: "#123456",
    invitesEnabled: true,
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 24,
    defaultHistoryPageSize: 30,
    appDenyEmails: [" one@example.com ", "two@example.com", "one@example.com"],
    appDenyUserIds: [1, "2", 1]
  });

  assert.deepEqual(parsed.fieldErrors, {});
  assert.equal(parsed.workspacePatch.name, "Acme Prime");
  assert.equal(parsed.workspacePatch.avatarUrl, "https://example.com/acme.png");
  assert.equal(parsed.workspacePatch.color, "#123456");
  assert.equal(parsed.settingsPatch.invitesEnabled, true);
  assert.deepEqual(parsed.settingsPatch.defaults, {
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 24,
    defaultHistoryPageSize: 30
  });
  assert.deepEqual(parsed.settingsPatch.appSurfaceAccess, {
    denyEmails: ["one@example.com", "two@example.com"],
    denyUserIds: [1, 2]
  });

  const invalid = parseWorkspaceSettingsPatch({
    name: "",
    avatarUrl: "ftp://example.com/acme.png",
    color: "not-a-color",
    invitesEnabled: "yes",
    defaultMode: "invalid",
    defaultTiming: "invalid",
    defaultPaymentsPerYear: 0,
    defaultHistoryPageSize: 101,
    appDenyEmails: ["bad-email"],
    appDenyUserIds: ["bad-id"]
  });

  assert.equal(invalid.workspacePatch.name, undefined);
  assert.equal(invalid.settingsPatch.defaults, undefined);
  assert.equal(invalid.settingsPatch.appSurfaceAccess, undefined);
  assert.equal(invalid.fieldErrors.name.includes("required"), true);
  assert.equal(invalid.fieldErrors.avatarUrl.includes("http://"), true);
  assert.equal(invalid.fieldErrors.color.includes("hex color"), true);
  assert.equal(invalid.fieldErrors.invitesEnabled.includes("boolean"), true);
  assert.equal(invalid.fieldErrors.defaultMode.includes("fv or pv"), true);
  assert.equal(invalid.fieldErrors.defaultTiming.includes("ordinary or due"), true);
  assert.equal(invalid.fieldErrors.defaultPaymentsPerYear.includes("1 to 365"), true);
  assert.equal(invalid.fieldErrors.defaultHistoryPageSize.includes("1 to 100"), true);
  assert.equal(invalid.fieldErrors.appDenyEmails.includes("valid email"), true);
  assert.equal(invalid.fieldErrors.appDenyUserIds.includes("positive integers"), true);

  const oversizedName = parseWorkspaceSettingsPatch({
    name: "x".repeat(161)
  });
  assert.equal(oversizedName.fieldErrors.name.includes("at most 160"), true);

  const nullPayload = parseWorkspaceSettingsPatch(null);
  assert.deepEqual(nullPayload, {
    workspacePatch: {},
    settingsPatch: {},
    fieldErrors: {}
  });

  const avatarUrlNull = parseWorkspaceSettingsPatch({
    avatarUrl: null
  });
  assert.equal(avatarUrlNull.workspacePatch.avatarUrl, "");

  const appDenyUserIdsOnly = parseWorkspaceSettingsPatch({
    appDenyUserIds: [5, 5]
  });
  assert.deepEqual(appDenyUserIdsOnly.settingsPatch.appSurfaceAccess, {
    denyUserIds: [5]
  });

  const nonArrayDenyLists = parseWorkspaceSettingsPatch({
    appDenyEmails: "not-an-array",
    appDenyUserIds: "not-an-array"
  });
  assert.equal(nonArrayDenyLists.fieldErrors.appDenyEmails.includes("array"), true);
  assert.equal(nonArrayDenyLists.fieldErrors.appDenyUserIds.includes("array"), true);

  const emptyColorAndDefaults = parseWorkspaceSettingsPatch({
    avatarUrl: "   ",
    color: "",
    defaultMode: null,
    defaultTiming: null
  });
  assert.equal(emptyColorAndDefaults.workspacePatch.avatarUrl, "");
  assert.equal(emptyColorAndDefaults.fieldErrors.color.includes("hex color"), true);
  assert.equal(emptyColorAndDefaults.fieldErrors.defaultMode.includes("fv or pv"), true);
  assert.equal(emptyColorAndDefaults.fieldErrors.defaultTiming.includes("ordinary or due"), true);

  const throwingStringValues = parseWorkspaceSettingsPatch({
    avatarUrl: {
      toString() {
        throw new Error("boom-avatar");
      }
    },
    color: {
      toString() {
        throw new Error("boom-color");
      }
    }
  });
  assert.equal(throwingStringValues.fieldErrors.avatarUrl, "Workspace avatar URL is invalid.");
  assert.equal(throwingStringValues.fieldErrors.color, "Workspace color is invalid.");
});

test("mapWorkspaceSummary coerces workspace output shape", () => {
  const summary = mapWorkspaceSummary({
    id: "11",
    slug: "acme",
    name: "Acme",
    color: "invalid",
    avatarUrl: null,
    ownerUserId: "5",
    isPersonal: 0
  });

  assert.deepEqual(summary, {
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#0F6B54",
    avatarUrl: "",
    ownerUserId: 5,
    isPersonal: false
  });

  const minimalSummary = mapWorkspaceSummary({
    id: 1,
    slug: null,
    name: null,
    color: null,
    avatarUrl: null,
    ownerUserId: null,
    isPersonal: null
  });
  assert.equal(minimalSummary.slug, "");
  assert.equal(minimalSummary.name, "");
});

test("parseWorkspaceSettingsPatch handles avatar URL validation error classes", () => {
  const badAbsoluteUrl = parseWorkspaceSettingsPatch({
    avatarUrl: "not-an-url"
  });
  assert.equal(badAbsoluteUrl.fieldErrors.avatarUrl.includes("valid absolute URL"), true);

  const badProtocolUrl = parseWorkspaceSettingsPatch({
    avatarUrl: "ftp://example.com/file.png"
  });
  assert.equal(badProtocolUrl.fieldErrors.avatarUrl.includes("http:// or https://"), true);

  let nonAppErrorCaught = false;
  try {
    throw new Error("unexpected");
  } catch (error) {
    nonAppErrorCaught = !(error instanceof AppError);
  }
  assert.equal(nonAppErrorCaught, true);
});
