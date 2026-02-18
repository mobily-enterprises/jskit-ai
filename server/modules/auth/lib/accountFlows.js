import { AppError } from "../../../../lib/errors.js";

function createAccountFlows(deps) {
  const {
    ensureConfigured,
    validators,
    validationError,
    getSupabaseClient,
    displayNameFromEmail,
    mapAuthError,
    syncProfileFromSupabaseUser,
    resolvePasswordSignInPolicyForUserId,
    otpLoginRedirectUrl,
    isTransientSupabaseError,
    isUserNotFoundLikeAuthError,
    parseOtpLoginVerifyPayload,
    mapOtpVerifyError,
    setSessionFromRequestCookies,
    mapProfileUpdateError
  } = deps;

  async function register(payload) {
    ensureConfigured();

    const parsed = validators.registerInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signUp({
      email: parsed.email,
      password: parsed.password,
      options: {
        data: {
          display_name: displayNameFromEmail(parsed.email)
        }
      }
    });

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    if (!response.data?.user) {
      throw new AppError(500, "Supabase sign-up did not return a user.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);

    if (!response.data.session) {
      return {
        requiresEmailConfirmation: true,
        email: parsed.email,
        profile,
        session: null
      };
    }

    return {
      requiresEmailConfirmation: false,
      profile,
      session: response.data.session
    };
  }

  async function login(payload) {
    ensureConfigured();

    const parsed = validators.loginInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password
    });

    if (response.error || !response.data?.user || !response.data?.session) {
      throw mapAuthError(response.error, 401);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(401, "Invalid email or password.");
    }

    return {
      profile,
      session: response.data.session
    };
  }

  async function requestOtpLogin(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOtp({
        email: parsed.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: otpLoginRedirectUrl
        }
      });
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        throw mapAuthError(error, 503);
      }

      return {
        ok: true,
        message: "If an account exists for that email, a one-time code has been sent."
      };
    }

    if (response.error) {
      if (isTransientSupabaseError(response.error)) {
        throw mapAuthError(response.error, 503);
      }

      if (isUserNotFoundLikeAuthError(response.error)) {
        return {
          ok: true,
          message: "If an account exists for that email, a one-time code has been sent."
        };
      }

      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    return {
      ok: true,
      message: "If an account exists for that email, a one-time code has been sent."
    };
  }

  async function verifyOtpLogin(payload) {
    ensureConfigured();

    const parsed = parseOtpLoginVerifyPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.tokenHash) {
        response = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.type
        });
      } else {
        response = await supabase.auth.verifyOtp({
          email: parsed.email,
          token: parsed.token,
          type: parsed.type
        });
      }
    } catch (error) {
      throw mapOtpVerifyError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapOtpVerifyError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email || parsed.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function updateDisplayName(request, displayName) {
    ensureConfigured();

    const normalizedDisplayName = String(displayName || "").trim();
    if (!normalizedDisplayName) {
      throw validationError({
        displayName: "Display name is required."
      });
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        data: {
          display_name: normalizedDisplayName
        }
      });
    } catch (error) {
      throw mapProfileUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapProfileUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  return {
    register,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    updateDisplayName
  };
}

export { createAccountFlows };
