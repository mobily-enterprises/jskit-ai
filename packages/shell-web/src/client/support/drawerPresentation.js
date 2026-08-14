const DESKTOP_DRAWER_CLOSED_MODES = Object.freeze(["rail", "hidden"]);

function normalizeDesktopDrawerClosedMode(value = "rail") {
  const normalized = String(value || "rail").trim().toLowerCase();
  return DESKTOP_DRAWER_CLOSED_MODES.includes(normalized) ? normalized : "rail";
}

function resolveShellDrawerPresentation({
  compact = false,
  open = false,
  desktopClosedMode = "rail"
} = {}) {
  const closedMode = normalizeDesktopDrawerClosedMode(desktopClosedMode);
  if (compact) {
    return Object.freeze({
      visible: Boolean(open),
      rail: false,
      kind: "modal",
      closedMode
    });
  }
  if (open) {
    return Object.freeze({
      visible: true,
      rail: false,
      kind: "drawer",
      closedMode
    });
  }
  if (closedMode === "hidden") {
    return Object.freeze({
      visible: false,
      rail: false,
      kind: "hidden",
      closedMode
    });
  }
  return Object.freeze({
    visible: true,
    rail: true,
    kind: "rail",
    closedMode
  });
}

function resolveShellDrawerToggleLabel({ compact = false, open = false } = {}) {
  if (compact) {
    return open ? "Close navigation menu" : "Open navigation menu";
  }
  return open ? "Collapse navigation drawer" : "Expand navigation drawer";
}

export {
  DESKTOP_DRAWER_CLOSED_MODES,
  normalizeDesktopDrawerClosedMode,
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel
};
