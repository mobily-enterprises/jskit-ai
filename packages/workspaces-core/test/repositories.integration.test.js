import assert from "node:assert/strict";
import { before, beforeEach, after, describe, test } from "node:test";
import knexLib from "knex";
import { findDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { checkForeignKeys } from "@jskit-ai/resource-runtime/server";
import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { userProfileTableResource } from "@jskit-ai/users-core/shared/resources/userProfileResource";
import { userSettingsTableResource } from "@jskit-ai/users-core/shared/resources/userSettingsResource";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import usersInitial from "../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../migrations/workspaces_core_workspaces_drop_color.cjs";
import { createWorkspaceRecords } from "../src/server/WorkspacesFeature.js";
import { WORKSPACES_TABLES } from "../src/server/workspacesRuntime.js";
import { createRepository as createInvitesRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createMemberPagesRepository } from "../src/server/common/repositories/workspaceMemberPagesRepository.js";
import { createRepository as createSettingsRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";
import { renderDefaultWorkspaceInviteEmail } from "../src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";
import { unconfiguredWorkspaceInviteMailer } from "../src/server/workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { createWorkspaceInviteUrlBuilder } from "../src/server/workspaceMembers/workspaceInviteUrls.js";
import { createService as createMembersService } from "../src/server/workspaceMembers/workspaceMembersService.js";
import { buildWorkspaceName, createService as createDirectoryService } from "../src/server/common/services/workspaceDirectoryService.js";
import { noWorkspaceCreatedParticipant } from "../src/server/workspaceDirectory/noWorkspaceCreatedParticipant.js";
import { resolveTenancyProfile } from "../src/shared/tenancyProfile.js";
import { createWorkspacesServerI18n } from "../src/server/i18n.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";
import { verifyInvitationTransactions } from "./support/invitationTransactions.js";

const TABLES = [
  "workspace_invites", "workspace_settings", "workspace_memberships", "workspaces", "user_settings", "users"
];
const databaseUrl = process.env.JSKIT_REPOSITORY_TEST_DATABASE_URL;

function databaseConfig() {
  if (!databaseUrl) {
    return {
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 }
    };
  }
  const url = new URL(databaseUrl);
  assert.match(url.protocol, /^(?:mysql2?|postgres(?:ql)?):$/u);
  assert.match(url.pathname, /^\/jskit_repository_test_[a-z0-9_]+$/u);
  if (url.protocol.startsWith("postgres")) {
    return {
      client: "pg",
      connection: {
        host: url.searchParams.get("host") || url.hostname,
        port: Number(url.port || 5432),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.slice(1)
      },
      pool: { min: 1, max: 6 }
    };
  }
  return {
    client: "mysql2",
    connection: {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ...(url.searchParams.has("socketPath") ? { socketPath: url.searchParams.get("socketPath") } : {}),
      timezone: "Z",
      supportBigNumbers: true,
      bigNumberStrings: true
    },
    pool: { min: 1, max: 6 }
  };
}

const configuration = databaseConfig();
const databaseLabel = { pg: "PostgreSQL", mysql2: "MySQL", "better-sqlite3": "SQLite" }[configuration.client];

describe(`users and workspaces repositories on migrated ${databaseLabel}`, () => {
  let knex;
  let runtime;
  let profiles;
  let userSettings;
  let workspaces;
  let memberships;
  let invites;
  let memberPages;
  let settings;
  let usersExtensions;
  let profileProjector;
  let ownsTables = false;
  let stopFeatures = async () => {};

  before(async () => {
    knex = knexLib(configuration);
    if (databaseUrl) {
      const target = configuration.client === "pg"
        ? (await knex.raw("SELECT current_database() AS name, version() AS version")).rows[0]
        : (await knex.raw("SELECT DATABASE() AS name, VERSION() AS version"))[0][0];
      assert.equal(target.name, configuration.connection.database);
      assert.match(target.name, /^jskit_repository_test_[a-z0-9_]+$/u);
      console.log(`Disposable repository target: ${target.name}; engine: ${target.version}`);
      const tables = configuration.client === "pg"
        ? await knex("information_schema.tables").where({ table_schema: "public" }).select("table_name")
        : (await knex.raw("SHOW TABLES"))[0];
      assert.equal(tables.length, 0, "Native repository tests require an empty disposable database");
    } else {
      await knex.raw("PRAGMA foreign_keys = ON");
    }
    ownsTables = true;
    for (const migration of [
      usersInitial, usersUsername, usersUpdatedAt, workspacesInitial, workspaceSettingsMigration, workspaceColorMigration
    ]) {
      await migration.up(knex);
    }
    // The tables owned as UsersIdentityProvider and WorkspacesFeature own them.
    let capabilities;
    ({ capabilities, resources: runtime, stop: stopFeatures } = await startTestFeatures({
      knex,
      logger: silentLogger,
      features: [UsersExtensionsProvider, UsersIdentityProvider],
      requires: { profiles: "users.profiles", userSettings: "users.settings", profileProjector: "auth.profile.projector", usersExtensions: "users.extensions" }
    }));
    ({ profiles, userSettings, profileProjector, usersExtensions } = capabilities);
    const resources = await runtime.own("workspaces.core", WORKSPACES_TABLES);
    ({ workspaces, memberships } = createWorkspaceRecords(resources));
    invites = createInvitesRepository({ workspaceInvites: resources.workspaceInvites, workspaces });
    memberPages = createMemberPagesRepository({ workspaceMemberships: resources.workspaceMemberships, userProfiles: profiles });
    settings = createSettingsRepository({
      workspaceSettings: resources.workspaceSettings, defaultInvitesEnabled: false, defaultColorSettings: {}
    });
  });

  beforeEach(async () => {
    if (await knex.schema.hasTable("test_invitation_drafts")) {
      for (const table of ["test_invitation_audits", "test_invitation_scopes", "test_invitation_drafts"]) {
        await knex(table).delete();
      }
    }
    for (const table of TABLES) await knex(table).delete();
  });

  test("the users and workspaces table resources declare exactly the foreign keys the migrations create", async () => {
    const resources = [userProfileTableResource, userSettingsTableResource, ...WORKSPACES_TABLES];
    assert.deepEqual(await checkForeignKeys({ knex, resources, tables: TABLES }), { missing: [], undeclared: [] });
  });

  after(async () => {
    if (!knex) return;
    try {
      await stopFeatures();
      if (ownsTables) {
        for (const table of TABLES) await knex.schema.dropTableIfExists(table);
      }
    } finally {
      await knex.destroy();
    }
  });

  const createProfile = (name, options) => profiles.upsert({
    authProvider: "local",
    authProviderUserSid: `identity-${name}`,
    email: `${name}@example.com`,
    displayName: name
  }, options);

  test("profile and mapped user settings writes persist normalized values and UTC timestamps", async () => {
    const profile = await profiles.upsert({
      provider: " LOCAL ", providerUserId: " ada-identity ",
      email: " ADA@EXAMPLE.COM ", username: " Ada Lovelace ", displayName: " Ada Lovelace "
    });
    assert.equal(typeof profile.id, "string");
    assert.equal(profile.authProvider, "local");
    assert.equal(profile.authProviderUserSid, "ada-identity");
    assert.equal(profile.email, "ada@example.com");
    assert.equal(profile.username, "ada-lovelace");
    assert.equal(profile.displayName, "Ada Lovelace");
    assert.match(profile.createdAt, /Z$/u);
    assert.match(profile.updatedAt, /Z$/u);
    assert.equal((await profiles.findByEmail(" ADA@EXAMPLE.COM ")).id, profile.id);

    const updated = await profiles.upsert({
      provider: "local", providerUserId: "ada-identity", email: " ADA.NEW@EXAMPLE.COM ",
      username: "ignored-new-name", displayName: " Ada Updated "
    });
    assert.equal(updated.id, profile.id);
    assert.equal(updated.username, "ada-lovelace");
    assert.equal(updated.displayName, "Ada Updated");
    await profiles.updateAvatarById(profile.id, {
      avatarStorageKey: " avatars/ada.png ", avatarVersion: "v1",
      avatarUpdatedAt: new Date("2026-09-12T10:30:00.000Z")
    });
    const avatarProfile = await profiles.findById(profile.id);
    assert.equal(avatarProfile.avatarStorageKey, "avatars/ada.png");
    assert.equal(avatarProfile.avatarUpdatedAt, "2026-09-12T10:30:00.000Z");
    await profiles.clearAvatarById(profile.id);
    assert.equal((await profiles.findById(profile.id)).avatarUpdatedAt, null);

    const defaults = await userSettings.ensureForUserId(profile.id);
    assert.equal(defaults.id, profile.id);
    assert.equal(defaults.passwordSignInEnabled, true);
    const preferences = await userSettings.updatePreferences(profile.id, {
      locale: " EN-AU ", currencyCode: "aud", timeZone: " Australia/Perth ",
      avatarSize: 96, theme: " dark ", ignoredField: "must not reach storage"
    });
    assert.equal(preferences.locale, "en-AU");
    assert.equal(preferences.currencyCode, "AUD");
    assert.equal(preferences.timeZone, "Australia/Perth");
    assert.equal(preferences.avatarSize, 96);
    assert.equal(preferences.theme, "dark");
    await userSettings.updateNotifications(profile.id, { productUpdates: false, securityAlerts: true });
    const disabled = await userSettings.updatePasswordSignInEnabled(profile.id, false, { passwordSetupRequired: true });
    assert.equal(disabled.passwordSignInEnabled, false);
    assert.equal(disabled.passwordSetupRequired, true);
    assert.equal(disabled.productUpdates, false);
    const stored = await knex("user_settings").where({ user_id: profile.id }).first();
    assert.equal(stored.currency_code, "AUD");
    assert.equal(Number(stored.notify_product_updates), 0);
    assert.equal((await knex("users").where({ id: profile.id }).first()).email, "ada.new@example.com");
  });

  test("createWithSettings writes a profile with its settings in one transaction; countUsers counts by creation and exclusion", async () => {
    const { profile: staff, settings: staffSettings } = await profiles.createWithSettings({
      profile: { authProvider: "local", authProviderUserSid: "identity-staff", email: "staff@example.com", displayName: "Staff" },
      settings: { passwordSignInEnabled: false, locale: "en-AU", ignoredField: "must not reach storage" }
    });
    assert.equal(staff.email, "staff@example.com");
    assert.equal(staffSettings.id, staff.id);
    assert.equal(staffSettings.passwordSignInEnabled, false);
    assert.equal(staffSettings.locale, "en-AU");
    assert.equal(staffSettings.productUpdates, true);
    await assert.rejects(profiles.withTransaction({}, async (txOptions) => {
      await profiles.createWithSettings({
        profile: { authProvider: "local", authProviderUserSid: "identity-gone", email: "gone@example.com", displayName: "Gone" }
      }, txOptions);
      throw new Error("Abort sign-up");
    }), /Abort sign-up/u);
    assert.equal(await profiles.findByEmail("gone@example.com"), null);
    assert.equal(Number((await knex("user_settings").count({ count: "*" }).first()).count), 1);

    const old = await createProfile("Old");
    await knex("users").where({ id: old.id }).update({ created_at: "2001-01-01 00:00:00" });
    const ann = await createProfile("Ann");
    await createProfile("Ben");
    const dayAgo = new Date(Date.now() - 86400000);
    assert.equal(await profiles.countUsers(), 4);
    assert.equal(await profiles.countUsers({ createdSince: dayAgo }), 3);
    assert.equal(await profiles.countUsers({ excludeIds: [ann.id, old.id] }), 2);
    // Only the excluded users created since then are subtracted.
    assert.equal(await profiles.countUsers({ excludeIds: [ann.id, old.id, "999999"], createdSince: dayAgo.toISOString() }), 2);
    await profiles.withTransaction({}, async (txOptions) => {
      await createProfile("Cat", txOptions);
      assert.equal(await profiles.countUsers({}, txOptions), 5);
    });
  });

  test("workspace owner APIs: findBySlug leaves deleted workspaces out, addMember, activeMemberIds and lock", async (t) => {
    const owner = await createProfile("Ada");
    const member = await createProfile("Grace");
    const workspace = await workspaces.insert({ slug: "kept", name: "Kept", ownerUserId: owner.id });
    const deleted = await workspaces.insert({ slug: "deleted", name: "Deleted", ownerUserId: owner.id });
    await workspaces.updateById(deleted.id, { deletedAt: new Date().toISOString() });
    assert.equal((await workspaces.findBySlug(" KEPT ")).id, workspace.id);
    assert.equal(await workspaces.findBySlug("deleted"), null);
    assert.equal((await workspaces.findById(deleted.id)).slug, "deleted");
    const listed = await statementsOf(() => workspaces.listByIds([deleted.id, "999999", workspace.id, workspace.id, null]));
    assert.deepEqual(listed.result.map(({ slug }) => slug), ["kept", "deleted"], "By id, a missing id left out and a deleted workspace kept");
    const single = await statementsOf(() => workspaces.listByIds([workspace.id]));
    assert.equal(listed.statements, single.statements, `The same reads for one workspace and for two: ${listed.sql.join(" | ")}`);
    assert.deepEqual(await workspaces.listByIds([]), []);
    assert.deepEqual([...await workspaces.listSlugsIn(["deleted"])], ["deleted"], "A deleted workspace's slug stays taken");

    await memberships.ensureOwnerMembership(workspace.id, owner.id);
    const added = await memberships.addMember({ workspaceId: workspace.id, userId: member.id });
    assert.equal(added.roleSid, "member");
    assert.equal(added.status, "active");
    assert.deepEqual([...await memberships.activeMemberIds(workspace.id)].sort(), [owner.id, member.id].sort());
    await memberships.upsertMembership(workspace.id, member.id, { status: "removed" });
    const one = await statementsOf(() => memberships.activeMemberIds(workspace.id));
    assert.deepEqual(one.result, [owner.id]);
    const others = [...(await insertUsers(Array.from({ length: 30 }, (_, index) => `active-${index}`))).entries()]
      .filter(([username]) => username.startsWith("active-"))
      .map(([, id]) => id);
    for (const userId of others) await memberships.addMember({ workspaceId: workspace.id, userId });
    const many = await statementsOf(() => memberships.activeMemberIds(workspace.id));
    assert.deepEqual([...many.result].sort(), [owner.id, ...others].sort());
    t.diagnostic(`activeMemberIds: ${one.statements} statements for 1 member, ${many.statements} for 31: ${many.sql.join(" | ")}`);
    assert.equal(many.statements, one.statements, "The active member ids cost the same reads however many members there are");
    assert.ok(many.sql.every((sql) => /^select\b/iu.test(sql.trim())), "Reading member ids writes nothing");
    const readded = await memberships.addMember({ workspaceId: workspace.id, userId: member.id, roleSid: "admin" });
    assert.equal(readded.id, added.id);
    assert.equal(readded.roleSid, "admin");
    assert.equal(readded.status, "active");
    assert.deepEqual(await memberships.activeMemberIds("999999"), []);

    await assert.rejects(workspaces.lock(workspace.id), /needs a transaction/u);
    // The owner API's lock follows the missing-row rule: a missing workspace throws, or answers null with missing: "skip".
    await workspaces.withTransaction({}, async (txOptions) => {
      assert.deepEqual(await workspaces.lock(workspace.id, txOptions), { id: workspace.id });
      assert.equal(await workspaces.lock("999999", { ...txOptions, missing: "skip" }), null);
    });
    await assert.rejects(
      workspaces.withTransaction({}, (txOptions) => workspaces.lock("999999", txOptions)),
      (error) => error.code === "REST_API_RESOURCE" && error.subtype === "not_found"
    );
  });

  test("workspaces.lock and memberships.lockByWorkspaceIdAndUserId take lockMode share, and refuse another mode before any statement", async () => {
    const owner = await createProfile("Ada");
    const workspace = await workspaces.insert({ slug: "shared", name: "Shared", ownerUserId: owner.id });
    await memberships.ensureOwnerMembership(workspace.id, owner.id);
    // A read check that needs the workspace and the membership unchanged until it commits holds them shared.
    const { result, sql } = await statementsOf(() => workspaces.withTransaction({}, async (txOptions) => {
      const shared = { ...txOptions, lockMode: "share" };
      return [
        await workspaces.lock(workspace.id, shared),
        (await memberships.lockByWorkspaceIdAndUserId(workspace.id, owner.id, shared))?.userId
      ];
    }));
    assert.deepEqual(result, [{ id: workspace.id }, owner.id]);
    const locking = sql.filter((statement) => /\bfor (?:update|share|no key update)\b|\block in share mode\b/iu.test(statement));
    const clause = { pg: /\bfor share\b/iu, mysql2: /\block in share mode\b/iu }[configuration.client];
    if (clause) {
      // PostgreSQL's lockWhere reads its rows again after the lock, so the membership's lock may be two statements.
      assert.ok(locking.some((statement) => /\bfrom [`"]?workspaces[`"]? /u.test(statement)), sql.join(" | "));
      assert.ok(locking.some((statement) => /\bfrom [`"]?workspace_memberships[`"]? /u.test(statement)), sql.join(" | "));
      assert.ok(locking.every((statement) => clause.test(statement)), locking.join(" | "));
    } else {
      assert.deepEqual(locking, [], "SQLite takes its write lock, not a row lock");
    }
    const refused = await statementsOf(() => workspaces.withTransaction({}, async (txOptions) => {
      const exclusive = { ...txOptions, lockMode: "exclusive" };
      await assert.rejects(workspaces.lock(workspace.id, exclusive), { name: "TypeError", message: /lockMode is "update" \(the default\), "noKeyUpdate" or "share"/u });
      await assert.rejects(memberships.lockByWorkspaceIdAndUserId(workspace.id, owner.id, exclusive), { name: "TypeError", message: /lockMode is "update" \(the default\), "noKeyUpdate" or "share"/u });
    }));
    assert.equal(refused.sql.filter((statement) => /^\s*select\b/iu.test(statement)).length, 0, refused.sql.join(" | "));
  });

  test("another owner's report joins the workspaces' and memberships' join sources in one statement, each keeping its filters and the report its scope", async (t) => {
    // Another feature's workspace-owned table, whose report reads each row's workspace slug and active membership.
    await knex.schema.createTable("test_reminders", (table) => {
      table.increments("id");
      table.bigInteger("workspace_id").unsigned().nullable();
      table.bigInteger("user_id").unsigned().nullable();
      table.string("note").notNullable();
    });
    t.after(() => knex.schema.dropTableIfExists("test_reminders"));
    const { reminders } = await runtime.own("test.reminders", [defineTableResource({
      name: "reminders",
      tableName: "test_reminders",
      ownership: "workspace",
      defaultSort: ["id"],
      schema: {
        workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
        userId: { type: "id", nullable: true, storage: { column: "user_id" } },
        note: { type: "string", required: true }
      }
    })]);

    // Knex: report - each reminder with its workspace's slug and whether its person is still an active member
    async function remindersWithMembers(options, workspaceFilters) {
      const workspaceSource = await workspaces.joinSource({ alias: "w", filters: workspaceFilters }, options);
      const membershipSource = await memberships.joinSource({ alias: "m", filters: { status: "active" } }, options);
      const kept = workspaceSource.query.select({ id: workspaceSource.column("id"), slug: workspaceSource.column("slug") }).as("ws");
      const active = membershipSource.query
        .select({ workspaceId: membershipSource.column("workspaceId"), userId: membershipSource.column("userId") })
        .as("ms");
      const { query } = await reminders.scopedQuery({ alias: "r" }, options);
      const workspaceId = reminders.column("workspaceId", "r");
      const userId = reminders.column("userId", "r");
      const rows = await query
        .join(kept, "ws.id", workspaceId)
        .leftJoin(active, function onMembership() {
          this.on("ms.workspaceId", "=", workspaceId).andOn("ms.userId", "=", userId);
        })
        .select({ note: reminders.column("note", "r"), slug: "ws.slug", member: "ms.userId" })
        .orderBy(reminders.column("id", "r"));
      return rows.map(({ note, slug, member }) => ({ note, slug, member: member == null ? null : String(member) }));
    }

    const owner = await createProfile("Ada");
    const member = await createProfile("Grace");
    const first = await workspaces.insert({ slug: "first", name: "First", ownerUserId: owner.id });
    const second = await workspaces.insert({ slug: "second", name: "Second", ownerUserId: owner.id });
    const closed = await workspaces.insert({ slug: "closed", name: "Closed", ownerUserId: owner.id });
    await workspaces.updateById(closed.id, { deletedAt: new Date().toISOString() });
    await memberships.ensureOwnerMembership(first.id, owner.id);
    await memberships.addMember({ workspaceId: first.id, userId: member.id });
    await memberships.upsertMembership(first.id, member.id, { status: "removed" });
    await memberships.ensureOwnerMembership(closed.id, owner.id);
    const inWorkspace = (workspace) => ({ context: { workspace: { id: workspace.id } } });
    await reminders.createMany([
      { userId: owner.id, note: "owner's" },
      { userId: member.id, note: "former member's" }
    ], { ...inWorkspace(first), returning: "none" });
    await reminders.create({ userId: owner.id, note: "second's" }, { ...inWorkspace(second), returning: "none" });
    await reminders.create({ userId: owner.id, note: "closed's" }, { ...inWorkspace(closed), returning: "none" });

    const report = await statementsOf(() => remindersWithMembers(inWorkspace(first), { deletedAt: null }));
    assert.deepEqual(report.result, [
      { note: "owner's", slug: "first", member: owner.id },
      { note: "former member's", slug: "first", member: null }
    ], "The report keeps to its own workspace, and a removed membership is not an active one");
    assert.equal(report.statements, 1, `One statement: ${report.sql.join(" | ")}`);
    assert.deepEqual(await remindersWithMembers(inWorkspace(second), { deletedAt: null }), [
      { note: "second's", slug: "second", member: null }
    ], "No membership in that workspace answers no member");
    assert.deepEqual(await remindersWithMembers(inWorkspace(closed), { deletedAt: null }), [], "A deleted workspace is left out by its filter");
    assert.deepEqual(await remindersWithMembers(inWorkspace(closed), undefined), [
      { note: "closed's", slug: "closed", member: owner.id }
    ], "Without the filter the source answers every workspace the handle reads");
    await assert.rejects(workspaces.joinSource({ filters: {} }), /needs the alias/u);
    await assert.rejects(memberships.joinSource({ alias: "" }), /needs the alias/u);
  });

  test("workspace and membership repositories read mapped relationships through includes", async () => {
    const owner = await createProfile("Ada");
    const member = await createProfile("Grace");
    const workspace = await workspaces.insert({
      slug: " TEAM-ONE ", name: " Team One ", ownerUserId: owner.id, isPersonal: true
    });
    assert.equal(workspace.slug, "team-one");
    assert.equal(workspace.name, "Team One");
    assert.equal(workspace.ownerUserId, owner.id);
    assert.equal(workspace.isPersonal, true);
    assert.equal((await workspaces.findPersonalByOwnerUserId(owner.id)).id, workspace.id);

    const ownerMembership = await memberships.ensureOwnerMembership(workspace.id, owner.id);
    assert.equal(ownerMembership.workspaceId, workspace.id);
    assert.equal(ownerMembership.userId, owner.id);
    assert.equal(ownerMembership.roleSid, "owner");
    await memberships.upsertMembership(workspace.id, member.id, { roleSid: " MEMBER ", status: " ACTIVE " });
    const listed = await memberships.listActiveByWorkspaceId(workspace.id);
    assert.deepEqual(listed.map(({ displayName, email }) => ({ displayName, email })), [
      { displayName: "Ada", email: "ada@example.com" },
      { displayName: "Grace", email: "grace@example.com" }
    ]);
    const visible = await workspaces.listForUserId(member.id);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].ownerUserId, owner.id);
    assert.equal(visible[0].roleSid, "member");
    assert.deepEqual(await memberships.listActiveWorkspaceIdsByUserId(member.id), [workspace.id]);
    const changed = await workspaces.updateById(workspace.id, { ownerUserId: member.id, name: " Renamed " });
    assert.equal(changed.ownerUserId, member.id);
    assert.equal((await knex("workspaces").where({ id: workspace.id }).first()).name, "Renamed");
    await memberships.upsertMembership(workspace.id, member.id, { status: "inactive" });
    assert.deepEqual(await workspaces.listForUserId(member.id), []);
    // The member is gone from the active list and still in the list of every status, with theirs.
    assert.deepEqual((await memberships.listActiveByWorkspaceId(workspace.id)).map(({ displayName }) => displayName), ["Ada"]);
    assert.deepEqual((await memberships.listByWorkspaceId(workspace.id)).map(({ displayName, status }) => ({ displayName, status })), [
      { displayName: "Ada", status: "active" },
      { displayName: "Grace", status: "inactive" }
    ]);
    assert.deepEqual(await memberships.listByWorkspaceId(null), []);
  });

  const createMembers = () => createMembersService({
    workspaceMembershipsRepository: memberships,
    workspaceMemberPagesRepository: memberPages,
    workspaceInvitesRepository: invites,
    inviteExpiresInMs: 86400000,
    roleCatalog: createWorkspaceRoleCatalog(),
    workspaceInvitationsEnabled: false,
    inviteUrlBuilder: createWorkspaceInviteUrlBuilder({ appConfig: {}, env: {} }),
    workspaceInviteMailer: unconfiguredWorkspaceInviteMailer,
    workspaceInviteEmailTemplate: renderDefaultWorkspaceInviteEmail,
    i18n: createWorkspacesServerI18n(),
    userProfilesRepository: profiles,
    userSettingsRepository: userSettings
  });

  // Every member the members screen's list answers, a page at a time.
  async function everyListedMember(membersService, workspace) {
    const members = [];
    let cursor = null;
    do {
      const page = await membersService.listMembersPage(workspace, { limit: 100, ...(cursor ? { cursor } : {}) });
      members.push(...page.members);
      cursor = page.nextCursor;
    } while (cursor);
    return members;
  }

  // Lists of more rows than json-rest-api's default page (20) and maximum page (100), written in bulk.
  async function insertRows(table, rows) {
    for (let start = 0; start < rows.length; start += 100) {
      await knex(table).insert(rows.slice(start, start + 100));
    }
  }

  async function insertUsers(usernames, displayName = (username) => username) {
    await insertRows("users", usernames.map((username) => ({
      auth_provider: "local",
      auth_provider_user_sid: `identity-${username}`,
      email: `${username}@example.com`,
      username,
      display_name: displayName(username)
    })));
    const rows = await knex("users").select("id", "username");
    return new Map(rows.map((row) => [row.username, String(row.id)]));
  }

  async function insertWorkspaces(count, ownerUserId) {
    await insertRows("workspaces", Array.from({ length: count }, (_, index) => ({
      slug: `team-${index}`,
      name: `Team ${index}`,
      owner_user_id: ownerUserId,
      is_personal: false
    })));
    return (await knex("workspaces").orderBy("id").select("id")).map((row) => String(row.id));
  }

  // The run's result and the SQL statements it issued.
  async function statementsOf(run) {
    let statements = 0;
    const sql = [];
    const onQuery = (query) => {
      statements += 1;
      sql.push(String(query?.sql || ""));
    };
    knex.on("query", onQuery);
    try {
      const result = await run();
      return { result, statements, sql };
    } finally {
      knex.removeListener("query", onQuery);
    }
  }

  test("a workspace's 1,050 active members are all listed, sorted by name, inside a transaction too", async () => {
    // Inserted in an order unrelated to their names, so the pages' id order is not the name order.
    const numbers = Array.from({ length: 1050 }, (_, index) => String((index * 7919) % 1050).padStart(4, "0"));
    const users = await insertUsers(
      [...numbers.map((number) => `member-${number}`), "member-left"],
      (username) => username.replace("member-", "Member ")
    );
    const ownerId = users.get(`member-${numbers[0]}`);
    const workspace = await workspaces.insert({ slug: "big-team", name: "Big Team", ownerUserId: ownerId });
    await insertRows("workspace_memberships", [...users].map(([username, userId]) => ({
      workspace_id: workspace.id,
      user_id: userId,
      role_sid: userId === ownerId ? "owner" : "member",
      status: username === "member-left" ? "inactive" : "active"
    })));
    const expectedNames = numbers.map((number) => `Member ${number}`).sort();

    const listed = await memberships.listActiveByWorkspaceId(workspace.id);
    assert.equal(listed.length, 1050);
    assert.deepEqual(listed.map(({ displayName }) => displayName), expectedNames);
    assert.equal(new Set(listed.map(({ userId }) => userId)).size, 1050);

    const membersService = createMembers();
    const { members } = await membersService.listMembers(workspace);
    assert.deepEqual(members.map(({ userId }) => userId), listed.map(({ userId }) => userId));
    assert.deepEqual(members.filter(({ isOwner }) => isOwner).map(({ userId }) => userId), [ownerId]);
    // The members screen's pages answer them in the same order.
    const paged = await everyListedMember(membersService, workspace);
    assert.deepEqual(paged.map(({ userId }) => userId), listed.map(({ userId }) => userId));

    await profiles.withTransaction({}, async (txOptions) => {
      const joiner = await createProfile("Zara", txOptions);
      await memberships.upsertMembership(workspace.id, joiner.id, { roleSid: "member", status: "active" }, txOptions);
      const withJoiner = await memberships.listActiveByWorkspaceId(workspace.id, txOptions);
      assert.equal(withJoiner.length, 1051);
      assert.equal(withJoiner.at(-1).displayName, "Zara");
      // listMembers reads with the caller's options: inside the transaction it sees the joiner too.
      const { members: everyMember } = await membersService.listMembers(workspace, txOptions);
      assert.equal(everyMember.length, 1051);
      assert.equal(everyMember.at(-1).displayName, "Zara");
    });
  });

  test("getMember answers a member's listMembers entry at the same cost among 10 and 200 members", async () => {
    const usernames = Array.from({ length: 212 }, (_, index) => `person-${String(index).padStart(3, "0")}`);
    const users = await insertUsers(usernames, (username) => username.replace("person-", "Person "));
    const ownerId = users.get("person-000");
    const small = await workspaces.insert({ slug: "small-team", name: "Small Team", ownerUserId: ownerId });
    const large = await workspaces.insert({ slug: "large-team", name: "Large Team", ownerUserId: ownerId });
    // Small: persons 0-9 (9 removed). Large: persons 0 and 10-209 (209 removed). 210 and 211 are in neither.
    const membership = (workspaceId, username, status = "active") => ({
      workspace_id: workspaceId,
      user_id: users.get(username),
      role_sid: users.get(username) === ownerId ? "owner" : "member",
      status
    });
    await insertRows("workspace_memberships", [
      ...usernames.slice(0, 10).map((username) => membership(small.id, username, username === "person-009" ? "revoked" : "active")),
      membership(large.id, "person-000"),
      ...usernames.slice(10, 210).map((username) => membership(large.id, username, username === "person-209" ? "revoked" : "active"))
    ]);
    const membersService = createMembers();

    for (const [workspace, memberName, removedName] of [
      [small, "person-004", "person-009"],
      [large, "person-150", "person-209"]
    ]) {
      const { members } = await membersService.listMembers(workspace);
      for (const userId of [users.get(memberName), ownerId]) {
        const entry = members.find((member) => member.userId === userId);
        assert.ok(entry);
        assert.deepEqual(await membersService.getMember(workspace, userId), entry);
      }
      assert.equal((await membersService.getMember(workspace, ownerId)).isOwner, true);
      assert.equal(await membersService.getMember(workspace, users.get(removedName)), null);
      assert.equal(await membersService.getMember(workspace, users.get("person-211")), null);
      assert.equal(await membersService.getMember(workspace, "999999"), null);
    }
    assert.equal(await membersService.getMember(small, users.get("person-150")), null);

    const smallRead = await statementsOf(() => membersService.getMember(small, users.get("person-004")));
    const largeRead = await statementsOf(() => membersService.getMember(large, users.get("person-150")));
    assert.equal(smallRead.result.displayName, "Person 004");
    assert.equal(largeRead.result.displayName, "Person 150");
    assert.equal(largeRead.statements, smallRead.statements);
    assert.ok(smallRead.statements <= 4, `one member read costs ${smallRead.statements} statements`);
    await profiles.withTransaction({}, async (txOptions) => {
      const member = await membersService.getMember(large, users.get("person-150"), txOptions);
      assert.equal(member.userId, users.get("person-150"));
    });
  });

  // `base`, then `base-2` to `base-<count>`: the names `count` earlier namesakes took.
  const namesakes = (base, count) => [base, ...Array.from({ length: count - 1 }, (_, index) => `${base}-${index + 2}`)];

  test("a new profile's username costs the same statements after 10 and after 200 namesakes", async () => {
    await insertUsers([...namesakes("info", 10), ...namesakes("john", 200)]);
    const signUp = (base) => statementsOf(() => profiles.upsert({
      authProvider: "local",
      authProviderUserSid: `newcomer-${base}`,
      email: `${base}@newcomer.example`,
      displayName: base
    }));

    const few = await signUp("info");
    const many = await signUp("john");
    assert.equal(few.result.username, "info-11");
    assert.equal(many.result.username, "john-201");
    // A read per taken candidate would add about 190 statements.
    assert.equal(many.statements, few.statements, `${few.statements} statements after 10 namesakes, ${many.statements} after 200`);
  });

  test("a new workspace's slug costs the same statements after 10 and after 200 namesakes", async () => {
    const users = await insertUsers(["founder"]);
    const ownerUserId = users.get("founder");
    await insertRows("workspaces", [...namesakes("acme", 10), ...namesakes("globex", 200)].map((slug) => ({
      slug, name: slug, owner_user_id: ownerUserId, is_personal: false
    })));
    const directory = createDirectoryService({
      tenancyProfile: resolveTenancyProfile({ tenancyMode: "workspaces", tenancyPolicy: { workspace: { allowSelfCreate: true } } }),
      roleCatalog: createWorkspaceRoleCatalog(),
      personalWorkspaceName: buildWorkspaceName,
      createdParticipant: noWorkspaceCreatedParticipant,
      workspacesRepository: workspaces,
      workspaceMembershipsRepository: memberships,
      workspaceSettingsRepository: settings
    });
    const create = (name) => statementsOf(() => directory.createWorkspaceForAuthenticatedUser({ id: ownerUserId }, { name }));

    const few = await create("Acme");
    const many = await create("Globex");
    assert.equal(few.result.value.slug, "acme-11");
    assert.equal(many.result.value.slug, "globex-201");
    // A read per taken candidate would add about 190 statements.
    assert.equal(many.statements, few.statements, `${few.statements} statements after 10 namesakes, ${many.statements} after 200`);
  });

  test("an ordinary request reads its matching profile in one statement; sign-in and a changed identity synchronize in full", async () => {
    const directory = createDirectoryService({
      tenancyProfile: resolveTenancyProfile({ tenancyMode: "personal" }),
      roleCatalog: createWorkspaceRoleCatalog(),
      personalWorkspaceName: buildWorkspaceName,
      createdParticipant: noWorkspaceCreatedParticipant,
      workspacesRepository: workspaces,
      workspaceMembershipsRepository: memberships,
      workspaceSettingsRepository: settings
    });
    // What WorkspacesIntegrationsProvider registers: a synchronization provisions the personal workspace.
    usersExtensions.registerProfileSyncLifecycleContributor({
      contributorId: "workspaces.provisioning",
      order: 100,
      afterIdentityProfileSynced: ({ profile, options }) => directory.ensureProvisionedWorkspaceForAuthenticatedUser(profile, options)
    });
    const identity = (displayName) => ({ authProvider: "local", authProviderUserSid: "identity-ada", email: "ada@example.com", displayName });
    const personalWorkspaces = (userId) => knex("workspaces").where({ owner_user_id: userId, is_personal: true }).count({ count: "*" })
      .first().then((row) => Number(row.count));

    const signIn = await statementsOf(() => profileProjector.syncIdentityProfile(identity("Ada")));
    const userId = signIn.result.id;
    assert.equal(await personalWorkspaces(userId), 1);
    const read = await statementsOf(() => profiles.findByIdentity({ provider: "local", providerUserId: "identity-ada" }));

    const request = await statementsOf(() => profileProjector.syncIdentityProfile(identity("Ada"), { onlyWhenChanged: true }));
    assert.equal(request.result.id, userId);
    assert.equal(request.statements, read.statements, "An ordinary request reads the profile and nothing else");
    assert.ok(signIn.statements > read.statements, `sign-in ${signIn.statements} statements, a profile read ${read.statements}`);

    // A deleted personal workspace is not provisioned again by an ordinary request, only by the next full synchronization.
    await knex("workspace_settings").delete();
    await knex("workspace_memberships").delete();
    await knex("workspaces").delete();
    await profileProjector.syncIdentityProfile(identity("Ada"), { onlyWhenChanged: true });
    assert.equal(await personalWorkspaces(userId), 0);
    await profileProjector.syncIdentityProfile(identity("Ada"));
    assert.equal(await personalWorkspaces(userId), 1);

    // An identity whose name changed outside the app is synchronized by the request that carries it.
    const renamed = await statementsOf(() => profileProjector.syncIdentityProfile(identity("Ada Lovelace"), { onlyWhenChanged: true }));
    assert.equal(renamed.result.displayName, "Ada Lovelace");
    assert.ok(renamed.statements > read.statements);
  });

  test("a member of 130 workspaces has all of them listed", async () => {
    const users = await insertUsers(["host", "roaming"]);
    const workspaceIds = await insertWorkspaces(135, users.get("host"));
    await insertRows("workspace_memberships", workspaceIds.map((workspaceId, index) => ({
      workspace_id: workspaceId,
      user_id: users.get("roaming"),
      role_sid: "member",
      status: index < 130 ? "active" : "inactive"
    })));
    const activeIds = workspaceIds.slice(0, 130);

    const ids = await memberships.listActiveWorkspaceIdsByUserId(users.get("roaming"));
    assert.deepEqual([...ids].sort(), [...activeIds].sort());
    assert.deepEqual((await workspaces.listForUserId(users.get("roaming"))).map(({ id }) => id), activeIds);
  });

  test("the bulk read lists each user's active workspaces at the same cost for 10 and 200 users", async () => {
    const usernames = Array.from({ length: 202 }, (_, index) => `person-${String(index).padStart(3, "0")}`);
    const users = await insertUsers(usernames);
    const [first, second, third] = await insertWorkspaces(3, users.get("person-000"));
    // Each person is active in the first workspace; even persons are active in the second
    // too, odd ones were invited to it, and every tenth was removed from the third.
    await insertRows("workspace_memberships", usernames.flatMap((username, index) => [
      { workspace_id: first, user_id: users.get(username), role_sid: "member", status: "active" },
      {
        workspace_id: second,
        user_id: users.get(username),
        role_sid: "member",
        status: index % 2 === 0 ? "active" : "invited"
      },
      ...(index % 10 === 0
        ? [{ workspace_id: third, user_id: users.get(username), role_sid: "member", status: "removed" }]
        : [])
    ]));
    const expectedFor = (index) => (index % 2 === 0 ? [first, second] : [first]);
    const idsOf = (names) => names.map((username) => users.get(username));

    const small = await statementsOf(() => memberships.listActiveWorkspaceIdsByUserIds(idsOf(usernames.slice(0, 10))));
    const large = await statementsOf(() => memberships.listActiveWorkspaceIdsByUserIds(idsOf(usernames.slice(0, 200))));
    for (const [read, names] of [[small, usernames.slice(0, 10)], [large, usernames.slice(0, 200)]]) {
      assert.deepEqual([...read.result.keys()].sort(), idsOf(names).sort());
      names.forEach((username, index) => {
        assert.deepEqual([...read.result.get(users.get(username))].sort(), expectedFor(index).sort());
      });
    }
    assert.equal(large.statements, small.statements);

    // A user with no active membership is still answered, with no workspaces.
    const outsider = (await insertUsers(["outsider"])).get("outsider");
    assert.deepEqual(await memberships.listActiveWorkspaceIdsByUserIds([outsider]), new Map([[outsider, []]]));
    assert.deepEqual(await memberships.listActiveWorkspaceIdsByUserIds([]), new Map());

    // Narrowed to the second and third workspaces, the read answers only those memberships, at the same cost.
    const amongSmall = await statementsOf(() => memberships.listActiveWorkspaceIdsByUserIdsAmong(
      [...idsOf(usernames.slice(0, 10)), outsider], [second, third]
    ));
    const amongLarge = await statementsOf(() => memberships.listActiveWorkspaceIdsByUserIdsAmong(
      idsOf(usernames.slice(0, 200)), [second, third]
    ));
    usernames.slice(0, 200).forEach((username, index) => {
      assert.deepEqual(amongLarge.result.get(users.get(username)), index % 2 === 0 ? [second] : []);
    });
    assert.deepEqual(amongSmall.result.get(outsider), []);
    assert.equal(amongLarge.statements, amongSmall.statements);
    assert.deepEqual(await memberships.listActiveWorkspaceIdsByUserIdsAmong(idsOf(usernames.slice(0, 2)), []), new Map([
      [users.get("person-000"), []],
      [users.get("person-001"), []]
    ]));
  });

  test("a workspace's 120 pending invitations and an email's 110 are all listed", async () => {
    const users = await insertUsers(["host"]);
    const [crowdedId, ...otherIds] = await insertWorkspaces(111, users.get("host"));
    await insertRows("workspace_invites", [
      ...Array.from({ length: 123 }, (_, index) => ({
        workspace_id: crowdedId,
        email: `guest-${index}@example.com`,
        status: index < 120 ? "pending" : "accepted",
        token_hash: `crowded-${index}`
      })),
      ...otherIds.map((workspaceId) => ({
        workspace_id: workspaceId,
        email: "roaming@example.com",
        status: "pending",
        token_hash: `roaming-${workspaceId}`
      }))
    ]);

    const crowded = await invites.listPendingByWorkspaceIdWithWorkspace(crowdedId);
    assert.equal(crowded.length, 120);
    assert.equal(new Set(crowded.map(({ email }) => email)).size, 120);
    const roaming = await invites.listPendingByEmail("roaming@example.com");
    assert.deepEqual(roaming.map(({ workspaceId }) => workspaceId).sort(), [...otherIds].sort());
    assert.ok(roaming.every(({ workspaceSlug }) => workspaceSlug.startsWith("team-")));
  });

  test("workspace settings and invitation lifecycle preserve logical IDs and included workspaces", async () => {
    const owner = await createProfile("Ada");
    const workspace = await workspaces.insert({ slug: "invitations", name: "Invitations", ownerUserId: owner.id });
    const initial = await settings.ensureForWorkspaceId(workspace.id);
    assert.equal(initial.id, workspace.id);
    const changed = await settings.updateSettingsByWorkspaceId(workspace.id, {
      lightPrimaryColor: "#abcdef", invitesEnabled: false, name: "Ignored legacy name"
    });
    assert.equal(changed.lightPrimaryColor, "#ABCDEF");
    assert.equal(changed.invitesEnabled, false);
    assert.equal((await workspaces.findById(workspace.id)).name, "Invitations");
    assert.equal((await knex("workspace_settings").where({ workspace_id: workspace.id }).first()).light_primary_color, "#ABCDEF");
    const invite = await invites.insert({
      workspaceId: workspace.id, email: " GRACE@EXAMPLE.COM ", roleSid: " MEMBER ",
      tokenHash: " token-one ", invitedByUserId: owner.id,
      expiresAt: new Date("2026-09-14T10:00:00.000Z")
    });
    assert.equal(invite.workspaceId, workspace.id);
    assert.equal(invite.invitedByUserId, owner.id);
    assert.equal(invite.email, "grace@example.com");
    assert.equal(invite.expiresAt, "2026-09-14T10:00:00.000Z");
    const pending = await invites.listPendingByEmail(" GRACE@EXAMPLE.COM ");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].workspaceSlug, "invitations");
    assert.equal(pending[0].workspaceName, "Invitations");
    assert.equal((await invites.findPendingByIdForWorkspace(invite.id, workspace.id)).id, invite.id);
    await invites.markAcceptedById(invite.id);
    assert.equal(await invites.findPendingByTokenHash("token-one"), null);
    const accepted = await invites.findByTokenHashWithWorkspace("token-one");
    assert.equal(accepted.status, "accepted");
    assert.match(accepted.acceptedAt, /Z$/u);
    assert.equal(accepted.workspaceId, workspace.id);
  });

  test("an invite's realtime recipient is the user its email belongs to, in any status", async () => {
    const owner = await createProfile("Ada");
    const workspace = await workspaces.insert({ slug: "recipients", name: "Recipients", ownerUserId: owner.id });
    const invite = await invites.insert({ workspaceId: workspace.id, email: "grace@example.com", tokenHash: "recipient-token" });
    const membersService = createMembers();
    assert.deepEqual(await membersService.inviteRecipientUserIds(invite.id), [], "Nobody to reach before the person signs up");
    const grace = await createProfile("Grace");
    assert.deepEqual(await membersService.inviteRecipientUserIds(invite.id), [grace.id]);
    // Realtime reads with the event's own scope: the workspace the invite belongs to.
    const eventScope = { context: runtime.declareSystemScope("realtime.audience-scope", "read an event's audience")("read an invite's recipients").forWorkspace(workspace.id) };
    assert.deepEqual(await membersService.inviteRecipientUserIds(invite.id, eventScope), [grace.id]);
    await invites.revokeById(invite.id);
    assert.deepEqual(await membersService.inviteRecipientUserIds(invite.id), [grace.id]);
    assert.deepEqual(await membersService.inviteRecipientUserIds("999999"), []);
  });

  test("one managed transaction rolls back onboarding across all six repositories", async () => {
    await assert.rejects(profiles.withTransaction({}, async (options) => {
      const owner = await createProfile("Rollback", options);
      await userSettings.ensureForUserId(owner.id, options);
      const workspace = await workspaces.insert({ slug: "rollback", name: "Rollback", ownerUserId: owner.id }, options);
      await memberships.ensureOwnerMembership(workspace.id, owner.id, options);
      await settings.ensureForWorkspaceId(workspace.id, options);
      await invites.insert({ workspaceId: workspace.id, email: "invite@example.com", tokenHash: "rollback-token" }, options);
      assert.equal((await workspaces.listForUserId(owner.id, options))[0].id, workspace.id);
      throw new Error("Abort onboarding");
    }), /Abort onboarding/u);
    for (const table of TABLES) {
      assert.equal(Number((await knex(table).count({ count: "*" }).first()).count), 0, `${table} must roll back`);
    }
  });

  test("a standalone duplicate workspace recovers after rollback without overwriting the existing row", async () => {
    const owner = await createProfile("Ada");
    const original = await workspaces.insert({ slug: "duplicate", name: "Original", ownerUserId: owner.id });
    const duplicate = await workspaces.insert({ slug: "duplicate", name: "Replacement", ownerUserId: owner.id });
    assert.equal(duplicate.id, original.id);
    assert.equal(duplicate.name, "Original");
    assert.equal(Number((await knex("workspaces").count({ count: "*" }).first()).count), 1);
  });

  test("a create that loses its slug to another owner's workspace never answers it, and the directory picks again", async () => {
    const ada = await createProfile("Ada");
    const grace = await createProfile("Grace");
    const adas = await workspaces.insert({ slug: "acme", name: "Acme", ownerUserId: ada.id });
    const duplicate = (error) => Boolean(findDuplicateEntryError(error));
    await assert.rejects(workspaces.insert({ slug: "acme", name: "Acme", ownerUserId: grace.id }), duplicate);
    // The same owner's personal create does not answer a team workspace either.
    await assert.rejects(workspaces.insert({ slug: "acme", name: "Acme", ownerUserId: ada.id, isPersonal: true }), duplicate);

    // The directory's free-slug read misses Ada's workspace once, as when it is created between the read and the insert.
    let missed = false;
    const racing = {
      ...workspaces,
      async listSlugsIn(slugs, options) {
        if (!missed) {
          missed = true;
          return new Set();
        }
        return workspaces.listSlugsIn(slugs, options);
      }
    };
    const directory = createDirectoryService({
      tenancyProfile: resolveTenancyProfile({ tenancyMode: "workspaces", tenancyPolicy: { workspace: { allowSelfCreate: true } } }),
      roleCatalog: createWorkspaceRoleCatalog(),
      personalWorkspaceName: buildWorkspaceName,
      createdParticipant: noWorkspaceCreatedParticipant,
      workspacesRepository: racing,
      workspaceMembershipsRepository: memberships,
      workspaceSettingsRepository: settings
    });
    const created = await directory.createWorkspaceForAuthenticatedUser({ id: grace.id }, { name: "Acme" });
    assert.equal(missed, true);
    assert.equal(created.value.slug, "acme-2");
    assert.notEqual(String(created.value.id), String(adas.id));
    assert.equal(String((await workspaces.findBySlug("acme-2")).ownerUserId), String(grace.id));
  });

  test("a new workspace's created participant runs in its creation transaction, and its failure leaves nothing of the creation", async () => {
    const count = async (table, where = {}) => Number((await knex(table).where(where).count({ count: "*" }).first()).count);
    const seen = [];
    let refusal = null;
    let duplicateWrite = false;
    // The application's participant reads what the creation wrote and makes a write of its own in the same transaction.
    async function createdParticipant({ workspace, owner }, options) {
      const ownerMembership = await memberships.findByWorkspaceIdAndUserId(workspace.id, owner.id, options);
      const workspaceSettings = await settings.findByWorkspaceId(workspace.id, options);
      seen.push({
        slug: workspace.slug,
        isPersonal: workspace.isPersonal,
        owner: owner.id,
        role: ownerMembership.roleSid,
        settings: String(workspaceSettings.id) === String(workspace.id),
        frozen: Object.isFrozen(workspace) && Object.isFrozen(owner),
        trx: options.trx
      });
      await profiles.updateDisplayNameById(owner.id, `${owner.displayName} of ${workspace.slug}`, options);
      if (duplicateWrite) await workspaces.insert({ slug: "acme", name: "Copy", ownerUserId: owner.id }, options);
      if (refusal) throw refusal;
    }
    let missOwnSlug = false;
    const directory = createDirectoryService({
      tenancyProfile: resolveTenancyProfile({ tenancyMode: "workspaces", tenancyPolicy: { workspace: { allowSelfCreate: true } } }),
      roleCatalog: createWorkspaceRoleCatalog(),
      personalWorkspaceName: buildWorkspaceName,
      createdParticipant,
      // The free-slug read can miss a workspace once, as when another create inserts it between the read and the insert.
      workspacesRepository: {
        ...workspaces,
        async listSlugsIn(slugs, options) {
          if (missOwnSlug) {
            missOwnSlug = false;
            return new Set();
          }
          return workspaces.listSlugsIn(slugs, options);
        }
      },
      workspaceMembershipsRepository: memberships,
      workspaceSettingsRepository: settings
    });
    const ada = await createProfile("ada");
    const grace = await createProfile("grace");

    const team = (await directory.createWorkspaceForAuthenticatedUser(ada, { name: "Acme", slug: "acme" })).value;
    const personal = await directory.ensurePersonalWorkspaceForUser(grace);
    assert.deepEqual(seen.map(({ trx, ...entry }) => entry), [
      { slug: "acme", isPersonal: false, owner: ada.id, role: "owner", settings: true, frozen: true },
      { slug: "grace", isPersonal: true, owner: grace.id, role: "owner", settings: true, frozen: true }
    ]);
    assert.ok(seen.every(({ trx }) => trx), "each ran inside its creation's transaction");
    assert.equal((await profiles.findById(ada.id)).displayName, "ada of acme");
    assert.equal((await directory.ensurePersonalWorkspaceForUser(grace)).id, personal.id);
    assert.equal(seen.length, 2, "an existing personal workspace is not created again, and runs no participant");

    // A create that loses its slug to the same owner's same kind of workspace answers that workspace, and runs no participant.
    missOwnSlug = true;
    assert.equal((await directory.createWorkspaceForAuthenticatedUser(ada, { name: "Acme", slug: "acme" })).value.id, team.id);
    assert.equal(seen.length, 2);

    // Inside the caller's transaction, the participant runs in that transaction.
    const carol = await createProfile("carol");
    await userSettings.withTransaction({}, async (txOptions) => {
      await directory.ensurePersonalWorkspaceForUser(carol, txOptions);
      assert.equal(seen.at(-1).trx, txOptions.trx);
    });

    // A participant's refusal rolls back the workspace, its owner's membership, its settings and the participant's own write.
    refusal = new AppError(409, "This workspace cannot be set up yet.", { code: "test.workspace.setupRefused" });
    const workspacesBefore = await count("workspaces");
    const settingsBefore = await count("workspace_settings");
    const bob = await createProfile("bob");
    for (const create of [
      () => directory.createWorkspaceForAuthenticatedUser(bob, { name: "Refused", slug: "refused" }),
      () => directory.ensurePersonalWorkspaceForUser(bob)
    ]) {
      await assert.rejects(create(), (error) => {
        assert.equal(error, refusal);
        assert.equal(error.transactionOutcome, "rolledBack");
        return true;
      });
    }
    assert.equal(await count("workspaces"), workspacesBefore);
    assert.equal(await count("workspaces", { owner_user_id: bob.id }), 0);
    assert.equal(await count("workspace_memberships", { user_id: bob.id }), 0);
    assert.equal(await count("workspace_settings"), settingsBefore);
    assert.equal((await profiles.findById(bob.id)).displayName, "bob");

    // A duplicate from the participant's own write is not a lost slug: the creation fails once and does not run again.
    refusal = null;
    duplicateWrite = true;
    const runs = seen.length;
    await assert.rejects(directory.createWorkspaceForAuthenticatedUser(bob, { name: "Copy", slug: "copy" }), (error) => {
      assert.ok(findDuplicateEntryError(error));
      assert.equal(error.transactionOutcome, "rolledBack");
      return true;
    });
    assert.equal(seen.length, runs + 1);
    assert.equal(await count("workspaces", { owner_user_id: bob.id }), 0);
  });

  test("a duplicate participant poisons its managed transaction even when its caller catches the failure", async () => {
    const owner = await createProfile("Ada");
    await workspaces.insert({ slug: "duplicate", name: "Original", ownerUserId: owner.id });
    let participantFailure;
    await assert.rejects(userSettings.withTransaction({}, async (txOptions) => {
      await profiles.updateDisplayNameById(owner.id, "Must roll back", txOptions);
      try {
        await workspaces.insert({ slug: "duplicate", name: "Replacement", ownerUserId: owner.id }, txOptions);
      } catch (error) {
        participantFailure = error;
      }
    }), (error) => {
      assert.equal(error.transactionOutcome, "rolledBack");
      return true;
    });
    assert.equal(participantFailure?.transactionOutcome, "pending");
    assert.ok(findDuplicateEntryError(participantFailure));
    assert.equal((await profiles.findById(owner.id)).displayName, "Ada");
    assert.equal(Number((await knex("workspaces").count({ count: "*" }).first()).count), 1);
  });

  test("profile email conflicts retain the real database cause after the standalone transaction rolls back", async () => {
    const owner = await createProfile("Ada");
    await assert.rejects(profiles.upsert({
      authProvider: "local", authProviderUserSid: "different-identity",
      email: owner.email, displayName: "Different person"
    }), (error) => {
      assert.equal(error.code, "USER_PROFILE_EMAIL_CONFLICT");
      assert.equal(error.transactionOutcome, "rolledBack");
      assert.ok(findDuplicateEntryError(error));
      return true;
    });
    assert.equal(Number((await knex("users").count({ count: "*" }).first()).count), 1);
    assert.equal((await profiles.findByEmail(owner.email)).id, owner.id);
  });
  test("invitation creation and acceptance transaction participation", async (t) => {
    await verifyInvitationTransactions(t, knex);
  });
});
