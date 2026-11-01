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
import { accountSecurityStatusFormatter } from "../common/formatters/accountSecurityStatusFormatter.js";

/**
 * A signed-in user's password, sign-in methods and sessions, through the
 * installed auth provider.
 * @param {object} dependencies
 * @param {import("../types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService The installed provider's `auth.service`.
 */
function createService({ userSettingsRepository, userProfilesRepository, authService }) {
  async function changePassword(request, user, payload) {
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

  async function setPasswordMethodEnabled(request, user, payload) {
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

  async function startOAuthProviderLink(request, user, payload) {
    return authService.startProviderLink(request, {
      provider: payload.provider,
      returnTo: payload.returnTo
    });
  }

  async function unlinkOAuthProvider(request, user, payload) {
    const result = await authService.unlinkProvider(request, {
      provider: payload.provider
    });
    return returnJsonApiData({
      securityStatus: accountSecurityStatusFormatter(result?.securityStatus)
    });
  }

  async function logoutOtherSessions(request, _user) {
    await authService.signOutOtherSessions(request);

    return null;
  }

  return Object.freeze({
    changePassword,
    // readable-check: allow setter-seam - not a slot: setPasswordMethodEnabled is a service operation
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions
  });
}

/** @typedef {ReturnType<typeof createService>} AccountSecurityService */

export { createService };
