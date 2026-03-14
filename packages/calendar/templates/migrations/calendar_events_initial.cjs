// JSKIT_MIGRATION_ID: calendar_events_initial
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveCrudTableName(namespace = "") {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!normalizedNamespace) {
    throw new Error("calendar_events requires CRUD module namespace.");
  }
  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
}

function resolveCalendarContactsTableNameFromConfig(appConfig = {}) {
  const source = appConfig && typeof appConfig === "object" && !Array.isArray(appConfig) ? appConfig : {};
  const modules = source.modules && typeof source.modules === "object" && !Array.isArray(source.modules)
    ? source.modules
    : {};
  const crudConfigs = [];

  for (const moduleConfig of Object.values(modules)) {
    const entry = moduleConfig && typeof moduleConfig === "object" && !Array.isArray(moduleConfig)
      ? moduleConfig
      : {};
    if (normalizeText(entry.module).toLowerCase() !== "crud") {
      continue;
    }
    if (!normalizeNamespace(entry.namespace)) {
      throw new Error("calendar_events requires config.modules CRUD entries with namespace.");
    }
    crudConfigs.push({
      namespace: normalizeNamespace(entry.namespace)
    });
  }

  if (crudConfigs.length < 1) {
    return "";
  }

  const explicitNamespace = normalizeNamespace(source?.calendar?.contactsNamespace);
  if (explicitNamespace) {
    const explicit = crudConfigs.find((entry) => entry.namespace === explicitNamespace);
    return explicit ? resolveCrudTableName(explicit.namespace) : "";
  }

  const firstCrud = [...crudConfigs].sort((left, right) => left.namespace.localeCompare(right.namespace))[0];
  return resolveCrudTableName(firstCrud.namespace);
}

async function loadAppConfig() {
  const publicConfigPath = path.resolve(process.cwd(), "config/public.js");
  try {
    const moduleNs = await import(pathToFileURL(publicConfigPath).href);
    const source = moduleNs && typeof moduleNs === "object" ? moduleNs.default ?? moduleNs : {};
    return source && typeof source === "object" && !Array.isArray(source) ? source : {};
  } catch {
    return {};
  }
}

async function resolveContactsTableName(knex) {
  const appConfig = await loadAppConfig();
  const configuredTableName = resolveCalendarContactsTableNameFromConfig(appConfig);
  if (configuredTableName) {
    const exists = await knex.schema.hasTable(configuredTableName);
    if (exists) {
      return configuredTableName;
    }
    throw new Error(
      `calendar_events requires CRUD table "${configuredTableName}" from config/public.js modules.`
    );
  }

  const fallbackCandidates = ["contacts"];
  for (const candidate of fallbackCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await knex.schema.hasTable(candidate);
    if (exists) {
      return candidate;
    }
  }

  throw new Error("calendar_events requires a CRUD table. Install @jskit-ai/crud first.");
}

exports.up = async function up(knex) {
  const contactsTableName = await resolveContactsTableName(knex);

  const hasCalendarEventsTable = await knex.schema.hasTable("calendar_events");
  if (hasCalendarEventsTable) {
    return;
  }

  await knex.schema.createTable("calendar_events", (table) => {
    table.increments("id").unsigned().primary();
    table.integer("workspace_owner_id").unsigned().nullable().index();
    table.integer("user_owner_id").unsigned().nullable().index();
    table.integer("contact_id").unsigned().notNullable().references("id").inTable(contactsTableName).onDelete("CASCADE");
    table.string("title", 200).notNullable();
    table.text("notes").notNullable().defaultTo("");
    table.timestamp("starts_at").notNullable().index();
    table.timestamp("ends_at").notNullable().index();
    table.string("status", 32).notNullable().defaultTo("scheduled");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["workspace_owner_id", "starts_at"], "idx_calendar_events_workspace_start");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("calendar_events");
};
