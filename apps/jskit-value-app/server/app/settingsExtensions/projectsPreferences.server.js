import { db } from "../../../db/knex.js";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { toIsoString, toDatabaseDateTimeUtc } from "@jskit-ai/jskit-knex/dateUtils";
import { isDuplicateEntryError } from "@jskit-ai/jskit-knex/errors";

const PROJECT_SETTINGS_TABLE = "user_project_settings";
const PROJECT_VIEW_MODES = Object.freeze(["list", "board"]);
const PROJECT_STATUS_FILTERS = Object.freeze(["all", "active", "draft", "archived"]);
const DEFAULT_PAGE_SIZE_MIN = 5;
const DEFAULT_PAGE_SIZE_MAX = 100;

const PROJECTS_SETTINGS_EXTENSION_ID = "projects.preferences";

const PROJECTS_SETTINGS_FIELDS = Object.freeze([
  Object.freeze({
    id: "projects.defaultView",
    key: "defaultView",
    type: "enum",
    options: PROJECT_VIEW_MODES
  }),
  Object.freeze({
    id: "projects.defaultStatusFilter",
    key: "defaultStatusFilter",
    type: "enum",
    options: PROJECT_STATUS_FILTERS
  }),
  Object.freeze({
    id: "projects.defaultPageSize",
    key: "defaultPageSize",
    type: "integer",
    min: DEFAULT_PAGE_SIZE_MIN,
    max: DEFAULT_PAGE_SIZE_MAX
  }),
  Object.freeze({
    id: "projects.includeArchivedByDefault",
    key: "includeArchivedByDefault",
    type: "boolean"
  })
]);

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeUserId(userLike) {
  const userId = parsePositiveInteger(userLike?.id ?? userLike);
  if (!userId) {
    throw new AppError(401, "Authentication required.");
  }
  return userId;
}

function normalizeViewMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeStatusFilter(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function mapProjectsSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapProjectsSettingsRowRequired expected a row object.");
  }

  return {
    userId: Number(row.user_id),
    defaultView: normalizeViewMode(row.default_view) || PROJECT_VIEW_MODES[0],
    defaultStatusFilter: normalizeStatusFilter(row.default_status_filter) || PROJECT_STATUS_FILTERS[0],
    defaultPageSize: Number(row.default_page_size) || 20,
    includeArchivedByDefault: Boolean(row.include_archived_by_default),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapToPublicSettings(settings = {}) {
  return {
    defaultView: settings.defaultView || PROJECT_VIEW_MODES[0],
    defaultStatusFilter: settings.defaultStatusFilter || PROJECT_STATUS_FILTERS[0],
    defaultPageSize: Number(settings.defaultPageSize) || 20,
    includeArchivedByDefault: Boolean(settings.includeArchivedByDefault)
  };
}

function parseProjectsSettingsPatch(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const allowedKeys = new Set(["defaultView", "defaultStatusFilter", "defaultPageSize", "includeArchivedByDefault"]);
  const fieldErrors = {};
  const patch = {};

  const unknownKeys = Object.keys(source).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    fieldErrors.request = `Unsupported projects settings fields: ${unknownKeys.join(", ")}.`;
  }

  if (Object.hasOwn(source, "defaultView")) {
    const defaultView = normalizeViewMode(source.defaultView);
    if (!PROJECT_VIEW_MODES.includes(defaultView)) {
      fieldErrors.defaultView = `defaultView must be one of: ${PROJECT_VIEW_MODES.join(", ")}.`;
    } else {
      patch.defaultView = defaultView;
    }
  }

  if (Object.hasOwn(source, "defaultStatusFilter")) {
    const defaultStatusFilter = normalizeStatusFilter(source.defaultStatusFilter);
    if (!PROJECT_STATUS_FILTERS.includes(defaultStatusFilter)) {
      fieldErrors.defaultStatusFilter = `defaultStatusFilter must be one of: ${PROJECT_STATUS_FILTERS.join(", ")}.`;
    } else {
      patch.defaultStatusFilter = defaultStatusFilter;
    }
  }

  if (Object.hasOwn(source, "defaultPageSize")) {
    const defaultPageSize = Number(source.defaultPageSize);
    if (!Number.isInteger(defaultPageSize)) {
      fieldErrors.defaultPageSize = "defaultPageSize must be an integer.";
    } else if (defaultPageSize < DEFAULT_PAGE_SIZE_MIN || defaultPageSize > DEFAULT_PAGE_SIZE_MAX) {
      fieldErrors.defaultPageSize =
        `defaultPageSize must be between ${DEFAULT_PAGE_SIZE_MIN} and ${DEFAULT_PAGE_SIZE_MAX}.`;
    } else {
      patch.defaultPageSize = defaultPageSize;
    }
  }

  if (Object.hasOwn(source, "includeArchivedByDefault")) {
    if (typeof source.includeArchivedByDefault !== "boolean") {
      fieldErrors.includeArchivedByDefault = "includeArchivedByDefault must be boolean.";
    } else {
      patch.includeArchivedByDefault = source.includeArchivedByDefault;
    }
  }

  if (Object.keys(patch).length < 1 && Object.keys(fieldErrors).length < 1) {
    fieldErrors.request = "At least one projects setting must be provided.";
  }

  return {
    patch,
    fieldErrors
  };
}

async function ensureProjectsSettingsRow(userId, { trx = null } = {}) {
  const client = trx || db;

  try {
    await client(PROJECT_SETTINGS_TABLE).insert({ user_id: userId });
  } catch (error) {
    if (!isDuplicateEntryError(error)) {
      throw error;
    }
  }
}

async function readProjectsSettingsForUser(userLike, { trx = null } = {}) {
  const userId = normalizeUserId(userLike);
  const client = trx || db;
  await ensureProjectsSettingsRow(userId, { trx });

  const row = await client(PROJECT_SETTINGS_TABLE).where({ user_id: userId }).first();
  return mapProjectsSettingsRowRequired(row);
}

async function writeProjectsSettingsForUser(userLike, payload, { trx = null } = {}) {
  const userId = normalizeUserId(userLike);
  const client = trx || db;
  const parsed = parseProjectsSettingsPatch(payload);
  if (Object.keys(parsed.fieldErrors).length > 0) {
    throw validationError(parsed.fieldErrors);
  }

  await ensureProjectsSettingsRow(userId, { trx });

  const dbPatch = {
    updated_at: toDatabaseDateTimeUtc(new Date())
  };

  if (Object.hasOwn(parsed.patch, "defaultView")) {
    dbPatch.default_view = parsed.patch.defaultView;
  }
  if (Object.hasOwn(parsed.patch, "defaultStatusFilter")) {
    dbPatch.default_status_filter = parsed.patch.defaultStatusFilter;
  }
  if (Object.hasOwn(parsed.patch, "defaultPageSize")) {
    dbPatch.default_page_size = parsed.patch.defaultPageSize;
  }
  if (Object.hasOwn(parsed.patch, "includeArchivedByDefault")) {
    dbPatch.include_archived_by_default = parsed.patch.includeArchivedByDefault;
  }

  await client(PROJECT_SETTINGS_TABLE).where({ user_id: userId }).update(dbPatch);

  const row = await client(PROJECT_SETTINGS_TABLE).where({ user_id: userId }).first();
  return mapProjectsSettingsRowRequired(row);
}

function createProjectsSettingsExtension() {
  return Object.freeze({
    id: PROJECTS_SETTINGS_EXTENSION_ID,
    order: 20,
    fields: PROJECTS_SETTINGS_FIELDS,
    validators: Object.freeze([
      Object.freeze({
        id: "projects.preferences.input",
        validate({ payload }) {
          return parseProjectsSettingsPatch(payload).fieldErrors;
        }
      })
    ]),
    persistence: Object.freeze({
      async read({ user, trx = null }) {
        const settings = await readProjectsSettingsForUser(user, { trx });
        return mapToPublicSettings(settings);
      },
      async write({ user, payload, trx = null }) {
        const updatedSettings = await writeProjectsSettingsForUser(user, payload, { trx });
        return mapToPublicSettings(updatedSettings);
      }
    }),
    projection({ value }) {
      return mapToPublicSettings(value);
    }
  });
}

const __testables = {
  PROJECT_SETTINGS_TABLE,
  PROJECT_VIEW_MODES,
  PROJECT_STATUS_FILTERS,
  DEFAULT_PAGE_SIZE_MIN,
  DEFAULT_PAGE_SIZE_MAX,
  parseProjectsSettingsPatch,
  mapProjectsSettingsRowRequired,
  mapToPublicSettings
};

export { PROJECTS_SETTINGS_EXTENSION_ID, createProjectsSettingsExtension, __testables };
