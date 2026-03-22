const DEFAULT_WORKSPACE_COLOR = "#2F5D9E";
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const DEFAULT_USER_SETTINGS = Object.freeze({
  theme: "system",
  locale: "en",
  timeZone: "UTC",
  dateFormat: "yyyy-mm-dd",
  numberFormat: "1,234.56",
  currencyCode: "USD",
  avatarSize: 64,
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true,
  passwordSignInEnabled: true,
  passwordSetupRequired: false,
  lastActiveWorkspaceId: null
});

function normalizeWorkspaceHexColor(value) {
  const normalized = String(value || "").trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return "";
  }
  return normalized.toUpperCase();
}

function clampChannel(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return Math.round(value);
}

function toHexChannel(value) {
  return clampChannel(value).toString(16).padStart(2, "0").toUpperCase();
}

function parseHexColor(value) {
  const normalized = normalizeWorkspaceHexColor(value);
  if (!normalized) {
    return null;
  }
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function mixHexColors(baseColor, mixColor, mixRatio = 0) {
  const base = parseHexColor(baseColor);
  const mixed = parseHexColor(mixColor);
  if (!base || !mixed) {
    return "";
  }

  const ratio = Math.min(1, Math.max(0, Number(mixRatio) || 0));
  const keepRatio = 1 - ratio;
  return `#${toHexChannel(base.red * keepRatio + mixed.red * ratio)}${toHexChannel(
    base.green * keepRatio + mixed.green * ratio
  )}${toHexChannel(base.blue * keepRatio + mixed.blue * ratio)}`;
}

function coerceWorkspaceColor(value) {
  return normalizeWorkspaceHexColor(value) || DEFAULT_WORKSPACE_COLOR;
}

function deriveWorkspaceSecondaryColor(workspaceColor = DEFAULT_WORKSPACE_COLOR) {
  return mixHexColors(coerceWorkspaceColor(workspaceColor), "#000000", 0.28) || "#224372";
}

function deriveWorkspaceSurfaceColor(workspaceColor = DEFAULT_WORKSPACE_COLOR) {
  return mixHexColors(coerceWorkspaceColor(workspaceColor), "#FFFFFF", 0.93) || "#F0F4F8";
}

function deriveWorkspaceSurfaceVariantColor(workspaceColor = DEFAULT_WORKSPACE_COLOR) {
  return mixHexColors(coerceWorkspaceColor(workspaceColor), "#FFFFFF", 0.86) || "#E2E8F1";
}

function deriveWorkspaceBackgroundColor(workspaceColor = DEFAULT_WORKSPACE_COLOR) {
  const surfaceColor = deriveWorkspaceSurfaceColor(workspaceColor);
  return mixHexColors(surfaceColor, "#FFFFFF", 0.45) || "#F4FAF8";
}

function coerceWorkspaceSecondaryColor(value, { color = DEFAULT_WORKSPACE_COLOR } = {}) {
  return normalizeWorkspaceHexColor(value) || deriveWorkspaceSecondaryColor(color);
}

function coerceWorkspaceSurfaceColor(value, { color = DEFAULT_WORKSPACE_COLOR } = {}) {
  return normalizeWorkspaceHexColor(value) || deriveWorkspaceSurfaceColor(color);
}

function coerceWorkspaceSurfaceVariantColor(value, { color = DEFAULT_WORKSPACE_COLOR } = {}) {
  return normalizeWorkspaceHexColor(value) || deriveWorkspaceSurfaceVariantColor(color);
}

function coerceWorkspaceBackgroundColor(value, { color = DEFAULT_WORKSPACE_COLOR } = {}) {
  return normalizeWorkspaceHexColor(value) || deriveWorkspaceBackgroundColor(color);
}

function resolveWorkspaceThemePalette(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const color = coerceWorkspaceColor(source.color);
  const secondaryColor = coerceWorkspaceSecondaryColor(source.secondaryColor, {
    color
  });
  const surfaceColor = coerceWorkspaceSurfaceColor(source.surfaceColor, {
    color
  });
  const surfaceVariantColor = coerceWorkspaceSurfaceVariantColor(source.surfaceVariantColor, {
    color
  });
  const backgroundColor = coerceWorkspaceBackgroundColor(source.backgroundColor, {
    color
  });

  return Object.freeze({
    color,
    secondaryColor,
    surfaceColor,
    surfaceVariantColor,
    backgroundColor
  });
}

export {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceBackgroundColor,
  coerceWorkspaceColor,
  coerceWorkspaceSecondaryColor,
  coerceWorkspaceSurfaceColor,
  coerceWorkspaceSurfaceVariantColor,
  deriveWorkspaceBackgroundColor,
  deriveWorkspaceSecondaryColor,
  deriveWorkspaceSurfaceColor,
  deriveWorkspaceSurfaceVariantColor,
  mixHexColors,
  normalizeWorkspaceHexColor,
  resolveWorkspaceThemePalette
};
