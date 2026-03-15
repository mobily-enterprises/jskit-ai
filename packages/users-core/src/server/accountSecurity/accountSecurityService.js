import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { createAuthorizedService } from "@jskit-ai/kernel/server/runtime";
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

  const servicePermissions = Object.freeze({
    changePassword: Object.freeze({
      require: "authenticated"
    }),
    setPasswordMethodEnabled: Object.freeze({
      require: "authenticated"
    }),
    startOAuthProviderLink: Object.freeze({
      require: "authenticated"
    }),
    unlinkOAuthProvider: Object.freeze({
      require: "authenticated"
    }),
    logoutOtherSessions: Object.freeze({
      require: "authenticated"
    })
  });

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

  return createAuthorizedService(
    {
      changePassword,
      setPasswordMethodEnabled,
      startOAuthProviderLink,
      unlinkOAuthProvider,
      logoutOtherSessions
    },
    servicePermissions
  );
}

export { createService };
