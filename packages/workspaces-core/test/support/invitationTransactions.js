import assert from "node:assert/strict";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createJsonRestApiHost } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import { createWorkspaceRoleCatalog } from "../../src/shared/roles.js";
import { installWorkspaceResources } from "../../src/server/WorkspacesFeature.js";
import { createRepository as invitesRepository } from "../../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as membershipsRepository } from "../../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as workspacesRepository } from "../../src/server/common/repositories/workspacesRepository.js";
import { createService as membersService } from "../../src/server/workspaceMembers/workspaceMembersService.js";
import { createService as pendingService } from "../../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";
import { buildWorkspacePendingInvitationsActions } from "../../src/server/workspacePendingInvitations/workspacePendingInvitationsActions.js";

// The caller verifies an empty disposable database and runs package migrations.
// These application fixtures demonstrate composition, not production policy.
export async function verifyInvitationTransactions(t, db) {
  const native = ["mysql2", "pg"].includes(db.client.config.client);
  const applicationTables = ["test_invitation_audits", "test_invitation_scopes", "test_invitation_drafts"];
  t.after(async () => {
    for (const table of applicationTables) await db.schema.dropTableIfExists(table);
  });
  await db.schema.createTable("test_invitation_drafts", (table) => {
    table.increments("id");
    table.bigInteger("workspace_id").unsigned().notNullable().references("id").inTable("workspaces");
    table.bigInteger("invite_id").unsigned().nullable().unique().references("id").inTable("workspace_invites");
    table.bigInteger("user_id").unsigned().nullable().references("id").inTable("users");
    table.bigInteger("training_user_id").unsigned().nullable().references("id").inTable("users");
    table.string("review_state").notNullable().defaultTo("reviewed");
  });
  for (const name of applicationTables.slice(0, 2)) {
    await db.schema.createTable(name, (table) => {
      table.increments("id");
      table.integer("draft_id").unsigned().notNullable().unique().references("id").inTable("test_invitation_drafts");
    });
  }
  const api = await createJsonRestApiHost({ knex: db, logger: { error() {}, warn() {}, info() {}, debug() {} } });
  const { identity } = await UsersIdentityProvider.setup({
    authExtensions: createAuthExtensions(), extensions: createUsersExtensions(), jsonRestApi: api
  });
  await installWorkspaceResources(api);
  await api.addResource("invitationTestPeople", {
    tableName: "test_invitation_drafts",
    schema: {
      id: { type: "id", primary: true },
      userId: { type: "id", nullable: true, storage: { column: "user_id" } },
      trainingUserId: { type: "id", nullable: true, storage: { column: "training_user_id" } }
    }
  });
  let failCompletionForMethod = null;
  await api.customize({ hooks: { afterCommit: ({ context }) => {
    if (context.scopeName === "workspaceInvites" && context.method === failCompletionForMethod) {
      throw new Error("Controlled completion failure");
    }
  } } });
  const invites = invitesRepository({ api });
  const memberships = membershipsRepository({ api });
  const workspaces = workspacesRepository({ api });
  const roleCatalog = createWorkspaceRoleCatalog({ roleCatalog: {
    workspace: { defaultInviteRole: "member" },
    roles: { owner: { assignable: false, permissions: ["*"] }, member: { assignable: true, permissions: [] } }
  } });
  const profile = (name) => identity.repositories.userProfiles.upsert({
    authProvider: "local", authProviderUserSid: name, email: `${name}@example.test`, displayName: name
  });
  let sequence = 0;
  async function fixture({ mailer = true, inviteRepository = invites } = {}) {
    const suffix = `invitation-${++sequence}`;
    const user = await profile(suffix);
    const owner = await profile(`${suffix}-owner`);
    const workspace = await workspaces.insert({ slug: suffix, name: suffix, ownerUserId: owner.id });
    await db("test_invitation_drafts").insert({ workspace_id: workspace.id });
    const { id: draftId } = await db("test_invitation_drafts").where({ workspace_id: workspace.id }).first();
    const delivered = [];
    const events = [];
    let failDelivery = false;
    const members = membersService({
      workspaceInvitesRepository: inviteRepository, workspaceMembershipsRepository: memberships,
      inviteExpiresInMs: 3600000, roleCatalog,
      workspaceInviteMailer: mailer ? { async sendWorkspaceInvite(message, options) {
        assert.equal(options.trx, undefined);
        const saved = await db("workspace_invites").where({ workspace_id: workspace.id, status: "pending" }).first();
        assert.ok(saved, "An independent read sees the committed invitation before delivery.");
        assert.equal(message.email, user.email);
        assert.equal(message.roleSid, "member");
        assert.equal(message.workspace.name, workspace.name);
        if (failDelivery) throw new Error(`Controlled mail failure containing secret ${message.inviteUrl}`);
        delivered.push(String(saved.id));
        return { status: "sent", providerMessageId: "controlled-message" };
      } } : null
    });
    const pending = pendingService({ workspaceInvitesRepository: inviteRepository, workspaceMembershipsRepository: memberships });
    const options = { context: { actor: user, channel: "api", permissions: ["workspace.members.invite"] } };
    const payload = { email: user.email, roleSid: "member" };
    const actions = createActionCatalogue({ events: { async publish(event) { events.push(event); } } });
    actions.register({ contributorId: suffix, domain: "workspace", actions: buildWorkspacePendingInvitationsActions({ workspacePendingInvitationsService: pending }) });
    const redeem = (prepared, decision = "accept", actor = user, extraInput = {}) => actions.execute({
      actionId: "workspace.invite.redeem",
      input: { token: prepared.inviteTokenPreview, decision, ...extraInput },
      context: { ...options.context, actor }
    });
    // Lock workspace before application receipt rows, matching acceptance's
    // lock order. A lost response/retry returns the exact persisted invitation.
    async function prepareOnce({ fail = false } = {}) {
      return invites.withTransaction(async (trx) => {
        await invites.lockWorkspaceForInvitations(workspace.id, { trx });
        const draft = await trx("test_invitation_drafts").where({ id: draftId, workspace_id: workspace.id }).forUpdate().first();
        if (draft.invite_id) return { createdInviteId: String(draft.invite_id) };
        const prepared = await members.prepareInvite(workspace, owner, payload, { ...options, trx });
        await trx("test_invitation_drafts").where({ id: draftId }).update({ invite_id: prepared.createdInviteId });
        if (fail) throw new Error("Controlled association failure");
        return prepared;
      });
    }
    async function applyAssociation({ invite, user: acceptingUser }, transactionOptions) {
      const { trx, context } = transactionOptions;
      assert.ok(Object.isFrozen(invite));
      assert.ok(Object.isFrozen(transactionOptions));
      assert.equal(invite.workspaceId, workspace.id);
      assert.equal(acceptingUser.id, user.id);
      assert.equal(context.actor.id, user.id);
      const membership = await memberships.findByWorkspaceIdAndUserId(workspace.id, user.id, transactionOptions);
      assert.equal(membership.status, "active", "Domain scope owners see uncommitted membership");
      const draft = await trx("test_invitation_drafts").where({ invite_id: invite.id }).forUpdate().first();
      if (!draft) return; // Ordinary invitation, no application association.
      assert.equal(String(draft.workspace_id), invite.workspaceId, "Foreign workspace association");
      assert.equal(draft.review_state, "reviewed", "Invalid reviewed association");
      assert.ok(!draft.user_id || String(draft.user_id) === acceptingUser.id, "Conflicting account");
      // Application identity/training owner uses actual managed resource writes.
      await api.resources.invitationTestPeople.patch({
        id: String(draft.id), data: { userId: acceptingUser.id, trainingUserId: acceptingUser.id },
        transaction: trx, format: "plain", returning: "full"
      });
      await trx("test_invitation_scopes").insert({ draft_id: draft.id });
      await trx("test_invitation_audits").insert({ draft_id: draft.id });
    }
    const draft = () => db("test_invitation_drafts").where({ id: draftId }).first();
    const invitation = (prepared) => db("workspace_invites").where({ id: prepared.createdInviteId }).first();
    async function assertUnlinked(prepared) {
      assert.equal(await memberships.findByWorkspaceIdAndUserId(workspace.id, user.id), null);
      assert.equal((await invitation(prepared)).status, "pending");
      assert.equal((await draft()).user_id, null);
      assert.equal((await draft()).training_user_id, null);
      for (const table of applicationTables.slice(0, 2)) assert.equal((await db(table).where({ draft_id: draftId })).length, 0);
      assert.equal(events.length, 0);
    }
    return { user, owner, workspace, draftId, draft, invitation, assertUnlinked, members, pending, redeem, events,
      delivered, options, payload, prepareOnce, applyAssociation, failDelivery() { failDelivery = true; } };
  }

  await t.test("ordinary creation commits before controlled delivery and built-in acceptance", async () => {
    const f = await fixture();
    const created = await f.members.createInvite(f.workspace, f.owner, f.payload, f.options);
    assert.equal(created.inviteDelivery.status, "sent");
    assert.deepEqual(f.delivered, [created.createdInviteId]);
    await f.redeem(created);
    assert.equal((await f.invitation(created)).status, "accepted");
    assert.equal((await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id)).status, "active");
    assert.ok(f.events.length > 0);
  });

  await t.test("ordinary invitation works with an application participant and no association", async () => {
    const f = await fixture({ mailer: false });
    const created = await f.members.createInvite(f.workspace, f.owner, f.payload);
    assert.equal(created.inviteDelivery.status, "mailer_unconfigured");
    f.pending.registerAcceptanceParticipant(f.applyAssociation);
    await f.redeem(created);
    assert.equal((await f.invitation(created)).status, "accepted");
    assert.equal((await f.draft()).user_id, null);
  });

  await t.test("association rollback restores earlier invitation state and sends nothing", async () => {
    const f = await fixture();
    const previous = await f.members.createInvite(f.workspace, f.owner, f.payload);
    await assert.rejects(f.prepareOnce({ fail: true }), (error) => error.transactionOutcome === "rolledBack");
    const rows = await db("workspace_invites").where({ workspace_id: f.workspace.id });
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].id), previous.createdInviteId);
    assert.equal(rows[0].status, "pending");
    assert.equal((await f.draft()).invite_id, null);
    assert.deepEqual(f.delivered, [previous.createdInviteId]);
  });

  await t.test("reviewed receipt survives a lost response; normal redeem commits all owners", async () => {
    const f = await fixture();
    const prepared = await f.prepareOnce();
    const receipt = await f.prepareOnce();
    assert.equal(receipt.createdInviteId, prepared.createdInviteId);
    assert.equal(f.delivered.length, 0);
    const sent = await f.members.sendInvite({ ...f.workspace, name: "Untrusted replacement" }, f.owner, {
      ...receipt, email: "other@example.test", roleSid: "owner", inviteUrl: "https://untrusted.example"
    });
    assert.equal(sent.createdInviteId, prepared.createdInviteId);
    f.pending.registerAcceptanceParticipant(f.applyAssociation);
    await f.redeem(sent);
    const linked = await f.draft();
    assert.equal(String(linked.user_id), f.user.id);
    assert.equal(String(linked.training_user_id), f.user.id);
    assert.equal((await f.invitation(prepared)).status, "accepted");
    for (const table of applicationTables.slice(0, 2)) assert.equal((await db(table).where({ draft_id: f.draftId })).length, 1);
  });

  await t.test("participant failure rolls back membership, identity, training, scopes, audit and status", async () => {
    const f = await fixture();
    const prepared = await f.prepareOnce();
    f.pending.registerAcceptanceParticipant(async (...args) => {
      await f.applyAssociation(...args);
      throw new Error("Controlled audit failure");
    });
    await assert.rejects(f.redeem(prepared), (error) => {
      assert.equal(error.transactionOutcome, "rolledBack");
      assert.match(error.cause.message, /Controlled audit failure/);
      return true;
    });
    await f.assertUnlinked(prepared);
  });

  await t.test("late status failure restores an existing membership and all application writes", async () => {
    const f = await fixture({ inviteRepository: { ...invites, async markAcceptedById(id, options) {
      await invites.markAcceptedById(id, options);
      throw new Error("Controlled final status failure");
    } } });
    const prepared = await f.prepareOnce();
    await memberships.upsertMembership(f.workspace.id, f.user.id, { roleSid: "existing-role", status: "revoked" });
    f.pending.registerAcceptanceParticipant(f.applyAssociation);
    await assert.rejects(f.redeem(prepared), /final status failure/);
    const previous = await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id);
    assert.equal(previous.roleSid, "existing-role");
    assert.equal(previous.status, "revoked");
    assert.equal((await f.invitation(prepared)).status, "pending");
    assert.equal((await f.draft()).user_id, null);
    assert.equal((await f.draft()).training_user_id, null);
    for (const table of applicationTables.slice(0, 2)) assert.equal((await db(table).where({ draft_id: f.draftId })).length, 0);
    assert.equal(f.events.length, 0);
  });

  await t.test("acceptance completion failure reports committed and retains all accepted writes", async () => {
    const f = await fixture();
    const prepared = await f.prepareOnce();
    f.pending.registerAcceptanceParticipant(f.applyAssociation);
    failCompletionForMethod = "patch";
    try {
      await assert.rejects(f.redeem(prepared), (error) => error.transactionOutcome === "committed");
    } finally {
      failCompletionForMethod = null;
    }
    assert.equal((await f.invitation(prepared)).status, "accepted");
    assert.equal((await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id)).status, "active");
    assert.equal(String((await f.draft()).user_id), f.user.id);
    assert.equal(String((await f.draft()).training_user_id), f.user.id);
    for (const table of applicationTables.slice(0, 2)) assert.equal((await db(table).where({ draft_id: f.draftId })).length, 1);
  });

  await t.test("preparation completion failure preserves its receipt without sending or recreating", async () => {
    const f = await fixture();
    failCompletionForMethod = "post";
    try {
      await assert.rejects(f.prepareOnce(), (error) => error.transactionOutcome === "committed");
    } finally {
      failCompletionForMethod = null;
    }
    const receipt = await f.prepareOnce();
    assert.equal(receipt.createdInviteId, String((await f.draft()).invite_id));
    assert.equal((await db("workspace_invites").where({ workspace_id: f.workspace.id })).length, 1);
    assert.equal(f.delivered.length, 0);
  });

  await t.test("ordinary creation does not deliver after a preparation completion error", async () => {
    const f = await fixture();
    failCompletionForMethod = "post";
    try {
      await assert.rejects(f.members.createInvite(f.workspace, f.owner, f.payload), (error) => error.transactionOutcome === "committed");
    } finally {
      failCompletionForMethod = null;
    }
    assert.equal((await db("workspace_invites").where({ workspace_id: f.workspace.id, status: "pending" })).length, 1);
    assert.equal(f.delivered.length, 0);
  });

  for (const state of ["stale", "revoked-review", "departed-person", "invalid-scope", "inviter-departed", "conflicting-account", "foreign-workspace"]) {
    await t.test(`application rejects ${state} without partial activation`, async () => {
      const f = await fixture();
      const prepared = await f.prepareOnce();
      const patch = state === "conflicting-account" ? { user_id: f.owner.id }
        : state === "foreign-workspace" ? { workspace_id: (await fixture()).workspace.id }
          : { review_state: state };
      await db("test_invitation_drafts").where({ id: f.draftId }).update(patch);
      const before = await f.draft();
      f.pending.registerAcceptanceParticipant(f.applyAssociation);
      await assert.rejects(f.redeem(prepared), (error) => error.transactionOutcome === "rolledBack");
      assert.deepEqual(await f.draft(), before);
      assert.equal(await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id), null);
      assert.equal((await f.invitation(prepared)).status, "pending");
      for (const table of applicationTables.slice(0, 2)) assert.equal((await db(table).where({ draft_id: f.draftId })).length, 0);
    });
  }

  for (const state of ["unauthenticated", "wrong-email", "missing", "expired", "revoked", "accepted"]) {
    await t.test(`${state} invitation cannot reach the participant`, async () => {
      const f = await fixture();
      const prepared = await f.prepareOnce();
      if (state === "expired") await db("workspace_invites").where({ id: prepared.createdInviteId }).update({ expires_at: "2000-01-01 00:00:00" });
      if (state === "revoked") await f.members.revokeInvite(f.workspace, prepared.createdInviteId);
      if (state === "accepted") await f.redeem(prepared);
      let called = false;
      // An already-used service intentionally seals registration; use a fresh
      // instance to verify terminal-state validation independently of sealing.
      const pending = pendingService({ workspaceInvitesRepository: invites, workspaceMembershipsRepository: memberships });
      pending.registerAcceptanceParticipant(async () => { called = true; });
      const membershipBefore = await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id);
      await assert.rejects(pending.acceptInviteByToken({
        user: state === "unauthenticated" ? null : state === "wrong-email" ? f.owner : f.user,
        token: state === "missing" ? encodeInviteTokenHash("f".repeat(64)) : prepared.inviteTokenPreview
      }), (error) => [401, 403, 404, 409].includes(error.status));
      assert.equal(called, false);
      assert.deepEqual(await memberships.findByWorkspaceIdAndUserId(f.workspace.id, f.user.id), membershipBefore);
      if (state === "expired") assert.equal((await f.invitation(prepared)).status, "revoked");
    });
  }

  await t.test("built-in redeem cannot replace the authenticated actor from input", async () => {
    const f = await fixture();
    const prepared = await f.prepareOnce();
    let called = false;
    f.pending.registerAcceptanceParticipant(async () => { called = true; });
    await assert.rejects(f.redeem(prepared, "accept", f.owner, { user: f.user, personId: f.draftId, roleSid: "owner" }));
    assert.equal(called, false);
    await f.assertUnlinked(prepared);
  });

  await t.test("transaction misuse fails without invitation or membership writes", async () => {
    const f = await fixture();
    await assert.rejects(f.members.prepareInvite(f.workspace, f.owner, f.payload), /requires a managed transaction/);
    await assert.rejects(db.transaction((trx) => f.members.prepareInvite(f.workspace, f.owner, f.payload, { trx })));
    assert.equal((await db("workspace_invites").where({ workspace_id: f.workspace.id })).length, 0);
    const prepared = await f.prepareOnce();
    await invites.withTransaction(async (trx) => {
      await assert.rejects(f.members.createInvite(f.workspace, f.owner, f.payload, { trx }), /prepareInvite/);
      await assert.rejects(f.members.sendInvite(f.workspace, f.owner, prepared, { trx }), /after.*commits/);
      for (const method of ["acceptInviteByToken", "refuseInviteByToken"]) {
        await assert.rejects(f.pending[method]({ user: f.user, token: prepared.inviteTokenPreview }, { trx }), /owns its transaction/);
      }
    });
    await f.assertUnlinked(prepared);
    assert.equal(f.delivered.length, 0);
  });

  for (const state of ["missing", "foreign", "expired", "revoked", "accepted", "mismatched", "empty-token"]) {
    await t.test(`delivery rejects ${state} invitation`, async () => {
      const f = await fixture();
      const prepared = await f.prepareOnce();
      if (state === "expired") await db("workspace_invites").where({ id: prepared.createdInviteId }).update({ expires_at: "2000-01-01 00:00:00" });
      if (state === "revoked") await f.members.revokeInvite(f.workspace, prepared.createdInviteId);
      if (state === "accepted") await f.redeem(prepared);
      const delivery = state === "missing" ? { createdInviteId: "999999999" }
        : ["mismatched", "empty-token"].includes(state) ? { ...prepared, inviteTokenPreview: state === "empty-token" ? "" : "wrong-token" }
          : prepared;
      const workspace = state === "foreign" ? (await fixture()).workspace : f.workspace;
      await assert.rejects(f.members.sendInvite(workspace, f.owner, delivery), (error) => [400, 404, 409].includes(error.status));
      assert.equal(f.delivered.length, 0);
    });
  }

  await t.test("controlled delivery failure preserves association and redacts the provider error", async () => {
    const f = await fixture();
    const prepared = await f.prepareOnce();
    f.failDelivery();
    const response = await f.members.sendInvite(f.workspace, f.owner, prepared);
    assert.equal(response.inviteDelivery.status, "failed");
    assert.equal(response.inviteDelivery.message, "Unable to send workspace invite email.");
    assert.equal((await f.prepareOnce()).createdInviteId, prepared.createdInviteId);
    await f.assertUnlinked(prepared);
  });

  await t.test("terminal repository transitions cannot overwrite accepted or revoked invitations", async () => {
    for (const decision of ["accept", "refuse"]) {
      const f = await fixture();
      const prepared = await f.prepareOnce();
      await f.redeem(prepared, decision);
      const before = await f.invitation(prepared);
      for (const method of ["markAcceptedById", "revokeById"]) {
        await assert.rejects(invites[method](prepared.createdInviteId), (error) => error.status === 404);
      }
      assert.deepEqual(await f.invitation(prepared), before);
    }
  });

  await t.test("native uncommitted delivery and concurrent reviewed receipts", {
    skip: !native && "SQLite single-connection fixture is not native locking evidence"
  }, async () => {
    const f = await fixture();
    await invites.withTransaction(async (trx) => {
      const prepared = await f.members.prepareInvite(f.workspace, f.owner, f.payload, { trx });
      await assert.rejects(f.members.sendInvite(f.workspace, f.owner, prepared), (error) => error.status === 404);
    });
    const [first, second] = await Promise.all([f.prepareOnce(), f.prepareOnce()]);
    assert.equal(first.createdInviteId, second.createdInviteId);
    assert.equal((await db("workspace_invites").where({ workspace_id: f.workspace.id, status: "pending" })).length, 1);
    assert.equal(f.delivered.length, 0);
  });

  for (const competitor of ["accept", "refuse", "revoke", "replace"]) {
    for (const acceptanceWins of [true, false]) {
      if (competitor === "accept" && !acceptanceWins) continue;
      await t.test(`native acceptance versus ${competitor}, ${acceptanceWins ? "acceptance" : "competitor"} holds the first lock`, {
        skip: !native && "SQLite single-connection fixture is not native locking evidence",
        timeout: 15000
      }, async () => {
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        let holdTransaction = false;
        const connections = [];
        const repository = { ...invites, async withTransaction(work) {
          return invites.withTransaction(async (trx) => {
            const result = db.client.config.client === "pg"
              ? (await trx.raw("SELECT pg_backend_pid() AS id")).rows[0]
              : (await trx.raw("SELECT CONNECTION_ID() AS id"))[0][0];
            connections.push(result.id);
            const value = await work(trx);
            if (holdTransaction) {
              holdTransaction = false;
              entered.resolve();
              await release.promise;
            }
            return value;
          });
        } };
        const f = await fixture({ inviteRepository: repository });
        const prepared = await f.prepareOnce();
        let participation = 0;
        f.pending.registerAcceptanceParticipant(async (...args) => { participation++; await f.applyAssociation(...args); });
        const compete = () => competitor === "accept" || competitor === "refuse" ? f.redeem(prepared, competitor)
          : competitor === "revoke" ? f.members.revokeInvite(f.workspace, prepared.createdInviteId)
            : f.members.createInvite(f.workspace, f.owner, f.payload);
        holdTransaction = true;
        connections.length = 0;
        const first = acceptanceWins ? f.redeem(prepared) : compete();
        // Observe errors immediately so an assertion failure cannot create an
        // unhandled rejection while a competing database operation is pending.
        const firstSettled = Promise.allSettled([first]);
        await entered.promise;
        const waiting = Promise.withResolvers();
        const queryListener = (query) => {
          if (/select.*["`]workspaces["`].*for update/iu.test(query.sql)) waiting.resolve();
        };
        db.on("query", queryListener);
        try {
          const second = acceptanceWins ? compete() : f.redeem(prepared);
          const secondSettled = Promise.allSettled([second]);
          await waiting.promise;
          release.resolve();
          const [winner] = await firstSettled;
          const [loser] = await secondSettled;
          assert.equal(winner.status, "fulfilled", winner.reason?.stack);
          if (acceptanceWins && competitor === "replace") assert.equal(loser.status, "fulfilled", loser.reason?.stack);
          else {
            assert.equal(loser.status, "rejected");
            assert.equal(loser.reason.status, 404, loser.reason.stack);
          }
          assert.notEqual(connections[0], connections[1], "Competing units own independent database connections");
          assert.equal(participation, acceptanceWins ? 1 : 0);
          const expected = acceptanceWins ? "accepted" : competitor === "replace" ? "expired" : "revoked";
          assert.equal((await f.invitation(prepared)).status, expected);
          for (const table of applicationTables.slice(0, 2)) {
            assert.equal((await db(table).where({ draft_id: f.draftId })).length, acceptanceWins ? 1 : 0);
          }
        } finally {
          db.off("query", queryListener);
          release.resolve();
        }
      });
    }
  }
}
