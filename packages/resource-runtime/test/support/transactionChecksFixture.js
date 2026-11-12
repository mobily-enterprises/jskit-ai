import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A workspace's forms and modules, each published from a draft version, every row naming the users who wrote it: the
// writes one transaction makes when it installs a module. Users are one table every workspace shares, which a row
// policy narrows to the members of the caller's workspace; a form may start from a user's own private draft; everything
// else is the workspace's own.

const WORKSPACE_ONE = Object.freeze({ workspace: Object.freeze({ id: "1" }), actor: Object.freeze({ id: "7" }) });
const WORKSPACE_TWO = Object.freeze({ workspace: Object.freeze({ id: "2" }), actor: Object.freeze({ id: "9" }) });
// Users 7 and 8 in workspace 1, each signed in, so each reads their own drafts only.
const signedIn = (userId) => Object.freeze({
  workspace: Object.freeze({ id: "1" }),
  actor: Object.freeze({ id: userId }),
  visibilityContext: Object.freeze({ userId })
});
const USER_SEVEN = signedIn("7");
const USER_EIGHT = signedIn("8");
// Users 7 and 8 are members of workspace 1; user 9 only of workspace 2.
const USERS = Object.freeze([
  Object.freeze({ id: 7, name: "Ada", workspaces: [1] }),
  Object.freeze({ id: 8, name: "Grace", workspaces: [1] }),
  Object.freeze({ id: 9, name: "Edsger", workspaces: [2] })
]);

const workspaceId = { type: "id", nullable: true, storage: { column: "workspace_id" } };
const userLink = (as, column, extra = {}) => ({ type: "id", belongsTo: "users", as, storage: { column }, ...extra });

const userResource = defineTableResource({
  name: "users",
  tableName: "users",
  ownership: "public",
  schema: { name: { type: "string", required: true } }
});
const membershipResource = defineTableResource({
  name: "memberships",
  tableName: "memberships",
  ownership: "workspace",
  schema: { workspaceId, userId: { type: "id", required: true, storage: { column: "user_id" } } },
  foreignKeys: [{ columns: ["userId"], referencedTableName: "users" }]
});
const draftResource = defineTableResource({
  name: "drafts",
  tableName: "drafts",
  ownership: "user",
  schema: { userId: { type: "id", storage: { column: "user_id" } }, title: { type: "string", required: true } },
  foreignKeys: [{ columns: ["userId"], referencedTableName: "users" }]
});
const formResource = defineTableResource({
  name: "forms",
  tableName: "forms",
  ownership: "workspace",
  schema: {
    workspaceId,
    name: { type: "string", required: true },
    createdBy: userLink("creator", "created_by", { required: true }),
    draftId: { type: "id", nullable: true, belongsTo: "drafts", as: "draft", storage: { column: "draft_id" } },
    currentVersionId: { type: "id", nullable: true, belongsTo: "formVersions", as: "currentVersion", storage: { column: "current_version_id" } }
  },
  foreignKeys: [
    { columns: ["createdBy"], referencedTableName: "users" },
    { columns: ["draftId"], referencedTableName: "drafts" },
    { columns: ["currentVersionId"], referencedTableName: "form_versions" }
  ]
});
const formVersionResource = defineTableResource({
  name: "formVersions",
  tableName: "form_versions",
  ownership: "workspace",
  schema: {
    workspaceId,
    formId: { type: "id", required: true, belongsTo: "forms", as: "form", storage: { column: "form_id" } },
    status: { type: "string", required: true },
    createdBy: userLink("creator", "created_by", { required: true }),
    publishedBy: userLink("publisher", "published_by", { nullable: true })
  },
  foreignKeys: [
    { columns: ["formId"], referencedTableName: "forms" },
    { columns: ["createdBy"], referencedTableName: "users" },
    { columns: ["publishedBy"], referencedTableName: "users" }
  ]
});
const moduleResource = defineTableResource({
  name: "modules",
  tableName: "modules",
  ownership: "workspace",
  schema: {
    workspaceId,
    name: { type: "string", required: true },
    formId: { type: "id", required: true, belongsTo: "forms", as: "form", storage: { column: "form_id" } },
    createdBy: userLink("creator", "created_by", { required: true }),
    currentVersionId: { type: "id", nullable: true, belongsTo: "moduleVersions", as: "currentVersion", storage: { column: "current_version_id" } }
  },
  foreignKeys: [
    { columns: ["formId"], referencedTableName: "forms" },
    { columns: ["createdBy"], referencedTableName: "users" },
    { columns: ["currentVersionId"], referencedTableName: "module_versions" }
  ]
});
const moduleVersionResource = defineTableResource({
  name: "moduleVersions",
  tableName: "module_versions",
  ownership: "workspace",
  schema: {
    workspaceId,
    moduleId: { type: "id", required: true, belongsTo: "modules", as: "module", storage: { column: "module_id" } },
    formVersionId: { type: "id", required: true, belongsTo: "formVersions", as: "formVersion", storage: { column: "form_version_id" } },
    status: { type: "string", required: true },
    createdBy: userLink("creator", "created_by", { required: true }),
    publishedBy: userLink("publisher", "published_by", { nullable: true })
  },
  foreignKeys: [
    { columns: ["moduleId"], referencedTableName: "modules" },
    { columns: ["formVersionId"], referencedTableName: "form_versions" },
    { columns: ["createdBy"], referencedTableName: "users" },
    { columns: ["publishedBy"], referencedTableName: "users" }
  ]
});

// A request sees the users who are members of its workspace; background work sees every user.
function workspaceMembers({ query, column, caller, context, ownTable }) {
  if (caller.kind === "system") {
    return true;
  }
  const workspace = context.workspace?.id ?? context.scopeValues?.workspaceId;
  if (!workspace) {
    return false;
  }
  query.whereIn(column("id"), ownTable("memberships").select("user_id").where("workspace_id", workspace));
  return true;
}

// Integer keys that reference another table's increments() id, which MySQL and MariaDB make unsigned.
const reference = (table, column, target, { nullable = false } = {}) => {
  const definition = table.integer(column).unsigned();
  (nullable ? definition.nullable() : definition.notNullable()).references("id").inTable(target);
};

async function createTables(knex) {
  await knex.schema.createTable("users", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("memberships", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    reference(table, "user_id", "users");
  });
  await knex.schema.createTable("drafts", (table) => {
    table.increments("id");
    reference(table, "user_id", "users");
    table.string("title").notNullable();
  });
  await knex.schema.createTable("forms", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("name").notNullable();
    reference(table, "created_by", "users");
    reference(table, "draft_id", "drafts", { nullable: true });
    table.integer("current_version_id").unsigned().nullable();
  });
  await knex.schema.createTable("form_versions", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    reference(table, "form_id", "forms");
    table.string("status").notNullable();
    reference(table, "created_by", "users");
    reference(table, "published_by", "users", { nullable: true });
  });
  await knex.schema.alterTable("forms", (table) => {
    table.foreign("current_version_id").references("id").inTable("form_versions");
  });
  await knex.schema.createTable("modules", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("name").notNullable();
    reference(table, "form_id", "forms");
    reference(table, "created_by", "users");
    table.integer("current_version_id").unsigned().nullable();
  });
  await knex.schema.createTable("module_versions", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    reference(table, "module_id", "modules");
    reference(table, "form_version_id", "form_versions");
    table.string("status").notNullable();
    reference(table, "created_by", "users");
    reference(table, "published_by", "users", { nullable: true });
  });
  await knex.schema.alterTable("modules", (table) => {
    table.foreign("current_version_id").references("id").inTable("module_versions");
  });
  await knex("users").insert(USERS.map(({ id, name }) => ({ id, name })));
  await knex("memberships").insert(USERS.flatMap(({ id, workspaces }) => workspaces.map((workspace) => ({ workspace_id: workspace, user_id: id }))));
  // PostgreSQL's sequence does not follow ids inserted by hand.
  if (String(knex.client.config.client).includes("pg")) {
    await knex.raw("SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users))");
  }
}

/**
 * The tables, their users and memberships, and the handles of one feature that owns them all.
 * @param {import("knex").Knex} knex
 */
async function moduleFixture(knex) {
  await createTables(knex);
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("modules.feature", [
    { resource: userResource, rowPolicy: workspaceMembers },
    membershipResource,
    draftResource,
    formResource,
    formVersionResource,
    moduleResource,
    moduleVersionResource
  ]);
  const systemContext = runtime.declareSystemScope("modules.feature", "The fixture checks every workspace's rows.");
  return { knex, handles, system: systemContext("check the fixture's rows") };
}

/**
 * Installs one module in the caller's transaction, as a setup service does: a form with a draft version it publishes,
 * then a module on that form with a draft version it publishes. Every row names the users who wrote it. Answers the
 * ids it wrote.
 * @param {Record<string, any>} handles
 * @param {{ context: object, trx: object }} tx
 * @param {{ name: string, author: string, publisher: string }} module
 */
async function installModule(handles, tx, { name, author, publisher }) {
  const { forms, formVersions, modules, moduleVersions } = handles;
  const form = await forms.create({ name: `${name} form`, createdBy: author }, tx);
  const formVersion = await formVersions.create({ formId: form.id, status: "draft", createdBy: author }, tx);
  await formVersions.patch(formVersion.id, { status: "published", publishedBy: publisher }, tx);
  await forms.patch(form.id, { currentVersionId: formVersion.id }, tx);
  await forms.get(form.id, {}, tx);
  const module = await modules.create({ name, formId: form.id, createdBy: author }, tx);
  const moduleVersion = await moduleVersions.create({ moduleId: module.id, formVersionId: formVersion.id, status: "draft", createdBy: author }, tx);
  await moduleVersions.patch(moduleVersion.id, { status: "published", publishedBy: publisher }, tx);
  await modules.patch(module.id, { currentVersionId: moduleVersion.id }, tx);
  return Object.freeze({ formId: form.id, formVersionId: formVersion.id, moduleId: module.id, moduleVersionId: moduleVersion.id });
}

export { USERS, USER_EIGHT, USER_SEVEN, WORKSPACE_ONE, WORKSPACE_TWO, installModule, moduleFixture };
