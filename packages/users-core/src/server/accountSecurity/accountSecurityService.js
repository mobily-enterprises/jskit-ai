import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { returnJsonApiData, returnJsonApiMeta } from "@jskit-ai/http-runtime/shared";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("accountSecurityService requires repositories.");
  }

  async function changePassword(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.changePassword !== "function") {
      throw new AppError(501, "Password change is not available.", {
        code: "users.security.passwordChangeUnavailable"
      });
    }

    if (payload.confirmPassword !== payload.newPassword) {
      throw createValidationError({
        confirmPassword: {
          code: "users.security.passwordConfirmationMismatch",
          message: "Password confirmation does not match."
        }
      });
    }

    const result = await authService.changePassword(request, {
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword,
      confirmPassword: payload.confirmPassword
    });

    return {
      session: result?.session || null,
      response: returnJsonApiMeta({
        message: "Password updated.",
        messageCode: "users.security.passwordUpdated",
        messageParams: {}
      })
    };
  }

  async function setPasswordMethodEnabled(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.setPasswordSignInEnabled !== "function") {
      throw new AppError(501, "Password method toggle is not available.", {
        code: "users.security.passwordMethodToggleUnavailable"
      });
    }

    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const enabled = payload.enabled === true;
    const response = await authService.setPasswordSignInEnabled(request, { enabled });
    await userSettingsRepository.updatePasswordSignInEnabled(profile.id, enabled);
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData({
      ...(response && typeof response === "object" ? response : {}),
      settings: accountSettingsResponseFormatter({
        profile,
        settings,
        securityStatus,
        authService
      })
    });
  }

  async function startOAuthProviderLink(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.startProviderLink !== "function") {
      throw new AppError(501, "OAuth linking is not available.", {
        code: "users.security.oauthLinkUnavailable"
      });
    }

    return authService.startProviderLink(request, {
      provider: payload.provider,
      returnTo: payload.returnTo
    });
  }

  async function unlinkOAuthProvider(request, user, payload = {}, options = {}) {
    if (!authService || typeof authService.unlinkProvider !== "function") {
      throw new AppError(501, "OAuth unlink is not available.", {
        code: "users.security.oauthUnlinkUnavailable"
      });
    }

    return returnJsonApiData(await authService.unlinkProvider(request, {
      provider: payload.provider
    }));
  }

  async function logoutOtherSessions(request, _user, options = {}) {
    if (!authService || typeof authService.signOutOtherSessions !== "function") {
      throw new AppError(501, "Logout other sessions is not available.", {
        code: "users.security.logoutOtherSessionsUnavailable"
      });
    }

    await authService.signOutOtherSessions(request);

    return null;
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
