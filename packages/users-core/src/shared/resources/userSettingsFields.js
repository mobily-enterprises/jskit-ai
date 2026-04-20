import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { resolveGlobalArrayRegistry } from "./resolveGlobalArrayRegistry.js";

const USER_SETTINGS_SECTIONS = Object.freeze({
  PREFERENCES: "preferences",
  NOTIFICATIONS: "notifications"
});

const USER_SETTINGS_SECTION_VALUES = Object.freeze(Object.values(USER_SETTINGS_SECTIONS));

const userSettingsFields = resolveGlobalArrayRegistry("jskit.users-core.userSettingsFields");

function defineField(field = {}) {
  const key = normalizeText(field.key);
  if (!key) {
    throw new TypeError("userSettingsFields.defineField requires field.key.");
  }
  if (userSettingsFields.some((entry) => entry.key === key)) {
    throw new Error(`userSettingsFields.defineField duplicate key: ${key}`);
  }
  if (!field.inputSchema || typeof field.inputSchema !== "object") {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires inputSchema.`);
  }
  if (!field.outputSchema || typeof field.outputSchema !== "object") {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires outputSchema.`);
  }
  const repository = field?.repository;
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires repository.column.`);
  }
  const repositoryColumn = normalizeText(repository.column);
  if (!repositoryColumn) {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires repository.column.`);
  }
  const section = normalizeLowerText(field.section);
  if (!USER_SETTINGS_SECTION_VALUES.includes(section)) {
    throw new TypeError(
      `userSettingsFields.defineField("${key}") requires section to be one of: ${USER_SETTINGS_SECTION_VALUES.join(", ")}.`
    );
  }
  if (typeof field.normalizeInput !== "function") {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires normalizeInput.`);
  }
  if (typeof field.normalizeOutput !== "function") {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires normalizeOutput.`);
  }
  if (typeof field.resolveDefault !== "function") {
    throw new TypeError(`userSettingsFields.defineField("${key}") requires resolveDefault.`);
  }

  userSettingsFields.push({
    key,
    section,
    repository: Object.freeze({
      column: repositoryColumn
    }),
    required: field.required !== false,
    includeInBootstrap: field.includeInBootstrap !== false,
    inputSchema: field.inputSchema,
    outputSchema: field.outputSchema,
    normalizeInput: field.normalizeInput,
    normalizeOutput: field.normalizeOutput,
    resolveDefault: field.resolveDefault
  });
}

function resetUserSettingsFields() {
  userSettingsFields.splice(0, userSettingsFields.length);
}

export {
  USER_SETTINGS_SECTIONS,
  defineField,
  resetUserSettingsFields,
  userSettingsFields
};
