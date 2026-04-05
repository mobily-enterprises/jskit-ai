import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

function createService({
  userSettingsRepository,
  usersRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !usersRepository) {
    throw new Error("accountSecurityService requires repositories.");
  }

  async function changePassword(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.changePassword !== "function") {
      throw new AppError(501, "Password change is not available.");
    }

    if (payload.confirmPassword !== payload.newPassword) {
      throw createValidationError({
        confirmPassword: "Password confirmation does not match."
      });
    }

    return authService.changePassword(request, {
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword,
      confirmPassword: payload.confirmPassword
    });
  }

  async function setPasswordMethodEnabled(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.setPasswordSignInEnabled !== "function") {
      throw new AppError(501, "Password method toggle is not available.");
    }

    const profile = await resolveUserProfile(usersRepository, user);
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

  async function startOAuthProviderLink(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.startProviderLink !== "function") {
      throw new AppError(501, "OAuth linking is not available.");
    }

    return authService.startProviderLink(request, {
      provider: payload.provider,
      returnTo: payload.returnTo
    });
  }

  async function unlinkOAuthProvider(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.unlinkProvider !== "function") {
      throw new AppError(501, "OAuth unlink is not available.");
    }

    return authService.unlinkProvider(request, {
      provider: payload.provider
    });
  }

  async function logoutOtherSessions(request, _user, options = {}) {
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
