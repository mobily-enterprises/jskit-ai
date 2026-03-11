import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

function parseChangePassword(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const currentPassword = normalizeText(source.currentPassword);
  const newPassword = normalizeText(source.newPassword);
  const confirmPassword = normalizeText(source.confirmPassword);
  const fieldErrors = {};

  if (!newPassword || newPassword.length < 8) {
    fieldErrors.newPassword = "Password must be at least 8 characters.";
  }

  if (!confirmPassword || confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = "Password confirmation does not match.";
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    fieldErrors
  };
}

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("accountSecurityService requires repositories.");
  }

  async function changePassword(request, user, payload = {}) {
    if (!authService || typeof authService.changePassword !== "function") {
      throw new AppError(501, "Password change is not available.");
    }

    const parsed = parseChangePassword(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw createValidationError(parsed.fieldErrors);
    }

    return authService.changePassword(request, {
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
      confirmPassword: parsed.confirmPassword
    });
  }

  async function setPasswordMethodEnabled(request, user, payload = {}) {
    if (!authService || typeof authService.setPasswordSignInEnabled !== "function") {
      throw new AppError(501, "Password method toggle is not available.");
    }

    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const enabled = payload.enabled === true;
    const response = await authService.setPasswordSignInEnabled(request, { enabled });
    await userSettingsRepository.updatePasswordSignInEnabled(profile.id, enabled);
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return {
      ...(response && typeof response === "object" ? response : {}),
      settings: accountSettingsResponseFormatter({
        profile,
        settings,
        securityStatus,
        authService
      })
    };
  }

  async function startOAuthProviderLink(request, user, payload = {}) {
    if (!authService || typeof authService.startProviderLink !== "function") {
      throw new AppError(501, "OAuth linking is not available.");
    }

    return authService.startProviderLink(request, {
      provider: payload.provider,
      returnTo: payload.returnTo
    });
  }

  async function unlinkOAuthProvider(request, user, payload = {}) {
    if (!authService || typeof authService.unlinkProvider !== "function") {
      throw new AppError(501, "OAuth unlink is not available.");
    }

    return authService.unlinkProvider(request, {
      provider: payload.provider
    });
  }

  async function logoutOtherSessions(request) {
    if (!authService || typeof authService.signOutOtherSessions !== "function") {
      throw new AppError(501, "Logout other sessions is not available.");
    }

    return authService.signOutOtherSessions(request);
  }

  return Object.freeze({
    changePassword,
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions
  });
}

export { createService };
