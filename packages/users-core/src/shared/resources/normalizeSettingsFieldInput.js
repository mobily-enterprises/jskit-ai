import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";

function normalizeSettingsFieldInput(payload = {}, fields = []) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  for (const field of fields) {
    if (!Object.hasOwn(source, field.key)) {
      continue;
    }
    normalized[field.key] = field.normalizeInput(source[field.key], {
      payload: source
    });
  }

  return normalized;
}

export { normalizeSettingsFieldInput };
