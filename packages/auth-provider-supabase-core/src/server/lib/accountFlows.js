import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  requireAuthUser,
  requireAuthUserSession,
  requireNoFieldErrors
} from "./flowGuards.js";

function normalizeLocalReturnToPath(value, { fallback = "" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

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
    buildOtpLoginRedirectUrl,
    appPublicUrl,
    isTransientSupabaseError,
    isUserNotFoundLikeAuthError,
    parseOtpLoginVerifyPayload,
    mapOtpVerifyError,
    setSessionFromRequestCookies,
    mapProfileUpdateError,
    normalizeReturnToPath = normalizeLocalReturnToPath
  } = deps;

  function resolveOtpEmailRedirectTo(returnToValue) {
    const returnTo = normalizeReturnToPath(returnToValue, { fallback: "" });
    if (!returnTo) {
      return otpLoginRedirectUrl;
    }

    if (typeof buildOtpLoginRedirectUrl === "function") {
      try {
        return buildOtpLoginRedirectUrl({
          appPublicUrl,
          returnTo
        });
      } catch {
        // Fall through to the pre-built URL fallback below.
      }
    }

    try {
      const redirectUrl = new URL(String(otpLoginRedirectUrl || ""));
      redirectUrl.searchParams.set("returnTo", returnTo);
      return redirectUrl.toString();
    } catch {
      return otpLoginRedirectUrl;
    }
  }

  function resolveRegisterEmailRedirectTo() {
    if (typeof buildOtpLoginRedirectUrl === "function") {
      try {
        return buildOtpLoginRedirectUrl({
          appPublicUrl
        });
      } catch {
        // Fall through to the pre-built URL fallback below.
      }
    }
    return otpLoginRedirectUrl;
  }

  async function register(payload) {
    ensureConfigured();

    const parsed = validators.registerInput(payload);
    requireNoFieldErrors(parsed, validationError);

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signUp({
      email: parsed.email,
      password: parsed.password,
      options: {
        emailRedirectTo: resolveRegisterEmailRedirectTo(),
        data: {
          display_name: displayNameFromEmail(parsed.email)
        }
      }
    });

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
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

  async function resendRegisterConfirmation(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    requireNoFieldErrors(parsed, validationError);

    const supabase = getSupabaseClient();
    const emailRedirectTo = resolveRegisterEmailRedirectTo();
    let response;
    try {
      response = await supabase.auth.resend({
        type: "signup",
        email: parsed.email,
        options: {
          emailRedirectTo
        }
      });
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        throw mapAuthError(error, 503);
      }

      return {
        ok: true,
        message: "If an account exists for that email, a confirmation email has been sent."
      };
    }

    if (response.error) {
      if (isTransientSupabaseError(response.error)) {
        throw mapAuthError(response.error, 503);
      }

      if (isUserNotFoundLikeAuthError(response.error)) {
        return {
          ok: true,
          message: "If an account exists for that email, a confirmation email has been sent."
        };
      }

      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    return {
      ok: true,
      message: "If an account exists for that email, a confirmation email has been sent."
    };
  }

  async function login(payload) {
    ensureConfigured();

    const parsed = validators.loginInput(payload);
    requireNoFieldErrors(parsed, validationError);

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password
    });

    const { user, session } = requireAuthUserSession(response, mapAuthError, 401);

    const profile = await syncProfileFromSupabaseUser(user, parsed.email);
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(401, "Invalid email or password.");
    }

    return {
      profile,
      session
    };
  }

  async function requestOtpLogin(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    requireNoFieldErrors(parsed, validationError);

    const emailRedirectTo = resolveOtpEmailRedirectTo(payload?.returnTo);
    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOtp({
        email: parsed.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo
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
    requireNoFieldErrors(parsed, validationError);

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

    const { user, session } = requireAuthUserSession(response, mapOtpVerifyError);

    const profile = await syncProfileFromSupabaseUser(user, user.email || parsed.email);

    return {
      profile,
      session
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

    const { user } = requireAuthUser(updateResponse, mapProfileUpdateError);

    const profile = await syncProfileFromSupabaseUser(user, user.email);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  return {
    register,
    resendRegisterConfirmation,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    updateDisplayName
  };
}

export { createAccountFlows };
