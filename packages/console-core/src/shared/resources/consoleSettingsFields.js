import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { resolveGlobalArrayRegistry } from "./resolveGlobalArrayRegistry.js";

const consoleSettingsFields = resolveGlobalArrayRegistry("jskit.console-core.consoleSettingsFields");

function defineField(field = {}) {
  const key = normalizeText(field.key);
  if (!key) {
    throw new TypeError("consoleSettingsFields.defineField requires field.key.");
  }
  if (consoleSettingsFields.some((entry) => entry.key === key)) {
    throw new Error(`consoleSettingsFields.defineField duplicate key: ${key}`);
  }
  if (!field.inputSchema || typeof field.inputSchema !== "object") {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires inputSchema.`);
  }
  if (!field.outputSchema || typeof field.outputSchema !== "object") {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires outputSchema.`);
  }
  const repositoryColumn = normalizeText(field?.repository?.column);
  if (!repositoryColumn) {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires repository.column.`);
  }
  if (typeof field.normalizeInput !== "function") {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires normalizeInput.`);
  }
  if (typeof field.normalizeOutput !== "function") {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires normalizeOutput.`);
  }
  if (typeof field.resolveDefault !== "function") {
    throw new TypeError(`consoleSettingsFields.defineField("${key}") requires resolveDefault.`);
  }

  consoleSettingsFields.push({
    key,
    repository: Object.freeze({
      column: repositoryColumn
    }),
    required: field.required !== false,
    inputSchema: field.inputSchema,
    outputSchema: field.outputSchema,
    normalizeInput: field.normalizeInput,
    normalizeOutput: field.normalizeOutput,
    resolveDefault: field.resolveDefault
  });
}

function resetConsoleSettingsFields() {
  consoleSettingsFields.splice(0, consoleSettingsFields.length);
}

export {
  defineField,
  resetConsoleSettingsFields,
  consoleSettingsFields
};
