import assert from "node:assert/strict";
import { before, beforeEach, after, describe, test } from "node:test";
import knexLib from "knex";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { findDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
import { createJsonRestApiHost } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import usersInitial from "../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../users-core/migrations/users_core_profile_updated_at.cjs";
import workspacesInitial from "../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../migrations/workspaces_core_workspaces_drop_color.cjs";
import { installWorkspaceResources } from "../src/server/WorkspacesFeature.js";
import { createRepository as createWorkspacesRepository } from "../src/server/common/repositories/workspacesRepository.js";
import { createRepository as createMembershipsRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createInvitesRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createSettingsRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";
import { renderDefaultWorkspaceInviteEmail } from "../src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";
import { unconfiguredWorkspaceInviteMailer } from "../src/server/workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { createWorkspaceInviteUrlBuilder } from "../src/server/workspaceMembers/workspaceInviteUrls.js";
import { createService as createMembersService } from "../src/server/workspaceMembers/workspaceMembersService.js";
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
  let api;
  let profiles;
  let userSettings;
  let workspaces;
  let memberships;
  let invites;
  let settings;
  let ownsTables = false;

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
    api = await createJsonRestApiHost({ knex, logger: { error() {}, warn() {}, info() {}, debug() {} } });
    const { identity } = await UsersIdentityProvider.setup({
      authExtensions: createAuthExtensions(),
      extensions: createUsersExtensions(),
      jsonRestApi: api
    });
    ({ userProfiles: profiles, userSettings } = identity.repositories);
    await installWorkspaceResources(api);
    workspaces = createWorkspacesRepository({ api });
    memberships = createMembershipsRepository({ api });
    invites = createInvitesRepository({ api });
    settings = createSettingsRepository({ api, defaultInvitesEnabled: false, defaultColorSettings: {} });
  });

  beforeEach(async () => {
    if (await knex.schema.hasTable("test_invitation_drafts")) {
      for (const table of ["test_invitation_audits", "test_invitation_scopes", "test_invitation_drafts"]) {
        await knex(table).delete();
      }
    }
    for (const table of TABLES) await knex(table).delete();
  });

  after(async () => {
    if (!knex) return;
    try {
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
  });

  const createMembers = () => createMembersService({
    workspaceMembershipsRepository: memberships,
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

    await profiles.withTransaction(async (trx) => {
      const joiner = await createProfile("Zara", { trx });
      await memberships.upsertMembership(workspace.id, joiner.id, { roleSid: "member", status: "active" }, { trx });
      const withJoiner = await memberships.listActiveByWorkspaceId(workspace.id, { trx });
      assert.equal(withJoiner.length, 1051);
      assert.equal(withJoiner.at(-1).displayName, "Zara");
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
    async function statementsOf(run) {
      let statements = 0;
      const onQuery = () => { statements += 1; };
      knex.on("query", onQuery);
      try {
        const result = await run();
        return { result, statements };
      } finally {
        knex.removeListener("query", onQuery);
      }
    }

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
    await profiles.withTransaction(async (trx) => {
      const member = await membersService.getMember(large, users.get("person-150"), { trx });
      assert.equal(member.userId, users.get("person-150"));
    });
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

  test("one managed transaction rolls back onboarding across all six repositories", async () => {
    await assert.rejects(profiles.withTransaction(async (trx) => {
      const options = { trx };
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

  test("a standalone duplicate workspace recovers after rollback without overwriting the existing row", {
    skip: !databaseUrl && "Application duplicate recovery supports native MySQL/Postgres drivers"
  }, async () => {
    const owner = await createProfile("Ada");
    const original = await workspaces.insert({ slug: "duplicate", name: "Original", ownerUserId: owner.id });
    const duplicate = await workspaces.insert({ slug: "duplicate", name: "Replacement", ownerUserId: owner.id });
    assert.equal(duplicate.id, original.id);
    assert.equal(duplicate.name, "Original");
    assert.equal(Number((await knex("workspaces").count({ count: "*" }).first()).count), 1);
  });

  test("a duplicate participant poisons its managed transaction even when its caller catches the failure", async () => {
    const owner = await createProfile("Ada");
    await workspaces.insert({ slug: "duplicate", name: "Original", ownerUserId: owner.id });
    let participantFailure;
    await assert.rejects(userSettings.withTransaction(async (trx) => {
      await profiles.updateDisplayNameById(owner.id, "Must roll back", { trx });
      try {
        await workspaces.insert({ slug: "duplicate", name: "Replacement", ownerUserId: owner.id }, { trx });
      } catch (error) {
        participantFailure = error;
      }
    }), (error) => {
      assert.equal(error.transactionOutcome, "rolledBack");
      return true;
    });
    assert.equal(participantFailure?.transactionOutcome, "pending");
    if (databaseUrl) assert.ok(findDuplicateEntryError(participantFailure));
    else assert.equal(participantFailure.cause.code, "SQLITE_CONSTRAINT_UNIQUE");
    assert.equal((await profiles.findById(owner.id)).displayName, "Ada");
    assert.equal(Number((await knex("workspaces").count({ count: "*" }).first()).count), 1);
  });

  test("profile email conflicts retain the real database cause after the standalone transaction rolls back", {
    skip: !databaseUrl && "Application duplicate recovery supports native MySQL/Postgres drivers"
  }, async () => {
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
