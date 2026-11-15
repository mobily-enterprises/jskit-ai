import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { expectFlatQueries, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import usersInitial from "../../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../../migrations/workspaces_core_workspaces_drop_color.cjs";
import { WORKSPACES_TABLES, createWorkspaceRecords } from "../../src/server/workspacesRuntime.js";
import { createRepository as createInvitesRepository } from "../../src/server/common/repositories/workspaceInvitesRepository.js";
import { buildWorkspaceName, createService as createDirectoryService } from "../../src/server/common/services/workspaceDirectoryService.js";
import { noWorkspaceCreatedParticipant } from "../../src/server/workspaceDirectory/noWorkspaceCreatedParticipant.js";
import { createRepository as createSettingsRepository } from "../../src/server/workspaceSettings/workspaceSettingsRepository.js";
import { createWorkspaceRoleCatalog } from "../../src/shared/roles.js";
import { resolveTenancyProfile } from "../../src/shared/tenancyProfile.js";

// workspaces.transferOwnership on the migrated users and workspaces tables: the moves it makes, what it refuses with
// nothing changed, the caller's transaction, two transfers at once and its statements among few and many members.

const MIGRATIONS = [usersInitial, usersUsername, usersUpdatedAt, workspacesInitial, workspaceSettingsMigration, workspaceColorMigration];
const NOT_ACTIVE = "workspaces.member.newOwnerNotActive";
const NOT_FOUND = "workspaces.workspace.notFound";
// expectFlatQueries() runs only against a test database, which TEST_DB_NAME names: SQLite's in-memory one is one.
const IN_MEMORY_TEST_DATABASE = Object.freeze({ TEST_DB_NAME: "transfer_ownership" });
// Statements that change rows. SQLite has no row lock: a lock there is an update that matches no row (`where 0 = 1`),
// sent for the database's write lock, so it changes nothing.
const WRITE = /^\s*(?:insert|update|delete)\b(?![\s\S]*\bwhere 0 = 1$)/iu;

// The run's result and the statements it sent.
async function statementsOf(knex, run) {
  const sql = [];
  const listener = (query) => sql.push(String(query?.sql || ""));
  knex.on("query", listener);
  try {
    const result = await run();
    return { result, statements: sql.length, sql };
  } finally {
    knex.removeListener("query", listener);
  }
}

// The id of the database connection a transaction runs on.
async function connectionId(dialect, trx) {
  if (dialect === "postgres") return (await trx.raw("SELECT pg_backend_pid() AS id")).rows[0].id;
  return (await trx.raw("SELECT CONNECTION_ID() AS id"))[0][0].id;
}

// Resolves once the connection waits for a lock: on PostgreSQL its wait event says so; on MariaDB/MySQL, whose test
// user sees its own connections in the process list without the PROCESS privilege, a statement running for a second.
async function untilWaiting(knex, dialect, id) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const waiting = dialect === "postgres"
      ? (await knex.raw("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock'", [id])).rows[0].n
      : (await knex.raw(
          "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ? AND COMMAND = 'Query' AND TIME >= 1",
          [id]
        ))[0][0].n;
    if (Number(waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Connection ${id} waited for no lock within 10 s.`);
}

function refusedWith(status, code) {
  return (error) => {
    assert.ok(error instanceof AppError, error?.stack);
    assert.deepEqual([error.status, error.code], [status, code]);
    return true;
  };
}

/**
 * Registers workspaces.transferOwnership's tests on the empty database `open(t)` answers.
 * @param {(t: import("node:test").TestContext) => Promise<import("knex").Knex>} open
 * @param {{ dialect: "sqlite" | "postgres" | "mysql", database?: boolean, skip?: string | false }} options
 */
function transferOwnershipCases(open, { dialect, database = true, skip = false }) {
  const native = dialect !== "sqlite";

  test(`workspaces.transferOwnership (${dialect})`, { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const knex = await open(t);
    if (!native) await knex.raw("PRAGMA foreign_keys = ON");
    for (const migration of MIGRATIONS) await migration.up(knex);
    const started = await startTestFeatures({
      knex,
      logger: silentLogger,
      features: [UsersExtensionsProvider, UsersIdentityProvider],
      requires: { profiles: "users.profiles" }
    });
    t.after(started.stop);
    const { profiles } = started.capabilities;
    const resources = await started.resources.own("workspaces.core", WORKSPACES_TABLES);
    const { workspaces, memberships } = createWorkspaceRecords(resources);
    const invites = createInvitesRepository({ workspaceInvites: resources.workspaceInvites, workspaces });
    const settings = createSettingsRepository({
      workspaceSettings: resources.workspaceSettings, defaultInvitesEnabled: true, defaultColorSettings: {}
    });
    const transfer = (input, options) => workspaces.transferOwnership(input, options);

    let sequence = 0;
    const person = (name) => profiles.upsert({
      authProvider: "local", authProviderUserSid: `transfer-${name}`, email: `${name}@example.test`, displayName: name
    });
    // A workspace owned by `owner`, with its owner membership unless `ownerMembership` is false, and `members` active.
    async function team(owner, members = [], { ownerMembership = true, isPersonal = false } = {}) {
      sequence += 1;
      const workspace = await workspaces.insert({ slug: `team-${sequence}`, name: `Team ${sequence}`, ownerUserId: owner.id, isPersonal });
      if (ownerMembership) await memberships.ensureOwnerMembership(workspace.id, owner.id);
      for (const member of members) await memberships.addMember({ workspaceId: workspace.id, userId: member.id });
      return workspace;
    }
    // The workspace's row and its memberships' rows as stored.
    const stored = async (workspaceId) => JSON.stringify({
      workspace: await knex("workspaces").where({ id: workspaceId }).first(),
      memberships: await knex("workspace_memberships").where({ workspace_id: workspaceId }).orderBy("id")
    });
    // Each membership's [user, role, status], by user id.
    const rolesOf = async (workspaceId) => (await knex("workspace_memberships").where({ workspace_id: workspaceId }).orderBy("user_id"))
      .map((row) => [String(row.user_id), row.role_sid, row.status]);
    const byUser = (rows) => [...rows].sort(([left], [right]) => Number(left) - Number(right));
    const ownerRows = async (workspaceId) => knex("workspace_memberships").where({ workspace_id: workspaceId, role_sid: "owner" });

    await t.test("a transfer makes the member the owner and the previous owner an active admin, and moves updatedAt", async () => {
      const ada = await person("ada-1");
      const grace = await person("grace-1");
      const workspace = await team(ada, [grace]);
      await knex("workspaces").where({ id: workspace.id }).update({ updated_at: "2001-02-03 04:05:06" });

      const answer = await transfer({ workspaceId: workspace.id, toUserId: grace.id });

      const { previousOwnerUserId, changed, ...moved } = answer;
      assert.deepEqual({ previousOwnerUserId, changed }, { previousOwnerUserId: ada.id, changed: true });
      assert.deepEqual(moved, await workspaces.findById(workspace.id), "The workspace as findById answers it");
      assert.equal(moved.ownerUserId, grace.id);
      assert.ok(moved.updatedAt > "2001-02-03T04:05:06.000Z", `updatedAt moved: ${moved.updatedAt}`);
      assert.deepEqual(await rolesOf(workspace.id), byUser([[ada.id, "admin", "active"], [grace.id, "owner", "active"]]));
      assert.deepEqual((await memberships.listActiveByWorkspaceId(workspace.id)).map(({ userId }) => userId).sort(), [ada.id, grace.id].sort());
    });

    await t.test("the previous owner takes previousOwnerRoleSid, and is made an active member when they had no active membership", async () => {
      const ada = await person("ada-2");
      const grace = await person("grace-2");
      const named = await team(ada, [grace]);
      assert.equal((await transfer({ workspaceId: named.id, toUserId: grace.id, previousOwnerRoleSid: " Member " })).changed, true);
      assert.deepEqual(await rolesOf(named.id), byUser([[ada.id, "member", "active"], [grace.id, "owner", "active"]]));

      const unjoined = await team(ada, [grace], { ownerMembership: false });
      await transfer({ workspaceId: unjoined.id, toUserId: grace.id });
      assert.deepEqual(await rolesOf(unjoined.id), byUser([[ada.id, "admin", "active"], [grace.id, "owner", "active"]]));

      const removed = await team(ada, [grace]);
      await memberships.upsertMembership(removed.id, ada.id, { status: "revoked" });
      await transfer({ workspaceId: removed.id, toUserId: grace.id });
      assert.deepEqual(await rolesOf(removed.id), byUser([[ada.id, "admin", "active"], [grace.id, "owner", "active"]]));
    });

    await t.test("no active member, a missing workspace and a deleted one are refused, and nothing changes", async () => {
      const ada = await person("ada-3");
      const workspace = await team(ada);
      const stranger = await person("stranger-3");
      const invited = await person("invited-3");
      await invites.insert({ workspaceId: workspace.id, email: invited.email, tokenHash: "transfer-invited-3" });
      const pending = await person("pending-3");
      await memberships.upsertMembership(workspace.id, pending.id, { roleSid: "member", status: "pending" });
      const removed = await person("removed-3");
      await memberships.addMember({ workspaceId: workspace.id, userId: removed.id });
      await memberships.upsertMembership(workspace.id, removed.id, { status: "revoked" });
      const before = await stored(workspace.id);
      for (const candidate of [stranger, invited, pending, removed]) {
        const { sql } = await statementsOf(knex, () => assert.rejects(
          transfer({ workspaceId: workspace.id, toUserId: candidate.id }),
          refusedWith(409, NOT_ACTIVE)
        ));
        assert.deepEqual(sql.filter((statement) => WRITE.test(statement)), [], `${candidate.displayName} wrote nothing`);
        assert.equal(await stored(workspace.id), before, `${candidate.displayName} changed nothing`);
      }

      const grace = await person("grace-3");
      const deleted = await team(ada, [grace]);
      await workspaces.updateById(deleted.id, { deletedAt: new Date().toISOString() });
      const deletedBefore = await stored(deleted.id);
      await assert.rejects(transfer({ workspaceId: deleted.id, toUserId: grace.id }), refusedWith(404, NOT_FOUND));
      assert.equal(await stored(deleted.id), deletedBefore);
      const counts = async () => Promise.all(["workspaces", "workspace_memberships"].map(async (table) => Number((await knex(table).count({ n: "*" }).first()).n)));
      const countsBefore = await counts();
      await assert.rejects(transfer({ workspaceId: "999999999", toUserId: grace.id }), refusedWith(404, NOT_FOUND));
      assert.deepEqual(await counts(), countsBefore);
    });

    await t.test("the owner as toUserId writes nothing and answers changed: false", async () => {
      const ada = await person("ada-4");
      const workspace = await team(ada, [await person("grace-4")]);
      const before = await stored(workspace.id);
      const { result, sql } = await statementsOf(knex, () => transfer({ workspaceId: workspace.id, toUserId: ada.id }));
      assert.deepEqual(result, { ...(await workspaces.findById(workspace.id)), previousOwnerUserId: ada.id, changed: false });
      assert.deepEqual(sql.filter((statement) => WRITE.test(statement)), []);
      assert.equal(await stored(workspace.id), before);
    });

    await t.test("a personal workspace stops being personal: the new owner keeps their own, the previous owner is provisioned a new one", async () => {
      const directory = createDirectoryService({
        tenancyProfile: resolveTenancyProfile({ tenancyMode: "personal" }),
        roleCatalog: createWorkspaceRoleCatalog(),
        personalWorkspaceName: buildWorkspaceName,
        createdParticipant: noWorkspaceCreatedParticipant,
        workspacesRepository: workspaces,
        workspaceMembershipsRepository: memberships,
        workspaceSettingsRepository: settings
      });
      const ada = await person("ada-5");
      const grace = await person("grace-5");
      const adas = await directory.ensureProvisionedWorkspaceForAuthenticatedUser(ada);
      const graces = await directory.ensureProvisionedWorkspaceForAuthenticatedUser(grace);
      assert.equal(adas.isPersonal, true);
      await memberships.addMember({ workspaceId: adas.id, userId: grace.id });

      const answer = await transfer({ workspaceId: adas.id, toUserId: grace.id });

      assert.deepEqual([answer.ownerUserId, answer.isPersonal], [grace.id, false]);
      assert.equal((await workspaces.findById(adas.id)).isPersonal, false);
      assert.equal((await workspaces.findPersonalByOwnerUserId(grace.id)).id, graces.id, "The new owner's own personal workspace stays theirs");
      assert.equal(await workspaces.findPersonalByOwnerUserId(ada.id), null);
      assert.equal((await directory.ensureProvisionedWorkspaceForAuthenticatedUser(grace)).id, graces.id);
      const fresh = await directory.ensureProvisionedWorkspaceForAuthenticatedUser(ada);
      assert.notEqual(fresh.id, adas.id);
      assert.deepEqual([fresh.ownerUserId, fresh.isPersonal], [ada.id, true]);
      assert.deepEqual(
        (await workspaces.listForUserId(ada.id)).map(({ id, roleSid }) => [id, roleSid]),
        [[fresh.id, "owner"], [adas.id, "admin"]]
      );
    });

    await t.test("in the caller's transaction it sees the caller's work and rolls back with it", async () => {
      const ada = await person("ada-6");
      const grace = await person("grace-6");
      const workspace = await team(ada, [grace], { isPersonal: true });
      const hal = await person("hal-6");
      const before = await stored(workspace.id);
      await assert.rejects(workspaces.withTransaction({}, async (txOptions) => {
        await memberships.addMember({ workspaceId: workspace.id, userId: hal.id }, txOptions);
        assert.equal((await transfer({ workspaceId: workspace.id, toUserId: hal.id }, txOptions)).changed, true);
        assert.equal((await workspaces.findById(workspace.id, txOptions)).ownerUserId, hal.id);
        throw new Error("Abort the caller's transaction");
      }), /Abort the caller's transaction/u);
      assert.equal(await stored(workspace.id), before);
    });

    await t.test("in a caller's transaction that read the workspace first, it moves it on from the owner last committed", { skip: native ? false : "SQLite runs one transaction at a time" }, async () => {
      const ada = await person("ada-7");
      const grace = await person("grace-7");
      const hal = await person("hal-7");
      const workspace = await team(ada, [grace, hal]);
      const moved = await workspaces.withTransaction({}, async (txOptions) => {
        // On MariaDB/MySQL this plain read fixes the transaction's snapshot.
        assert.equal((await workspaces.findById(workspace.id, txOptions)).ownerUserId, ada.id);
        await transfer({ workspaceId: workspace.id, toUserId: grace.id });
        return transfer({ workspaceId: workspace.id, toUserId: hal.id }, txOptions);
      });
      assert.deepEqual([moved.previousOwnerUserId, moved.ownerUserId], [grace.id, hal.id]);
      assert.deepEqual(await rolesOf(workspace.id), byUser([[ada.id, "admin", "active"], [grace.id, "admin", "active"], [hal.id, "owner", "active"]]));
    });

    await t.test("two transfers of one workspace at once end with one owner and one owner membership", async () => {
      const ada = await person("ada-8");
      const grace = await person("grace-8");
      const hal = await person("hal-8");
      const workspace = await team(ada, [grace, hal]);
      let first;
      let second;
      if (native) {
        // The first holds its transaction open after its transfer until the second waits for a lock.
        const held = Promise.withResolvers();
        const release = Promise.withResolvers();
        const waiter = Promise.withResolvers();
        const firstRun = workspaces.withTransaction({}, async (txOptions) => {
          const answer = await transfer({ workspaceId: workspace.id, toUserId: grace.id }, txOptions);
          held.resolve();
          await release.promise;
          return answer;
        });
        firstRun.catch(() => held.resolve());
        await held.promise;
        const secondRun = workspaces.withTransaction({}, async (txOptions) => {
          waiter.resolve(await connectionId(dialect, txOptions.trx));
          return transfer({ workspaceId: workspace.id, toUserId: hal.id }, txOptions);
        });
        secondRun.catch(() => {});
        try {
          await untilWaiting(knex, dialect, await waiter.promise);
        } finally {
          release.resolve();
        }
        [first, second] = await Promise.all([firstRun, secondRun]);
      } else {
        [first, second] = await Promise.all([
          transfer({ workspaceId: workspace.id, toUserId: grace.id }),
          transfer({ workspaceId: workspace.id, toUserId: hal.id })
        ]);
      }

      assert.deepEqual([first.changed, first.previousOwnerUserId], [true, ada.id]);
      assert.deepEqual([second.changed, second.previousOwnerUserId], [true, grace.id], "The second moves it on from the owner the first left");
      assert.equal((await workspaces.findById(workspace.id)).ownerUserId, hal.id);
      assert.deepEqual((await ownerRows(workspace.id)).map((row) => String(row.user_id)), [hal.id], "Exactly one owner membership, the owner's");
      assert.deepEqual(await rolesOf(workspace.id), byUser([[ada.id, "admin", "active"], [grace.id, "admin", "active"], [hal.id, "owner", "active"]]));
    });

    await t.test("ids that are no record ids and a previousOwnerRoleSid that is no role but the owner's are a TypeError before any statement", async () => {
      const ada = await person("ada-9");
      const grace = await person("grace-9");
      const workspace = await team(ada, [grace]);
      const refusals = [
        ...["", "abc", "0", null, undefined, {}].map((workspaceId) => [{ workspaceId, toUserId: grace.id }, /requires workspaceId and toUserId/u]),
        ...["", "-1", null, undefined].map((toUserId) => [{ workspaceId: workspace.id, toUserId }, /requires workspaceId and toUserId/u]),
        ...["", "   ", "owner", " OWNER ", null, 7, {}].map((previousOwnerRoleSid) => [
          { workspaceId: workspace.id, toUserId: grace.id, previousOwnerRoleSid }, /previousOwnerRoleSid is the previous owner's new role/u
        ])
      ];
      for (const [input, message] of refusals) {
        const { statements, sql } = await statementsOf(knex, () => assert.rejects(transfer(input), (error) => {
          assert.equal(error.name, "TypeError", `${JSON.stringify(input)}: ${error.stack}`);
          assert.match(error.message, message);
          return true;
        }));
        assert.equal(statements, 0, `${JSON.stringify(input)} sent ${sql.join(" | ")}`);
      }
      assert.equal((await workspaces.findById(workspace.id)).ownerUserId, ada.id);
    });

    await t.test("a transfer's statements do not grow with the workspace's members", async (st) => {
      const owner = await person("owner-10");
      await knex.batchInsert("users", Array.from({ length: 200 }, (_, index) => ({
        auth_provider: "local",
        auth_provider_user_sid: `transfer-crowd-${index}`,
        email: `crowd-${index}@example.test`,
        username: `transfer-crowd-${index}`,
        display_name: `Crowd ${index}`
      })), 100);
      const crowd = (await knex("users").where("username", "like", "transfer-crowd-%").orderBy("id").select("id"))
        .map(({ id }) => String(id));
      // MariaDB and MySQL read a table's indexes once per process and set of filtered columns: not this measure.
      await transfer({ workspaceId: (await team(owner, [{ id: crowd[0] }])).id, toUserId: crowd[0] });

      const moved = [];
      const counts = await expectFlatQueries({
        environment: database ? process.env : IN_MEMORY_TEST_DATABASE,
        knex,
        sizes: [2, 200],
        // A workspace of its own for each size, whose owner has that many active members besides themselves.
        seed: async (size) => {
          const workspace = await team(owner);
          await knex.batchInsert("workspace_memberships", crowd.slice(0, size).map((id) => ({
            workspace_id: workspace.id, user_id: id, role_sid: "member", status: "active"
          })), 100);
          return { workspace, toUserId: crowd[size - 1] };
        },
        run: async ({ workspace, toUserId }) => moved.push(await transfer({ workspaceId: workspace.id, toUserId }))
      });
      st.diagnostic(`transferOwnership statements: ${counts.map(({ size, count }) => `${count} among ${size} members`).join(", ")}`);
      assert.deepEqual(moved.map(({ ownerUserId, changed }) => [ownerUserId, changed]), [[crowd[1], true], [crowd[199], true]]);
    });
  });
}

export { transferOwnershipCases };
