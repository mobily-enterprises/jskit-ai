import { AppError } from "../../../lib/errors.js";

function createPasswordSecurityFlows(deps) {
  const {
    ensureConfigured,
    validators,
    validationError,
    getSupabaseClient,
    passwordResetRedirectUrl,
    mapAuthError,
    validatePasswordRecoveryPayload,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    setSessionFromRequestCookies,
    resolvePasswordSignInPolicyForUserId,
    mapPasswordUpdateError,
    setPasswordSetupRequiredForUserId,
    normalizeEmail,
    createStatelessSupabaseClient,
    mapCurrentPasswordError,
    resolveCurrentAuthContext,
    findAuthMethodById,
    authMethodPasswordId,
    buildDisabledPasswordSecret,
    setPasswordSignInEnabledForUserId,
    buildAuthMethodsStatusFromSupabaseUser,
    buildSecurityStatusFromAuthMethodsStatus,
    authMethodPasswordProvider,
    buildAuthMethodsStatusFromProviderIds
  } = deps;

  async function requestPasswordReset(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const options = { redirectTo: passwordResetRedirectUrl };
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
      message: "If an account exists for that email, a password reset link has been sent."
    };
  }

  async function completePasswordRecovery(payload) {
    ensureConfigured();

    const parsed = validatePasswordRecoveryPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasCode) {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      } else if (parsed.hasTokenHash) {
        response = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: parsed.tokenHash
        });
      } else {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      }
      /* c8 ignore next 3 -- defensive: supabase-js usually surfaces failures via response.error. */
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error) {
      throw mapRecoveryError(response.error);
    }

    /* c8 ignore next 3 -- defensive against malformed SDK responses without explicit error payload. */
    if (!response.data?.session || !response.data?.user) {
      throw new AppError(401, "Recovery link is invalid or has expired.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function resetPassword(request, payload) {
    ensureConfigured();

    const parsed = validators.resetPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const profile = await syncProfileFromSupabaseUser(
      sessionResponse.data.user,
      sessionResponse.data.user?.email || ""
    );
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(409, "Password sign-in is disabled for this account.");
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: parsed.password
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const updatedProfile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(updatedProfile.id, false);
  }

  async function changePassword(request, payload) {
    ensureConfigured();

    const currentPassword = String(payload?.currentPassword || "");
    const newPassword = String(payload?.newPassword || "");
    const requireCurrentPassword = payload?.requireCurrentPassword !== false;
    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    const email = normalizeEmail(sessionResponse.data.user?.email || "");
    if (!email) {
      throw new AppError(500, "Authenticated user email could not be resolved.");
    }

    if (requireCurrentPassword) {
      const verificationClient = createStatelessSupabaseClient();
      let verifyResponse;
      try {
        verifyResponse = await verificationClient.auth.signInWithPassword({
          email,
          password: currentPassword
        });
      } catch (error) {
        throw mapCurrentPasswordError(error);
      }

      if (verifyResponse.error || !verifyResponse.data?.session) {
        throw mapCurrentPasswordError(verifyResponse.error);
      }
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: newPassword
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(profile.id, false);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function setPasswordSignInEnabled(request, payload = {}) {
    ensureConfigured();

    if (typeof payload?.enabled !== "boolean") {
      throw validationError({
        enabled: "Enabled must be a boolean."
      });
    }

    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const current = await resolveCurrentAuthContext(request, {
      supabaseClient: supabase
    });
    const passwordMethod = findAuthMethodById(current.authMethodsStatus, authMethodPasswordId);

    if (!passwordMethod) {
      throw new AppError(500, "Password method configuration could not be resolved.");
    }

    if (payload.enabled && !passwordMethod.configured) {
      throw validationError({
        enabled: "Set a password before enabling password sign-in."
      });
    }

    if (!payload.enabled && !passwordMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
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
        await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
      }
    }

    const passwordSignInOptions = !payload.enabled && passwordMethod.configured ? { passwordSetupRequired: true } : {};
    const nextPasswordSignInPolicy = await setPasswordSignInEnabledForUserId(
      current.profile.id,
      payload.enabled,
      passwordSignInOptions
    );
    const nextAuthMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, nextPasswordSignInPolicy);

    return {
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(nextAuthMethodsStatus)
    };
  }

  async function signOutOtherSessions(request) {
    ensureConfigured();
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const response = await supabase.auth.signOut({
      scope: "others"
    });

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }
  }

  async function getSecurityStatus(request) {
    if (!request) {
      const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([authMethodPasswordProvider], {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      });
      return buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus);
    }

    const current = await resolveCurrentAuthContext(request);
    return buildSecurityStatusFromAuthMethodsStatus(current.authMethodsStatus);
  }

  return {
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    changePassword,
    setPasswordSignInEnabled,
    signOutOtherSessions,
    getSecurityStatus
  };
}

export { createPasswordSecurityFlows };
