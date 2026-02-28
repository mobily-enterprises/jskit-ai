import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";

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

function requireProjectsSettingsRepository(repository) {
  if (!repository || typeof repository.readProjectsSettingsForUserId !== "function") {
    throw new Error("projectsSettingsRepository.readProjectsSettingsForUserId is required.");
  }
  if (typeof repository.updateProjectsSettingsForUserId !== "function") {
    throw new Error("projectsSettingsRepository.updateProjectsSettingsForUserId is required.");
  }
}

function createProjectsSettingsExtension({ projectsSettingsRepository } = {}) {
  requireProjectsSettingsRepository(projectsSettingsRepository);
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
        const settings = await projectsSettingsRepository.readProjectsSettingsForUserId(
          normalizeUserId(user),
          { trx }
        );
        return mapToPublicSettings(settings);
      },
      async write({ user, payload, trx = null }) {
        const parsed = parseProjectsSettingsPatch(payload);
        if (Object.keys(parsed.fieldErrors).length > 0) {
          throw validationError(parsed.fieldErrors);
        }

        const updatedSettings = await projectsSettingsRepository.updateProjectsSettingsForUserId(
          normalizeUserId(user),
          parsed.patch,
          { trx }
        );
        return mapToPublicSettings(updatedSettings);
      }
    }),
    projection({ value }) {
      return mapToPublicSettings(value);
    }
  });
}

const __testables = {
  PROJECT_VIEW_MODES,
  PROJECT_STATUS_FILTERS,
  DEFAULT_PAGE_SIZE_MIN,
  DEFAULT_PAGE_SIZE_MAX,
  parseProjectsSettingsPatch,
  mapToPublicSettings
};

export { PROJECTS_SETTINGS_EXTENSION_ID, createProjectsSettingsExtension, __testables };
