const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function isWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  return WORKSPACE_COLOR_PATTERN.test(normalized);
}

function coerceWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (!isWorkspaceColor(normalized)) {
    return DEFAULT_WORKSPACE_COLOR;
  }

  return normalized.toUpperCase();
}

export { DEFAULT_WORKSPACE_COLOR, WORKSPACE_COLOR_PATTERN, isWorkspaceColor, coerceWorkspaceColor };
