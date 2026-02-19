import { AppError } from "../../lib/errors.js";
import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function createController({ userSettingsService, authService, auditService }) {
  if (!userSettingsService || !authService || !auditService || typeof auditService.recordSafe !== "function") {
    throw new Error("userSettingsService, authService, and auditService.recordSafe are required.");
  }

  async function get(request, reply) {
    const response = await userSettingsService.getForUser(request, request.user);
    reply.code(200).send(response);
  }

  async function updateProfile(request, reply) {
    const payload = request.body || {};
    const result = await userSettingsService.updateProfile(request, request.user, payload);

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send(result.settings);
  }

  async function updatePreferences(request, reply) {
    const payload = request.body || {};
    const response = await userSettingsService.updatePreferences(request, request.user, payload);
    reply.code(200).send(response);
  }

  async function updateNotifications(request, reply) {
    const payload = request.body || {};
    const response = await userSettingsService.updateNotifications(request, request.user, payload);
    reply.code(200).send(response);
  }

  async function uploadAvatar(request, reply) {
    const filePart = await request.file();
    if (!filePart) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            avatar: "Avatar file is required."
          }
        }
      });
    }

    const uploadDimension = filePart.fields?.uploadDimension?.value;

    const response = await userSettingsService.uploadAvatar(request, request.user, {
      stream: filePart.file,
      mimeType: filePart.mimetype,
      fileName: filePart.filename,
      uploadDimension
    });
    reply.code(200).send(response);
  }

  async function deleteAvatar(request, reply) {
    const response = await userSettingsService.deleteAvatar(request, request.user);
    reply.code(200).send(response);
  }

  async function changePassword(request, reply) {
    const payload = request.body || {};
    const result = await userSettingsService.changePassword(request, payload);

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send({
      ok: true,
      message: result.message
    });
  }

  async function setPasswordMethodEnabled(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "auth.password_method.toggled",
      execute: () => userSettingsService.setPasswordMethodEnabled(request, request.user, payload),
      shared: () => ({
        targetUserId: parsePositiveInteger(request.user?.id),
      }),
      metadata: () => ({
        enabled: Boolean(payload.enabled)
      })
    });

    reply.code(200).send(response);
  }

  async function startOAuthProviderLink(request, reply) {
    const provider = request.params?.provider;
    const returnTo = request.query?.returnTo;
    const result = await userSettingsService.startOAuthProviderLink(request, request.user, {
      provider,
      returnTo
    });
    reply.redirect(result.url);
  }

  async function unlinkOAuthProvider(request, reply) {
    const provider = request.params?.provider;
    const response = await withAuditEvent({
      auditService,
      request,
      action: "auth.oauth_provider.unlinked",
      execute: () =>
        userSettingsService.unlinkOAuthProvider(request, request.user, {
          provider
        }),
      shared: () => ({
        targetUserId: parsePositiveInteger(request.user?.id),
      }),
      metadata: () => ({
        provider: normalizeText(provider).toLowerCase()
      })
    });

    reply.code(200).send(response);
  }

  async function logoutOtherSessions(request, reply) {
    const response = await userSettingsService.logoutOtherSessions(request);
    reply.code(200).send(response);
  }

  return {
    get,
    updateProfile,
    updatePreferences,
    updateNotifications,
    uploadAvatar,
    deleteAvatar,
    changePassword,
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions
  };
}

export { createController };
