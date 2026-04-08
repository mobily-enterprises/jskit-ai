const WORKSPACE_THEME_MODE_LIGHT = "light";
const WORKSPACE_THEME_MODE_DARK = "dark";
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const DEFAULT_WORKSPACE_LIGHT_PALETTE = Object.freeze({
  color: "#1867C0",
  secondaryColor: "#48A9A6",
  surfaceColor: "#FFFFFF",
  surfaceVariantColor: "#424242"
});

const DEFAULT_WORKSPACE_DARK_PALETTE = Object.freeze({
  color: "#2196F3",
  secondaryColor: "#54B6B2",
  surfaceColor: "#212121",
  surfaceVariantColor: "#C8C8C8"
});

const DEFAULT_WORKSPACE_COLOR = DEFAULT_WORKSPACE_LIGHT_PALETTE.color;

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
  passwordSetupRequired: false
});

function normalizeWorkspaceHexColor(value) {
  const normalized = String(value || "").trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return "";
  }
  return normalized.toUpperCase();
}

function coerceWorkspaceColor(value) {
  return normalizeWorkspaceHexColor(value) || DEFAULT_WORKSPACE_COLOR;
}

function normalizeWorkspaceThemeMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === WORKSPACE_THEME_MODE_DARK) {
    return WORKSPACE_THEME_MODE_DARK;
  }
  return WORKSPACE_THEME_MODE_LIGHT;
}

function resolveWorkspaceThemeDefaultPalette(mode = WORKSPACE_THEME_MODE_LIGHT) {
  const normalizedMode = normalizeWorkspaceThemeMode(mode);
  return normalizedMode === WORKSPACE_THEME_MODE_DARK
    ? DEFAULT_WORKSPACE_DARK_PALETTE
    : DEFAULT_WORKSPACE_LIGHT_PALETTE;
}

function coerceWorkspaceThemeColor(value, fallbackColor = DEFAULT_WORKSPACE_COLOR) {
  return normalizeWorkspaceHexColor(value) || normalizeWorkspaceHexColor(fallbackColor) || DEFAULT_WORKSPACE_COLOR;
}

function coerceWorkspaceSecondaryColor(value, { mode = WORKSPACE_THEME_MODE_LIGHT } = {}) {
  return coerceWorkspaceThemeColor(value, resolveWorkspaceThemeDefaultPalette(mode).secondaryColor);
}

function coerceWorkspaceSurfaceColor(value, { mode = WORKSPACE_THEME_MODE_LIGHT } = {}) {
  return coerceWorkspaceThemeColor(value, resolveWorkspaceThemeDefaultPalette(mode).surfaceColor);
}

function coerceWorkspaceSurfaceVariantColor(value, { mode = WORKSPACE_THEME_MODE_LIGHT } = {}) {
  return coerceWorkspaceThemeColor(value, resolveWorkspaceThemeDefaultPalette(mode).surfaceVariantColor);
}

function resolveWorkspaceThemePalette(input = {}, { mode = WORKSPACE_THEME_MODE_LIGHT } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const normalizedMode = normalizeWorkspaceThemeMode(mode);
  const paletteDefaults = resolveWorkspaceThemeDefaultPalette(normalizedMode);

  if (normalizedMode === WORKSPACE_THEME_MODE_DARK) {
    return Object.freeze({
      color: coerceWorkspaceThemeColor(source.darkPrimaryColor, paletteDefaults.color),
      secondaryColor: coerceWorkspaceThemeColor(source.darkSecondaryColor, paletteDefaults.secondaryColor),
      surfaceColor: coerceWorkspaceThemeColor(source.darkSurfaceColor, paletteDefaults.surfaceColor),
      surfaceVariantColor: coerceWorkspaceThemeColor(
        source.darkSurfaceVariantColor,
        paletteDefaults.surfaceVariantColor
      )
    });
  }

  return Object.freeze({
    color: coerceWorkspaceThemeColor(source.lightPrimaryColor, paletteDefaults.color),
    secondaryColor: coerceWorkspaceThemeColor(source.lightSecondaryColor, paletteDefaults.secondaryColor),
    surfaceColor: coerceWorkspaceThemeColor(source.lightSurfaceColor, paletteDefaults.surfaceColor),
    surfaceVariantColor: coerceWorkspaceThemeColor(
      source.lightSurfaceVariantColor,
      paletteDefaults.surfaceVariantColor
    )
  });
}

function resolveWorkspaceThemePalettes(input = {}) {
  return Object.freeze({
    light: resolveWorkspaceThemePalette(input, {
      mode: WORKSPACE_THEME_MODE_LIGHT
    }),
    dark: resolveWorkspaceThemePalette(input, {
      mode: WORKSPACE_THEME_MODE_DARK
    })
  });
}

export {
  DEFAULT_WORKSPACE_DARK_PALETTE,
  DEFAULT_WORKSPACE_LIGHT_PALETTE,
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceColor,
  coerceWorkspaceThemeColor,
  coerceWorkspaceSecondaryColor,
  coerceWorkspaceSurfaceColor,
  coerceWorkspaceSurfaceVariantColor,
  normalizeWorkspaceHexColor,
  normalizeWorkspaceThemeMode,
  resolveWorkspaceThemeDefaultPalette,
  resolveWorkspaceThemePalettes,
  WORKSPACE_THEME_MODE_DARK,
  WORKSPACE_THEME_MODE_LIGHT,
  resolveWorkspaceThemePalette
};
