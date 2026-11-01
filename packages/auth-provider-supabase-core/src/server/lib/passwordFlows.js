import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_TEXTS, authFieldError } from "@jskit-ai/auth-core/server/authTexts";
import { authPasswordResetRequestBodyValidator } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { authPasswordRecoveryCompleteBodyValidator } from "@jskit-ai/auth-core/shared/commands/authPasswordRecoveryCompleteCommand";
import { authPasswordResetBodyValidator } from "@jskit-ai/auth-core/shared/commands/authPasswordResetCommand";
import {
  requireAuthUser,
  requireAuthSession,
  requireAuthUserSession
} from "./flowGuards.js";
import { AUTH_METHOD_PASSWORD_ID } from "@jskit-ai/auth-core/shared/authMethods";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import {
  mapAuthError,
  mapCurrentPasswordError,
  mapPasswordUpdateError,
  mapRecoveryError,
  validationError
} from "./authErrorMappers.js";
import { buildAuthMethodsStatusFromSupabaseUser, findAuthMethodById } from "./authMethodStatus.js";
import { buildDisabledPasswordSecret } from "./authSecrets.js";

/**
 * Password recovery, changing a password and turning password sign-in on or
 * off, through Supabase.
 * @param {object} dependencies
 * @param {import("./types.js").SupabaseConfig} dependencies.config
 * @param {import("./types.js").SupabaseClients} dependencies.clients
 * @param {import("./types.js").SupabaseSessions} dependencies.sessions
 * @param {import("./types.js").SupabaseProfileMirror} dependencies.profileMirror
 * @param {import("./types.js").SupabaseSecurityStatus} dependencies.securityStatus
 * @param {import("./types.js").SupabaseProfiles} dependencies.profiles
 */
function createSupabasePasswordFlows({ config, clients, sessions, profileMirror, securityStatus, profiles }) {
  async function requestPasswordReset(payload) {
    clients.ensureConfigured();

    const result = authPasswordResetRequestBodyValidator.schema.create(payload);
    if (Object.keys(result.errors).length > 0) {
      throw validationError(result.errors);
    }
    const parsed = result.validatedObject;

    const supabase = clients.createSupabaseClient();
    const options = { redirectTo: config.passwordResetRedirectUrl };
    let response;
    try {
      response = await supabase.auth.resetPasswordForEmail(parsed.email, options);
      /* c8 ignore next 4 -- supabase-js returns auth/transport failures as response.error;
       * this catch exists only for unexpected non-Auth throws from SDK/runtime internals. */
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    return {
      ok: true,
      message: "If an account exists for that email, a password reset link has been sent.",
      messageCode: "auth.supabase.recovery.requested",
      messageParams: {}
    };
  }

  async function completePasswordRecovery(payload) {
    clients.ensureConfigured();

    const result = authPasswordRecoveryCompleteBodyValidator.schema.patch(payload);
    if (Object.keys(result.errors).length > 0) {
      throw validationError(result.errors);
    }
    const parsed = result.validatedObject;
    const code = String(parsed.code || "").trim();
    const tokenHash = String(parsed.tokenHash || "").trim();
    const accessToken = String(parsed.accessToken || "").trim();
    const refreshToken = String(parsed.refreshToken || "").trim();
    const hasCode = Boolean(code);
    const hasTokenHash = Boolean(tokenHash);
    const hasSessionPair = Boolean(accessToken && refreshToken);
    const fieldErrors = {};

    if ((accessToken && !refreshToken) || (!accessToken && refreshToken)) {
      if (!accessToken) {
        fieldErrors.accessToken = {
          code: "auth.supabase.tokens.accessTokenRequired",
          message: "Access token is required when a refresh token is provided."
        };
      }
      if (!refreshToken) {
        fieldErrors.refreshToken = {
          code: "auth.supabase.tokens.refreshTokenRequired",
          message: "Refresh token is required when an access token is provided."
        };
      }
    }

    if (!hasCode && !hasTokenHash && !hasSessionPair) {
      fieldErrors.recovery = authFieldError(AUTH_TEXTS.recoveryTokenRequired);
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw validationError(fieldErrors);
    }

    const supabase = clients.createSupabaseClient();
    let response;
    try {
      if (hasCode) {
        response = await supabase.auth.exchangeCodeForSession(code);
      } else if (hasTokenHash) {
        response = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash
        });
      } else {
        response = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
      }
      /* c8 ignore next 3 -- defensive: supabase-js usually surfaces failures via response.error. */
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error) {
      throw mapRecoveryError(response.error);
    }

    const { user, session } = requireAuthUserSession(response, () =>
      new AppError(401, "Recovery link is invalid or has expired.", { code: "auth.supabase.recovery.linkInvalid" }));
    const profile = await profileMirror.syncProfileFromSupabaseUser(user, user.email);

    return {
      profile,
      session: {
        ...session,
        purpose: "recovery"
      }
    };
  }

  async function resetPassword(request, payload) {
    clients.ensureConfigured();

    const result = authPasswordResetBodyValidator.schema.create(payload);
    if (Object.keys(result.errors).length > 0) {
      throw validationError(result.errors);
    }
    const parsed = result.validatedObject;

    const supabase = clients.createSupabaseClient();
    const sessionResponse = await sessions.setRecoverySessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const profile = await profileMirror.syncProfileFromSupabaseUser(
      sessionResponse.data.user,
      sessionResponse.data.user?.email || ""
    );
    const passwordSignInPolicy = await securityStatus.passwordSignInPolicyForUser(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(409, "Password sign-in is disabled for this account.", { code: "auth.supabase.password.signInDisabled" });
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: parsed.password
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    const { user } = requireAuthUser(updateResponse, mapPasswordUpdateError);

    const updatedProfile = await profileMirror.syncProfileFromSupabaseUser(user, user.email);
    await profiles.userSettingsRepository.updatePasswordSetupRequired(updatedProfile.id, false);

    const signOutResponse = await supabase.auth.signOut({
      scope: "local"
    });

    if (signOutResponse.error) {
      throw mapAuthError(signOutResponse.error, Number(signOutResponse.error?.status || 400));
    }
  }

  async function changePassword(request, payload) {
    clients.ensureConfigured();

    const currentPassword = String(payload.currentPassword || "");
    const newPassword = String(payload.newPassword || "");
    const requireCurrentPassword = payload.requireCurrentPassword !== false;
    const supabase = clients.createSupabaseClient();
    const sessionResponse = await sessions.setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    const email = normalizeEmail(sessionResponse.data.user?.email || "");
    if (!email) {
      throw new AppError(500, "Authenticated user email could not be resolved.", { code: "auth.supabase.session.emailUnresolved" });
    }

    if (requireCurrentPassword) {
      const verificationClient = clients.createSupabaseClient();
      let verifyResponse;
      try {
        verifyResponse = await verificationClient.auth.signInWithPassword({
          email,
          password: currentPassword
        });
      } catch (error) {
        throw mapCurrentPasswordError(error);
      }

      requireAuthSession(verifyResponse, mapCurrentPasswordError);
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: newPassword
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    const { user } = requireAuthUser(updateResponse, mapPasswordUpdateError);

    const profile = await profileMirror.syncProfileFromSupabaseUser(user, user.email);
    await profiles.userSettingsRepository.updatePasswordSetupRequired(profile.id, false);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function setPasswordSignInEnabled(request, payload) {
    clients.ensureConfigured();

    if (typeof payload.enabled !== "boolean") {
      throw validationError({
        enabled: { code: "auth.supabase.methods.enabledNotBoolean", message: "Enabled must be a boolean." }
      });
    }

    const supabase = clients.createSupabaseClient();
    await sessions.setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const current = await securityStatus.currentAuthContext(request, {
      supabaseClient: supabase
    });
    const passwordMethod = findAuthMethodById(current.authMethodsStatus, AUTH_METHOD_PASSWORD_ID);

    if (!passwordMethod) {
      throw new AppError(500, "Password method configuration could not be resolved.", {
        code: "auth.supabase.methods.passwordUnresolved"
      });
    }

    if (payload.enabled && !passwordMethod.configured) {
      throw validationError({
        enabled: { code: "auth.supabase.methods.passwordNotSet", message: "Set a password before enabling password sign-in." }
      });
    }

    if (!payload.enabled && !passwordMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.", { code: "auth.supabase.methods.lastEnabled" });
    }

    if (!payload.enabled && passwordMethod.configured) {
      let updateResponse = null;
      try {
        updateResponse = await supabase.auth.updateUser({
          // Supabase does not support null password removal; rotate to high-entropy unknown secret.
          password: buildDisabledPasswordSecret()
        });
      } catch {
        // Some Supabase projects require re-authenticated password updates.
        // Treat secret rotation as best-effort and still disable app-level password sign-in.
        updateResponse = null;
      }

      if (!updateResponse || updateResponse.error || !updateResponse.data?.user) {
        updateResponse = null;
      }

      if (updateResponse?.data?.user) {
        await profileMirror.syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
      }
    }

    const passwordSignInOptions = !payload.enabled && passwordMethod.configured ? { passwordSetupRequired: true } : {};
    const updatedSettings = await profiles.userSettingsRepository.updatePasswordSignInEnabled(
      current.profile.id,
      payload.enabled,
      passwordSignInOptions
    );
    const nextAuthMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, {
      passwordSignInEnabled: updatedSettings.passwordSignInEnabled !== false,
      passwordSetupRequired: updatedSettings.passwordSetupRequired === true,
      oauthProviders: config.oauth.providers
    });

    return {
      securityStatus: securityStatus.buildSecurityStatus(nextAuthMethodsStatus)
    };
  }

  return Object.freeze({
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    changePassword,
    // readable-check: allow setter-seam - not a slot: setPasswordSignInEnabled is an auth.service operation
    setPasswordSignInEnabled
  });
}

export { createSupabasePasswordFlows };
