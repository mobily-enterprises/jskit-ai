import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../lib/errors.js";
import { createAccountFlows } from "../services/auth/lib/accountFlows.js";
import { createPasswordSecurityFlows } from "../services/auth/lib/passwordSecurityFlows.js";

function createValidationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

test("updateDisplayName uses the same per-request Supabase client for setSession and updateUser", async () => {
  const calls = {
    setSessionFromRequestCookies: [],
    updateUser: []
  };

  const supabaseClient = {
    auth: {
      async updateUser(payload) {
        calls.updateUser.push(payload);
        return {
          data: {
            user: {
              id: "supabase-user-1",
              email: "user@example.com",
              user_metadata: {
                display_name: String(payload?.data?.display_name || "")
              }
            }
          }
        };
      }
    }
  };

  const flows = createAccountFlows({
    ensureConfigured() {},
    validators: {
      registerInput: () => ({ fieldErrors: {} }),
      loginInput: () => ({ fieldErrors: {} }),
      forgotPasswordInput: () => ({ fieldErrors: {} })
    },
    validationError: createValidationError,
    getSupabaseClient: () => supabaseClient,
    displayNameFromEmail: (email) => String(email || "").split("@")[0] || "user",
    mapAuthError: (error, statusCode = 400) => new AppError(statusCode, String(error?.message || "auth error")),
    syncProfileFromSupabaseUser: async (user, fallbackEmail) => ({
      id: 1,
      supabaseUserId: String(user?.id || ""),
      email: String(user?.email || fallbackEmail || ""),
      displayName: String(user?.user_metadata?.display_name || "user")
    }),
    resolvePasswordSignInPolicyForUserId: async () => ({
      passwordSignInEnabled: true,
      passwordSetupRequired: false
    }),
    otpLoginRedirectUrl: "http://localhost:5173/login",
    isTransientSupabaseError: () => false,
    isUserNotFoundLikeAuthError: () => false,
    parseOtpLoginVerifyPayload: () => ({ fieldErrors: {} }),
    mapOtpVerifyError: (error) => new AppError(400, String(error?.message || "otp error")),
    async setSessionFromRequestCookies(request, options = {}) {
      calls.setSessionFromRequestCookies.push({
        request,
        options
      });
      return {
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token"
          },
          user: {
            id: "supabase-user-1",
            email: "user@example.com"
          }
        }
      };
    },
    mapProfileUpdateError: (error) => new AppError(400, String(error?.message || "profile update error"))
  });

  const result = await flows.updateDisplayName({ marker: "request-a" }, "Updated Name");

  assert.equal(calls.setSessionFromRequestCookies.length, 1);
  assert.equal(calls.setSessionFromRequestCookies[0].options.supabaseClient, supabaseClient);
  assert.equal(calls.updateUser.length, 1);
  assert.equal(calls.updateUser[0].data.display_name, "Updated Name");
  assert.equal(result.profile.displayName, "Updated Name");
});

test("setPasswordSignInEnabled reuses one per-request client across session and auth-context resolution", async () => {
  const calls = {
    setSessionFromRequestCookies: [],
    resolveCurrentAuthContext: [],
    updateUser: [],
    setPasswordSignInEnabledForUserId: []
  };

  const supabaseClient = {
    auth: {
      async updateUser(payload) {
        calls.updateUser.push(payload);
        return {
          data: {
            user: {
              id: "supabase-user-1",
              email: "user@example.com",
              app_metadata: {
                provider: "email",
                providers: ["email"]
              }
            }
          }
        };
      },
      async signOut() {
        return { error: null };
      }
    }
  };

  const flows = createPasswordSecurityFlows({
    ensureConfigured() {},
    validators: {
      forgotPasswordInput: () => ({ fieldErrors: {} }),
      resetPasswordInput: () => ({ fieldErrors: {} })
    },
    validationError: createValidationError,
    getSupabaseClient: () => supabaseClient,
    passwordResetRedirectUrl: "http://localhost:5173/reset-password",
    mapAuthError: (error, statusCode = 400) => new AppError(statusCode, String(error?.message || "auth error")),
    validatePasswordRecoveryPayload: () => ({ fieldErrors: {} }),
    mapRecoveryError: (error) => new AppError(401, String(error?.message || "recovery error")),
    syncProfileFromSupabaseUser: async (user, fallbackEmail) => ({
      id: 42,
      supabaseUserId: String(user?.id || ""),
      email: String(user?.email || fallbackEmail || ""),
      displayName: "User"
    }),
    async setSessionFromRequestCookies(request, options = {}) {
      calls.setSessionFromRequestCookies.push({
        request,
        options
      });
      return {
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token"
          },
          user: {
            id: "supabase-user-1",
            email: "user@example.com",
            app_metadata: {
              provider: "email",
              providers: ["email"]
            }
          }
        }
      };
    },
    resolvePasswordSignInPolicyForUserId: async () => ({
      passwordSignInEnabled: true,
      passwordSetupRequired: false
    }),
    mapPasswordUpdateError: (error) => new AppError(400, String(error?.message || "password update error")),
    setPasswordSetupRequiredForUserId: async () => undefined,
    normalizeEmail: (value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    createStatelessSupabaseClient: () => ({
      auth: {
        async signInWithPassword() {
          return {
            data: {
              session: {
                access_token: "verify-session"
              }
            }
          };
        }
      }
    }),
    mapCurrentPasswordError: (error) => new AppError(400, String(error?.message || "current password error")),
    async resolveCurrentAuthContext(request, options = {}) {
      calls.resolveCurrentAuthContext.push({
        request,
        options
      });
      return {
        profile: {
          id: 42
        },
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email"]
          },
          identities: []
        },
        authMethodsStatus: {
          methods: [
            {
              id: "password",
              configured: true,
              enabled: true,
              canDisable: true
            }
          ]
        }
      };
    },
    findAuthMethodById: (status, id) => status?.methods?.find((method) => method.id === id) || null,
    authMethodPasswordId: "password",
    buildDisabledPasswordSecret: () => "disabled-secret",
    async setPasswordSignInEnabledForUserId(userId, enabled, options = {}) {
      calls.setPasswordSignInEnabledForUserId.push({
        userId,
        enabled,
        options
      });
      return {
        passwordSignInEnabled: enabled,
        passwordSetupRequired: Boolean(options.passwordSetupRequired)
      };
    },
    buildAuthMethodsStatusFromSupabaseUser: () => ({
      methods: [
        {
          id: "password",
          configured: true,
          enabled: false
        }
      ]
    }),
    buildSecurityStatusFromAuthMethodsStatus: (status) => ({
      authMethods: status.methods
    }),
    authMethodPasswordProvider: "email",
    buildAuthMethodsStatusFromProviderIds: () => ({
      methods: []
    })
  });

  const result = await flows.setPasswordSignInEnabled({ marker: "request-b" }, { enabled: false });

  assert.equal(calls.setSessionFromRequestCookies.length, 1);
  assert.equal(calls.setSessionFromRequestCookies[0].options.supabaseClient, supabaseClient);
  assert.equal(calls.resolveCurrentAuthContext.length, 1);
  assert.equal(calls.resolveCurrentAuthContext[0].options.supabaseClient, supabaseClient);
  assert.equal(calls.updateUser.length, 1);
  assert.equal(calls.setPasswordSignInEnabledForUserId.length, 1);
  assert.equal(calls.setPasswordSignInEnabledForUserId[0].userId, 42);
  assert.equal(calls.setPasswordSignInEnabledForUserId[0].enabled, false);
  assert.deepEqual(result.securityStatus.authMethods, [
    {
      id: "password",
      configured: true,
      enabled: false
    }
  ]);
});

test("signOutOtherSessions uses per-request client session scope", async () => {
  const calls = {
    setSessionFromRequestCookies: [],
    signOut: []
  };

  const supabaseClient = {
    auth: {
      async signOut(payload) {
        calls.signOut.push(payload);
        return { error: null };
      }
    }
  };

  const flows = createPasswordSecurityFlows({
    ensureConfigured() {},
    validators: {
      forgotPasswordInput: () => ({ fieldErrors: {} }),
      resetPasswordInput: () => ({ fieldErrors: {} })
    },
    validationError: createValidationError,
    getSupabaseClient: () => supabaseClient,
    passwordResetRedirectUrl: "http://localhost:5173/reset-password",
    mapAuthError: (error, statusCode = 400) => new AppError(statusCode, String(error?.message || "auth error")),
    validatePasswordRecoveryPayload: () => ({ fieldErrors: {} }),
    mapRecoveryError: (error) => new AppError(401, String(error?.message || "recovery error")),
    syncProfileFromSupabaseUser: async () => ({
      id: 1,
      supabaseUserId: "supabase-user-1",
      email: "user@example.com",
      displayName: "User"
    }),
    async setSessionFromRequestCookies(request, options = {}) {
      calls.setSessionFromRequestCookies.push({
        request,
        options
      });
      return {
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token"
          },
          user: {
            id: "supabase-user-1",
            email: "user@example.com"
          }
        }
      };
    },
    resolvePasswordSignInPolicyForUserId: async () => ({
      passwordSignInEnabled: true,
      passwordSetupRequired: false
    }),
    mapPasswordUpdateError: (error) => new AppError(400, String(error?.message || "password update error")),
    setPasswordSetupRequiredForUserId: async () => undefined,
    normalizeEmail: (value) => String(value || ""),
    createStatelessSupabaseClient: () => ({
      auth: {
        async signInWithPassword() {
          return { data: { session: { access_token: "token" } } };
        }
      }
    }),
    mapCurrentPasswordError: (error) => new AppError(400, String(error?.message || "current password error")),
    resolveCurrentAuthContext: async () => ({
      profile: { id: 1 },
      user: {
        app_metadata: {
          providers: ["email"]
        }
      },
      authMethodsStatus: {
        methods: []
      }
    }),
    findAuthMethodById: () => null,
    authMethodPasswordId: "password",
    buildDisabledPasswordSecret: () => "disabled-secret",
    setPasswordSignInEnabledForUserId: async () => ({
      passwordSignInEnabled: true,
      passwordSetupRequired: false
    }),
    buildAuthMethodsStatusFromSupabaseUser: () => ({
      methods: []
    }),
    buildSecurityStatusFromAuthMethodsStatus: () => ({
      authMethods: []
    }),
    authMethodPasswordProvider: "email",
    buildAuthMethodsStatusFromProviderIds: () => ({
      methods: []
    })
  });

  await flows.signOutOtherSessions({ marker: "request-c" });

  assert.equal(calls.setSessionFromRequestCookies.length, 1);
  assert.equal(calls.setSessionFromRequestCookies[0].options.supabaseClient, supabaseClient);
  assert.deepEqual(calls.signOut, [{ scope: "others" }]);
});
