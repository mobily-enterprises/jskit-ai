import { normalizeEmail } from "@jskit-ai/access-core/utils";
import { normalizeMetadata } from "@jskit-ai/communications-provider-core";

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

function createDefaultSurfacePaths(surfaceId) {
  return {
    surface: String(surfaceId || "app")
      .trim()
      .toLowerCase(),
    workspacesPath: "/workspaces"
  };
}

function buildWorkspaceInvitesUrl(appPublicUrl, options = {}) {
  const baseUrl = normalizeBaseUrl(appPublicUrl);
  if (!baseUrl) {
    return "";
  }

  const createSurfacePaths =
    typeof options.createSurfacePaths === "function" ? options.createSurfacePaths : createDefaultSurfacePaths;
  const workspacesPath = String(createSurfacePaths("app")?.workspacesPath || "/workspaces").trim() || "/workspaces";

  return new URL(workspacesPath, baseUrl).toString();
}

function buildWorkspaceInviteMessage(payload = {}, { appPublicUrl, createSurfacePaths } = {}) {
  const workspaceName = String(payload.workspace?.name || "").trim() || "a workspace";
  const roleId = String(payload.roleId || "member").trim() || "member";
  const invitedByDisplayName = String(payload.invitedBy?.displayName || "").trim() || "A workspace admin";
  const invitesUrl = buildWorkspaceInvitesUrl(appPublicUrl, {
    createSurfacePaths
  });
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

function resolveSendEmail(options = {}) {
  if (typeof options.sendEmail === "function") {
    return options.sendEmail;
  }

  if (options.communicationsService && typeof options.communicationsService.sendEmail === "function") {
    return options.communicationsService.sendEmail.bind(options.communicationsService);
  }

  return null;
}

function normalizeReason(value, fallback = "provider_error") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function normalizeResultProvider(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeResultMessageId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function createService(options = {}) {
  const appPublicUrl = normalizeBaseUrl(options.appPublicUrl);
  const sendEmail = resolveSendEmail(options);
  const createSurfacePaths =
    typeof options.createSurfacePaths === "function" ? options.createSurfacePaths : createDefaultSurfacePaths;

  async function sendWorkspaceInviteEmail(payload = {}) {
    const recipientEmail = normalizeEmail(payload.email);
    if (!recipientEmail) {
      return {
        delivered: false,
        reason: "invalid_recipient"
      };
    }

    const message = buildWorkspaceInviteMessage(payload, {
      appPublicUrl,
      createSurfacePaths
    });

    if (!sendEmail) {
      return {
        delivered: false,
        reason: "not_configured",
        provider: null,
        messageId: null,
        message
      };
    }

    let result = null;
    try {
      result = await sendEmail({
        to: recipientEmail,
        subject: message.subject,
        text: message.text,
        metadata: normalizeMetadata(payload.metadata)
      });
    } catch {
      return {
        delivered: false,
        reason: "provider_error",
        provider: null,
        messageId: null,
        message
      };
    }

    const delivered = result?.sent === true;
    return {
      delivered,
      reason: delivered ? "sent" : normalizeReason(result?.reason),
      provider: normalizeResultProvider(result?.provider),
      messageId: normalizeResultMessageId(result?.messageId),
      message
    };
  }

  return {
    sendWorkspaceInviteEmail
  };
}

const __testables = {
  normalizeBaseUrl,
  buildWorkspaceInvitesUrl,
  buildWorkspaceInviteMessage,
  normalizeMetadata,
  resolveSendEmail,
  normalizeReason,
  normalizeResultProvider,
  normalizeResultMessageId
};

export { createService, __testables };
