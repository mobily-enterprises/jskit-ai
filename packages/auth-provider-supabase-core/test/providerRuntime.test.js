import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/server/kernel";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { AuthSupabaseServiceProvider } from "../src/server/providers/AuthSupabaseServiceProvider.js";

test("auth supabase provider registers authService and contributes auth actions", async () => {
  const app = createApplication();
  app.instance(KERNEL_TOKENS.Env, {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance(KERNEL_TOKENS.Logger, {
    info() {},
    warn() {},
    error() {},
    debug() {}
  });
  app.instance("domainEvents", {
    async publish() {}
  });
  app.instance("users.profile.sync.service", {
    async findByIdentity() {
      return null;
    },
    async syncIdentityProfile(profile) {
      return {
        id: 1,
        authProvider: String(profile?.authProvider || "supabase"),
        authProviderUserId: String(profile?.authProviderUserId || "user-1"),
        email: String(profile?.email || "test@example.com"),
        displayName: String(profile?.displayName || "Test User")
      };
    }
  });

  await app.start({
    providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
  });

  const authService = app.make("authService");
  assert.equal(typeof authService?.login, "function");

  const actionExecutor = app.make("actionExecutor");
  assert.equal(typeof actionExecutor?.execute, "function");

  const definitions = actionExecutor.listDefinitions();
  assert.equal(Array.isArray(definitions), true);
  assert.equal(definitions.some((definition) => definition.id === "auth.login.password"), true);
});

test("auth supabase provider requires users.profile.sync.service when configured", async () => {
  const app = createApplication();
  app.instance(KERNEL_TOKENS.Env, {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance(KERNEL_TOKENS.Logger, {
    info() {},
    warn() {},
    error() {},
    debug() {}
  });
  app.instance("domainEvents", {
    async publish() {}
  });

  await app.start({
    providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
  });

  assert.throws(() => app.make("authService"), /users\.profile\.sync\.service/);
});
