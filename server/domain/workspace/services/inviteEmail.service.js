import { normalizeEmail } from "../../../../shared/auth/utils.js";
import { createSurfacePaths } from "../../../../shared/routing/surfacePaths.js";

const SUPPORTED_DRIVERS = new Set(["none", "smtp"]);

function normalizeDriver(value) {
  const normalized = String(value || "none")
    .trim()
    .toLowerCase();

  if (!SUPPORTED_DRIVERS.has(normalized)) {
    throw new Error(`Unsupported WORKSPACE_INVITE_EMAIL_DRIVER "${normalized}". Supported: none, smtp.`);
  }

  return normalized;
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeSmtpConfig(options = {}) {
  return {
    host: String(options.smtpHost || "").trim(),
    port: Number(options.smtpPort) || 0,
    secure: options.smtpSecure === true,
    username: String(options.smtpUsername || "").trim(),
    password: String(options.smtpPassword || "").trim(),
    from: normalizeEmail(options.smtpFrom)
  };
}

function hasSmtpTransportConfig(smtpConfig) {
  return Boolean(
    smtpConfig.host &&
      smtpConfig.port > 0 &&
      smtpConfig.username &&
      smtpConfig.password &&
      smtpConfig.from
  );
}

function buildWorkspaceInvitesUrl(appPublicUrl) {
  const baseUrl = normalizeBaseUrl(appPublicUrl);
  if (!baseUrl) {
    return "";
  }

  const workspacesPath = createSurfacePaths("app").workspacesPath;
  return new URL(workspacesPath, baseUrl).toString();
}

function buildWorkspaceInviteMessage(payload = {}, { appPublicUrl } = {}) {
  const workspaceName = String(payload.workspace?.name || "").trim() || "a workspace";
  const roleId = String(payload.roleId || "member").trim() || "member";
  const invitedByDisplayName = String(payload.invitedBy?.displayName || "").trim() || "A workspace admin";
  const invitesUrl = buildWorkspaceInvitesUrl(appPublicUrl);
  const subject = `Workspace invitation: ${workspaceName}`;

  const lines = [
    `You were invited to join ${workspaceName}.`,
    `Role: ${roleId}`,
    `Invited by: ${invitedByDisplayName}`,
    "Sign in to review and accept the invitation."
  ];

  if (invitesUrl) {
    lines.push(invitesUrl);
  }

  return {
    subject,
    text: lines.join("\n")
  };
}

function createService(options = {}) {
  const driver = normalizeDriver(options.driver);
  const appPublicUrl = normalizeBaseUrl(options.appPublicUrl);
  const smtpConfig = normalizeSmtpConfig(options);

  async function sendWorkspaceInviteEmail(payload = {}) {
    const recipientEmail = normalizeEmail(payload.email);
    if (!recipientEmail) {
      return {
        delivered: false,
        reason: "invalid_recipient"
      };
    }

    if (driver === "none") {
      return {
        delivered: false,
        reason: "not_configured"
      };
    }

    if (!hasSmtpTransportConfig(smtpConfig)) {
      return {
        delivered: false,
        reason: "not_configured"
      };
    }

    return {
      delivered: false,
      reason: "not_implemented",
      driver,
      message: buildWorkspaceInviteMessage(payload, { appPublicUrl })
    };
  }

  return {
    driver,
    sendWorkspaceInviteEmail
  };
}

const __testables = {
  SUPPORTED_DRIVERS,
  normalizeDriver,
  normalizeBaseUrl,
  normalizeSmtpConfig,
  hasSmtpTransportConfig,
  buildWorkspaceInvitesUrl,
  buildWorkspaceInviteMessage
};

export { createService, __testables };
