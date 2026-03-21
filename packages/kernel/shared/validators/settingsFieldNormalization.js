import { normalizeObjectInput } from "./inputNormalization.js";

function normalizeSettingsFieldInput(payload = {}, fields = []) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  for (const field of Array.isArray(fields) ? fields : []) {
    if (!Object.hasOwn(source, field.key)) {
      continue;
    }
    normalized[field.key] = field.normalizeInput(source[field.key], {
      payload: source
    });
  }

  return normalized;
}

function normalizeSettingsFieldOutput(payload = {}, fields = []) {
  const settingsSource = normalizeObjectInput(payload);
  const normalized = {};

  for (const field of Array.isArray(fields) ? fields : []) {
    const rawValue = Object.hasOwn(settingsSource, field.key)
      ? settingsSource[field.key]
      : field.resolveDefault({
          settings: settingsSource
        });
    normalized[field.key] = field.normalizeOutput(rawValue, {
      settings: settingsSource
    });
  }

  return normalized;
}

export {
  normalizeSettingsFieldInput,
  normalizeSettingsFieldOutput
};
