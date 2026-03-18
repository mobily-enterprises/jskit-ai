import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

const workspaceSettingsFields = [];

function defineField(field = {}) {
  const key = normalizeText(field.key);
  if (!key) {
    throw new TypeError("workspaceSettingsFields.defineField requires field.key.");
  }
  if (workspaceSettingsFields.some((entry) => entry.key === key)) {
    throw new Error(`workspaceSettingsFields.defineField duplicate key: ${key}`);
  }
  if (!field.inputSchema || typeof field.inputSchema !== "object") {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires inputSchema.`);
  }
  if (!field.outputSchema || typeof field.outputSchema !== "object") {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires outputSchema.`);
  }
  const dbColumn = normalizeText(field.dbColumn);
  if (!dbColumn) {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires dbColumn.`);
  }
  if (typeof field.normalizeInput !== "function") {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires normalizeInput.`);
  }
  if (typeof field.normalizeOutput !== "function") {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires normalizeOutput.`);
  }
  if (typeof field.resolveDefault !== "function") {
    throw new TypeError(`workspaceSettingsFields.defineField("${key}") requires resolveDefault.`);
  }

  workspaceSettingsFields.push({
    key,
    dbColumn,
    required: field.required !== false,
    inputSchema: field.inputSchema,
    outputSchema: field.outputSchema,
    normalizeInput: field.normalizeInput,
    normalizeOutput: field.normalizeOutput,
    resolveDefault: field.resolveDefault
  });
}

function resetWorkspaceSettingsFields() {
  workspaceSettingsFields.splice(0, workspaceSettingsFields.length);
}

export {
  defineField,
  resetWorkspaceSettingsFields,
  workspaceSettingsFields
};
