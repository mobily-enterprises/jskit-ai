const TENANCY_MODE_NONE = "none";
const TENANCY_MODE_PERSONAL = "personal";
const TENANCY_MODE_WORKSPACES = "workspaces";

const TENANCY_MODES = Object.freeze([
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES
]);

function normalizeTenancyMode(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!TENANCY_MODES.includes(normalized)) {
    return TENANCY_MODE_NONE;
  }
  return normalized;
}

function isTenancyMode(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return TENANCY_MODES.includes(normalized);
}

export {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  TENANCY_MODES,
  normalizeTenancyMode,
  isTenancyMode
};
