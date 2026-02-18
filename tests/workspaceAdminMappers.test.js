import assert from "node:assert/strict";
import test from "node:test";

import {
  mapWorkspaceSettingsResponse,
  mapWorkspaceMemberSummary,
  mapWorkspaceInviteSummary,
  mapWorkspacePayloadSummary
} from "../server/domain/workspace/mappers/workspaceAdminMappers.js";

test("workspace admin mappers map settings/member/invite/payload shapes", () => {
  const workspace = {
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#123456",
    avatarUrl: "",
    ownerUserId: 7,
    isPersonal: false
  };

  const settingsResponse = mapWorkspaceSettingsResponse(
    workspace,
    {
      invitesEnabled: true,
      features: {
        surfaceAccess: {
          app: {
            denyEmails: ["blocked@example.com"],
            denyUserIds: [3]
          }
        }
      },
      policy: {
        defaultMode: "pv",
        defaultTiming: "due",
        defaultPaymentsPerYear: 4,
        defaultHistoryPageSize: 25
      }
    },
    {
      appInvitesEnabled: true,
      collaborationEnabled: true,
      includeAppSurfaceDenyLists: true
    }
  );

  assert.equal(settingsResponse.workspace.slug, "acme");
  assert.equal(settingsResponse.settings.invitesAvailable, true);
  assert.equal(settingsResponse.settings.invitesEffective, true);
  assert.deepEqual(settingsResponse.settings.appDenyEmails, ["blocked@example.com"]);
  assert.deepEqual(settingsResponse.settings.appDenyUserIds, [3]);

  const member = mapWorkspaceMemberSummary(
    {
      userId: 7,
      roleId: "member",
      status: "active",
      user: {
        email: "user@example.com",
        displayName: "User"
      }
    },
    workspace
  );
  assert.equal(member.isOwner, true);

  const invite = mapWorkspaceInviteSummary({
    id: 101,
    workspaceId: 11,
    email: "invitee@example.com",
    roleId: "member",
    status: "pending",
    expiresAt: "2030-01-01T00:00:00.000Z",
    invitedByUserId: 7,
    invitedBy: {
      displayName: "Owner",
      email: "owner@example.com"
    },
    workspace: {
      id: 11,
      slug: "acme",
      name: "Acme",
      color: "bad-color",
      avatarUrl: null
    }
  });
  assert.equal(invite.workspace.color, "#0F6B54");
  assert.equal(invite.invitedByEmail, "owner@example.com");

  const payload = mapWorkspacePayloadSummary({
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#0f6b54",
    avatarUrl: ""
  });
  assert.equal(payload.color, "#0F6B54");
  assert.equal(mapWorkspacePayloadSummary(null), null);
});
