const DEFAULT_WORKSPACE_COLOR = "#0F6B54";

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
  lastActiveWorkspaceId: null,
  chatSettings: {
    publicChatId: null,
    allowWorkspaceDms: true,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: true,
    discoverableByPublicChatId: false
  }
});

function coerceWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  return DEFAULT_WORKSPACE_COLOR;
}

export {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceColor
};
