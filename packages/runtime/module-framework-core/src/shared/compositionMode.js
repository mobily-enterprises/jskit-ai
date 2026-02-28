import { MODULE_ENABLEMENT_MODES } from "./descriptor.js";

function normalizeMode(mode) {
  const normalized = String(mode || MODULE_ENABLEMENT_MODES.strict).trim().toLowerCase();
  if (normalized !== MODULE_ENABLEMENT_MODES.strict && normalized !== MODULE_ENABLEMENT_MODES.permissive) {
    throw new TypeError(`Unsupported composition mode "${normalized}".`);
  }
  return normalized;
}

function addDiagnosticForMode(diagnostics, mode, input) {
  diagnostics.add({
    ...input,
    level: mode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn"
  });
}

export { normalizeMode, addDiagnosticForMode };
