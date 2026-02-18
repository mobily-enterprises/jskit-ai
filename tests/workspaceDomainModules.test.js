import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail } from "../shared/auth/utils.js";
import { buildWorkspaceBaseSlug, buildWorkspaceName, toSlugPart } from "../server/domain/workspace/policies/workspaceNaming.js";
import {
  createMembershipIndexes,
  mapMembershipSummary,
  normalizeMembershipForAccess,
  normalizePermissions,
  resolveMembershipRoleId,
  resolveMembershipStatus
} from "../server/domain/workspace/policies/workspaceAccess.js";
import { createWorkspaceSettingsDefaults } from "../server/domain/workspace/policies/workspacePolicyDefaults.js";
import {
  mapPendingInviteSummary,
  mapUserSettingsPublic,
  mapWorkspaceSettingsPublic,
  mapWorkspaceMembershipSummary,
  normalizeWorkspaceColor
} from "../server/domain/workspace/mappers/workspaceMappers.js";
import { resolveRequestedWorkspaceSlug, resolveRequestSurfaceId } from "../server/domain/workspace/lookups/workspaceRequestContext.js";


test("workspace naming primitives normalize text and slug/name fallback behavior", () => {
  assert.equal(toSlugPart("  Chiara Mobily  "), "chiara-mobily");
  assert.equal(toSlugPart("###"), "");
  assert.equal(normalizeEmail("  User@Example.com "), "user@example.com");

  assert.equal(buildWorkspaceName({ displayName: "Tony", email: "tony@example.com", id: 7 }), "Tony Workspace");
  assert.equal(buildWorkspaceName({ displayName: "", email: "tony@example.com", id: 7 }), "tony Workspace");
  assert.equal(buildWorkspaceName({ displayName: "", email: "", id: 7 }), "Workspace 7");

  assert.equal(buildWorkspaceBaseSlug({ displayName: "Tony Mobily", email: "tony@example.com", id: 7 }), "tony-mobily");
  assert.equal(buildWorkspaceBaseSlug({ displayName: "", email: "Tony.Example@example.com", id: 7 }), "tony-example");
  assert.equal(buildWorkspaceBaseSlug({ displayName: "", email: "", id: 7 }), "user-7");
});

test("workspace mappers normalize color, summary, settings and invite payloads", () => {
  assert.equal(normalizeWorkspaceColor("#0f6b54"), "#0F6B54");
  assert.equal(normalizeWorkspaceColor("bad-color"), "#0F6B54");

  const workspaceSummary = mapWorkspaceMembershipSummary(
    {
      id: 11,
      slug: "acme",
      name: "Acme",
      color: "#112233",
      avatarUrl: "https://example.com/acme.png",
      roleId: "member"
    },
    {
      isAccessible: false
    }
  );
  assert.deepEqual(workspaceSummary, {
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#112233",
    avatarUrl: "https://example.com/acme.png",
    roleId: "member",
    isAccessible: false
  });

  const settings = mapWorkspaceSettingsPublic(
    {
      invitesEnabled: true,
      policy: {
        defaultMode: "pv",
        defaultTiming: "due",
        defaultPaymentsPerYear: 4,
        defaultHistoryPageSize: 25
      }
    },
    {
      appInvitesEnabled: true,
      collaborationEnabled: true
    }
  );
  assert.equal(settings.invitesEnabled, true);
  assert.equal(settings.invitesAvailable, true);
  assert.equal(settings.invitesEffective, true);
  assert.equal(settings.defaultMode, "pv");
  assert.equal(settings.defaultTiming, "due");
  assert.equal(settings.defaultPaymentsPerYear, 4);
  assert.equal(settings.defaultHistoryPageSize, 25);
  assert.equal(mapWorkspaceSettingsPublic(null), null);

  const userSettings = mapUserSettingsPublic({
    theme: "dark",
    locale: "en-GB",
    timeZone: "Europe/London",
    dateFormat: "dmy",
    numberFormat: "dot-comma",
    currencyCode: "EUR",
    avatarSize: 96,
    lastActiveWorkspaceId: "3"
  });
  assert.equal(userSettings.theme, "dark");
  assert.equal(userSettings.lastActiveWorkspaceId, 3);
  assert.equal(mapUserSettingsPublic({}).theme, "system");

  const pendingInvite = mapPendingInviteSummary({
    id: 15,
    workspaceId: 9,
    token: "inviteh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    roleId: "member",
    status: "pending",
    expiresAt: "2026-02-20T00:00:00.000Z",
    invitedBy: {
      displayName: "Tony",
      email: "tony@example.com"
    },
    workspace: {
      slug: "acme",
      name: "Acme",
      avatarUrl: "https://example.com/acme.png"
    }
  });
  assert.equal(pendingInvite.workspaceSlug, "acme");
  assert.equal(pendingInvite.invitedByEmail, "tony@example.com");
  assert.equal(
    pendingInvite.token,
    "inviteh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
});

test("workspace access primitives normalize role/status and index structures", () => {
  assert.equal(resolveMembershipRoleId({ roleId: "admin" }), "admin");
  assert.equal(resolveMembershipRoleId({}), "");
  assert.equal(resolveMembershipStatus({ status: "pending" }), "pending");
  assert.equal(resolveMembershipStatus({ membershipStatus: "active" }), "active");
  assert.equal(resolveMembershipStatus({ status: "" }), "active");

  assert.equal(normalizeMembershipForAccess({ roleId: "member", status: "active" }).roleId, "member");
  assert.equal(normalizeMembershipForAccess({ roleId: "member", status: "pending" }), null);
  assert.equal(normalizeMembershipForAccess({ roleId: "", status: "active" }), null);

  assert.equal(mapMembershipSummary({ roleId: "member", status: "active" }).status, "active");
  assert.equal(mapMembershipSummary({ roleId: "member", status: "invited" }), null);

  assert.deepEqual(normalizePermissions(["history.read", "history.read", "", null, " history.write "]), [
    "history.read",
    "history.write"
  ]);
  assert.deepEqual(normalizePermissions(null), []);

  const defaults = createWorkspaceSettingsDefaults(true);
  assert.equal(defaults.invitesEnabled, true);
  assert.deepEqual(defaults.features, {});
  assert.equal(defaults.policy.defaultMode, "fv");

  const indexes = createMembershipIndexes([
    { id: 1, slug: "acme" },
    { id: 2, slug: "bravo" },
    { id: 0, slug: "" }
  ]);
  assert.equal(indexes.byId.get(1).slug, "acme");
  assert.equal(indexes.bySlug.get("bravo").id, 2);
});

test("workspace request context resolves surface and slug from headers/query/params/path", () => {
  assert.equal(
    resolveRequestSurfaceId(
      {
        headers: {
          "x-surface-id": "admin"
        }
      },
      ""
    ),
    "admin"
  );

  assert.equal(
    resolveRequestSurfaceId(
      {
        headers: {
          "x-surface-id": "admin"
        }
      },
      "app"
    ),
    "app"
  );

  assert.equal(
    resolveRequestSurfaceId({
      url: "/admin/w/acme/settings"
    }),
    "admin"
  );

  assert.equal(
    resolveRequestedWorkspaceSlug({
      headers: {
        "x-workspace-slug": "header-slug"
      },
      query: {
        workspaceSlug: "query-slug"
      },
      params: {
        workspaceSlug: "param-slug"
      }
    }),
    "header-slug"
  );

  assert.equal(
    resolveRequestedWorkspaceSlug({
      query: {
        workspaceSlug: "query-slug"
      },
      params: {
        workspaceSlug: "param-slug"
      }
    }),
    "query-slug"
  );

  assert.equal(
    resolveRequestedWorkspaceSlug({
      params: {
        workspaceSlug: "param-slug"
      }
    }),
    "param-slug"
  );

  assert.equal(resolveRequestedWorkspaceSlug({}), "");
});

test("workspace module fallbacks normalize empty/minimal shapes safely", () => {
  assert.equal(normalizeEmail(null), "");
  assert.equal(buildWorkspaceName({}), "Workspace");
  assert.equal(buildWorkspaceBaseSlug({}), "user-workspace");
  assert.equal(normalizeWorkspaceColor(undefined), "#0F6B54");

  const minimalWorkspace = mapWorkspaceMembershipSummary(
    {
      id: "9",
      slug: "",
      name: null,
      color: null,
      avatarUrl: null,
      roleId: null
    },
    {}
  );
  assert.deepEqual(minimalWorkspace, {
    id: 9,
    slug: "",
    name: "",
    color: "#0F6B54",
    avatarUrl: "",
    roleId: "",
    isAccessible: true
  });

  const minimalInvite = mapPendingInviteSummary({
    id: "7",
    workspaceId: "4",
    expiresAt: "2030-01-01T00:00:00.000Z",
    workspace: {},
    invitedBy: {}
  });
  assert.equal(minimalInvite.workspaceSlug, "");
  assert.equal(minimalInvite.workspaceName, "");
  assert.equal(minimalInvite.workspaceAvatarUrl, "");
  assert.equal(minimalInvite.token, "");
  assert.equal(minimalInvite.roleId, "");
  assert.equal(minimalInvite.status, "pending");
  assert.equal(minimalInvite.invitedByDisplayName, "");
  assert.equal(minimalInvite.invitedByEmail, "");

  assert.equal(resolveMembershipStatus({ status: "   ", membershipStatus: "" }), "active");
});
