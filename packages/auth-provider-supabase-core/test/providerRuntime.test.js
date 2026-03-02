import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/framework-core/kernel/server";
import { TOKENS } from "@jskit-ai/framework-core/support/tokens";
import { AuthSupabaseServiceProvider } from "../src/server/providers/AuthSupabaseServiceProvider.js";

test("auth supabase provider registers authService + actionExecutor bindings", async () => {
  const app = createApplication();
  app.instance(TOKENS.Env, {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance(TOKENS.Logger, {
    info() {},
    warn() {},
    error() {},
    debug() {}
  });

  await app.start({ providers: [AuthSupabaseServiceProvider] });

  const authService = app.make("authService");
  assert.equal(typeof authService?.login, "function");

  const actionExecutor = app.make("actionExecutor");
  assert.equal(typeof actionExecutor?.execute, "function");

  const definitions = actionExecutor.listDefinitions();
  assert.equal(Array.isArray(definitions), true);
  assert.equal(definitions.some((definition) => definition.id === "auth.login.password"), true);
});

test("auth supabase provider throws clear error when required env is missing", async () => {
  const app = createApplication();
  await app.start({ providers: [AuthSupabaseServiceProvider] });

  assert.throws(
    () => app.make("authService"),
    /Missing required Supabase auth configuration: AUTH_SUPABASE_URL, AUTH_SUPABASE_PUBLISHABLE_KEY/
  );
});

test("auth supabase provider validates Supabase URL and publishable key formats", async () => {
  const app = createApplication();
  app.instance(TOKENS.Env, {
    AUTH_SUPABASE_URL: "sb_publishable_swapped",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "https://example.supabase.co"
  });
  await app.start({ providers: [AuthSupabaseServiceProvider] });

  assert.throws(
    () => app.make("authService"),
    /Invalid AUTH_SUPABASE_URL value "sb_publishable_swapped"/
  );
});
