import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AuthSupabaseProvider } from "../src/server/providers/AuthSupabaseProvider.js";

function config(profileMode = "provider") {
  return {
    auth: { profileMode },
    surfaceDefinitions: {
      home: { id: "home", routeBase: "/" },
      console: { id: "console", routeBase: "/console" }
    }
  };
}

function env(overrides = {}) {
  return {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test",
    ...overrides
  };
}

async function startRuntime({ profileMode = "provider", envOverrides = {}, identity = null, decorate = null } = {}) {
  const extensions = createAuthExtensions();
  if (decorate) {
    extensions.registerServiceDecorator({
      decoratorId: "test.decorator",
      decorateAuthService: decorate
    });
  }
  let authService = null;
  const probe = defineProvider({
    id: "test.auth.probe",
    requires: { service: "auth.service" },
    setup({ service }) {
      authService = service;
      return {};
    }
  });
  const inputs = {
    "auth.extensions": extensions,
    "runtime.config": config(profileMode),
    "runtime.env": env(envOverrides),
    ...(identity ? { "users.identity": identity } : {})
  };
  const runtime = createCapabilityRuntime({ inputs, providers: [AuthSupabaseProvider, probe] });
  await runtime.start();
  return { authService, runtime };
}

test("AuthSupabaseProvider exposes a configured provider-owned auth service", async () => {
  const { authService, runtime } = await startRuntime();
  assert.equal(typeof authService.login, "function");
  assert.equal(authService.getCapabilities().provider.id, "supabase");
  assert.equal(authService.getCapabilities().features.appProfileProjection, false);
  assert.equal(authService.getCapabilities().features.password.methodToggle, false);
  await runtime.shutdown();
});

test("AuthSupabaseProvider composes user identity persistence explicitly", async () => {
  const identity = {
    profileProjector: {
      async findByIdentity() { return null; },
      async syncIdentityProfile(profile) { return { id: 1, ...profile }; }
    },
    repositories: {
      userProfiles: { async findById() { return null; }, async findByEmail() { return null; } },
      userSettings: {
        async ensureForUserId() { return {}; },
        async updatePasswordSignInEnabled() { return {}; },
        async updatePasswordSetupRequired() {}
      }
    }
  };
  const { authService, runtime } = await startRuntime({ profileMode: "users", identity });
  assert.equal(authService.getCapabilities().features.appProfileProjection, true);
  assert.equal(authService.getCapabilities().features.password.methodToggle, true);
  await runtime.shutdown();
});

test("AuthSupabaseProvider applies explicit auth service decorators", async () => {
  const { authService, runtime } = await startRuntime({
    decorate(service) {
      return Object.freeze({ ...service, decorated: true });
    }
  });
  assert.equal(authService.decorated, true);
  await runtime.shutdown();
});

test("AuthSupabaseProvider rejects removed profile aliases and mismatched providers", async () => {
  await assert.rejects(
    () => startRuntime({ profileMode: "standalone" }),
    /Unsupported config\.auth\.profileMode/
  );
  await assert.rejects(
    () => startRuntime({ envOverrides: { AUTH_PROVIDER: "local" } }),
    /installed auth provider is Supabase/
  );
});

test("AuthSupabaseProvider requires users.identity only when users profile projection is selected", async () => {
  await assert.rejects(
    () => startRuntime({ profileMode: "users" }),
    /requires the users\.identity capability/
  );
});
