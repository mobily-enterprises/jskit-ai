import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createAudienceContributors, resolveAudienceTargets, revalidateSocket } from "../src/server/realtimeAudience.js";
import { WorkspacesIntegrationsProvider } from "../../workspaces-core/src/server/WorkspacesIntegrationsProvider.js";
import { createInviteRecipientBootstrapAudience } from "../../workspaces-core/src/server/common/support/realtimeServiceEvents.js";
import { createWorkspacesServerI18n } from "../../workspaces-core/src/server/i18n.js";
import { renderDefaultWorkspaceInviteEmail } from "../../workspaces-core/src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";
import { unconfiguredWorkspaceInviteMailer } from "../../workspaces-core/src/server/workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { createWorkspaceInviteUrlBuilder } from "../../workspaces-core/src/server/workspaceMembers/workspaceInviteUrls.js";
import { createService as createMembersService } from "../../workspaces-core/src/server/workspaceMembers/workspaceMembersService.js";
import { workspacesDatabase } from "../../workspaces-core/test/support/mysqlWorkspaces.js";

// Characterization of the realtime audience against the tables it reaches through its contributors and audiences, on
// MariaDB/MySQL, before the workspace stores under them move onto table resources and before realtime builds the
// scope it reads with from the event differently: which rooms an actor's sockets join (their active workspace
// memberships, one read for many actors), how a revalidation follows a membership change, and which users an invite's
// bootstrap audience reaches, read in the event's own scope.
const database = workspacesDatabase("da_rt_audience");

function audiencesOf(db) {
  const audiences = createAudienceContributors();
  const noop = () => {};
  WorkspacesIntegrationsProvider.setup({
    actions: { registerContextContributor: noop },
    authExtensions: { registerPolicyContextResolver: noop },
    config: {
      tenancyMode: "workspaces",
      surfaceDefaultId: "customer",
      surfaceDefinitions: { customer: { id: "customer", requiresWorkspace: true, accessPolicyId: "workspace_member" } },
      surfaceAccessPolicies: { workspace_member: { requireWorkspaceMembership: true } }
    },
    http: { registerVisibilityResolver: noop },
    realtime: { registerAudienceContributor: (contributor) => audiences.register(contributor) },
    usersExtensions: { registerProfileSyncLifecycleContributor: noop },
    workspaceMemberships: db.memberships,
    workspaces: {
      invitationsEnabled: false,
      services: { directory: { async resolveWorkspaceContextForUserBySlug() { return null; } } }
    }
  });
  return audiences;
}

function membersService(db) {
  return createMembersService({
    workspaceMembershipsRepository: db.memberships,
    workspaceInvitesRepository: db.invites,
    inviteExpiresInMs: 86400000,
    roleCatalog: db.roleCatalog,
    workspaceInvitationsEnabled: true,
    inviteUrlBuilder: createWorkspaceInviteUrlBuilder({ appConfig: {}, env: {} }),
    workspaceInviteMailer: unconfiguredWorkspaceInviteMailer,
    workspaceInviteEmailTemplate: renderDefaultWorkspaceInviteEmail,
    i18n: createWorkspacesServerI18n(),
    userProfilesRepository: db.profiles,
    userSettingsRepository: db.userSettings
  });
}

async function workspaceOf(db, slug, owner) {
  const workspace = await db.workspaces.insert({ slug, name: slug, ownerUserId: owner.id });
  await db.memberships.ensureOwnerMembership(workspace.id, owner.id);
  return workspace;
}

const roomsOf = (workspaceId, userId) => [`workspace:${workspaceId}`, `workspace:${workspaceId}:user:${userId}`];

test("an actor's contributed rooms are their active workspace memberships, read at the same cost for many actors as for one", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const audiences = audiencesOf(db);
  const owner = await db.createProfile("rooms-owner");
  const member = await db.createProfile("rooms-member");
  const outsider = await db.createProfile("rooms-outsider");
  const first = await workspaceOf(db, "rooms-first", owner);
  const second = await workspaceOf(db, "rooms-second", owner);
  const left = await workspaceOf(db, "rooms-left", owner);
  await db.memberships.addMember({ workspaceId: second.id, userId: member.id });
  await db.memberships.upsertMembership(left.id, member.id, { roleSid: "member", status: "revoked" });

  const statementsOf = async (work) => {
    let count = 0;
    const onQuery = () => {
      count += 1;
    };
    db.knex.on("query", onQuery);
    try {
      return { result: await work(), count };
    } finally {
      db.knex.removeListener("query", onQuery);
    }
  };
  const one = await statementsOf(() => audiences.resolveActorsRooms([owner.id]));
  const { result: rooms, count } = await statementsOf(() => audiences.resolveActorsRooms([owner.id, member.id, outsider.id]));
  assert.deepEqual([...rooms.keys()], [owner.id, member.id, outsider.id]);
  assert.deepEqual([...rooms.get(owner.id)].sort(), [...roomsOf(first.id, owner.id), ...roomsOf(second.id, owner.id),
    ...roomsOf(left.id, owner.id)].sort());
  assert.deepEqual([...rooms.get(member.id)].sort(), roomsOf(second.id, member.id).sort(), "a revoked membership gives no room");
  assert.deepEqual([...rooms.get(outsider.id)], [], "an actor without memberships is answered with no rooms");
  assert.equal(count, one.count, `the same reads for three actors as for one (${one.count} and ${count} statements)`);
  assert.deepEqual([...(await audiences.resolveActorRooms(member.id))].sort(), roomsOf(second.id, member.id).sort());
  assert.deepEqual(await audiences.resolveActorsRooms([]), new Map());
});

test("a revalidated socket joins the rooms of a new membership and leaves those of a removed one", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const audiences = audiencesOf(db);
  const owner = await db.createProfile("socket-owner");
  const member = await db.createProfile("socket-member");
  const workspace = await workspaceOf(db, "socket-team", owner);
  const joined = new Set(["clients", "users", `user:${member.id}`]);
  const socket = {
    data: { actorId: member.id },
    disconnected: false,
    async join(room) { joined.add(room); },
    async leave(room) { joined.delete(room); },
    disconnect() { this.disconnected = true; }
  };
  const authService = { realtime: { requireAuthentication: true } };
  const revalidate = () => revalidateSocket({
    socket,
    authService,
    audiences,
    request: {},
    authenticateRequest: async () => ({ authenticated: true, actor: { id: member.id } })
  });

  assert.deepEqual(await revalidate(), { id: member.id });
  assert.deepEqual([...joined].sort(), ["clients", "users", `user:${member.id}`].sort(), "no membership yet: no workspace room");
  await db.memberships.addMember({ workspaceId: workspace.id, userId: member.id });
  await revalidate();
  assert.deepEqual([...joined].sort(), ["clients", "users", `user:${member.id}`, ...roomsOf(workspace.id, member.id)].sort());
  assert.deepEqual([...socket.data.contributedRooms].sort(), roomsOf(workspace.id, member.id).sort());
  await db.memberships.upsertMembership(workspace.id, member.id, { roleSid: "member", status: "revoked" });
  await revalidate();
  assert.deepEqual([...joined].sort(), ["clients", "users", `user:${member.id}`].sort(), "a removed member leaves the rooms");
  assert.deepEqual(socket.data.contributedRooms, []);
  assert.equal(socket.disconnected, false);
});

test("an invite's bootstrap audience reaches the event's scope room and the user the invite's email belongs to", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const members = membersService(db);
  const audience = createInviteRecipientBootstrapAudience({ inviteRecipientUserIds: members.inviteRecipientUserIds });
  const warnings = [];
  const logger = { warn: (details, message) => warnings.push({ details, message }) };
  const owner = await db.createProfile("invite-owner");
  const workspace = await workspaceOf(db, "invite-team", owner);
  const other = await workspaceOf(db, "invite-other", owner);
  const invited = (await members.createInvite(workspace, owner, { email: "invite-reader@example.test" })).value.createdInviteId;
  const event = (scope) => ({ type: "entity.changed", entityId: invited, ...(scope ? { scope } : {}) });
  const targets = (scope) => resolveAudienceTargets(audience, event(scope), { logger });

  assert.deepEqual(await targets({ kind: "workspace", id: workspace.id }), {
    broadcastAllClients: false,
    rooms: [`workspace:${workspace.id}`]
  }, "before the person signs up, only the scope's room");
  const reader = await db.createProfile("invite-reader");
  assert.deepEqual(await targets({ kind: "workspace", id: workspace.id }), {
    broadcastAllClients: false,
    rooms: [`workspace:${workspace.id}`, `user:${reader.id}`]
  });
  assert.deepEqual((await targets({ kind: "user", id: reader.id })).rooms, [`user:${reader.id}`]);
  assert.deepEqual((await targets({ kind: "workspace_user", workspaceId: workspace.id, userId: owner.id })).rooms,
    [`workspace:${workspace.id}:user:${owner.id}`, `user:${reader.id}`]);
  // Pinned as it is: the scope the read gets names the event's workspace, but the invite read does not narrow to it,
  // so an event scoped to another workspace still reaches the invite's recipient.
  assert.deepEqual((await targets({ kind: "workspace", id: other.id })).rooms, [`workspace:${other.id}`, `user:${reader.id}`]);
  assert.deepEqual((await targets(null)).rooms, [`user:${reader.id}`], "an event without a scope reaches the recipient only");
  assert.deepEqual(warnings.map(({ message }) => message), ["Realtime event_scope audience has no deliverable scope."]);

  await members.revokeInvite(workspace, invited);
  assert.deepEqual((await targets({ kind: "workspace", id: workspace.id })).rooms, [`workspace:${workspace.id}`, `user:${reader.id}`],
    "a revoked invite still reaches its recipient, so their pending list refreshes");
  const missing = await resolveAudienceTargets(audience, { type: "entity.changed", entityId: "999999999",
    scope: { kind: "workspace", id: workspace.id } }, { logger });
  assert.deepEqual(missing.rooms, [`workspace:${workspace.id}`]);
});
