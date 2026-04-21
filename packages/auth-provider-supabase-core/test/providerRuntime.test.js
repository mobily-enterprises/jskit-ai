import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { AuthSupabaseServiceProvider } from "../src/server/providers/AuthSupabaseServiceProvider.js";

function createAppConfigFixture() {
  return {
    surfaceModeAll: "all",
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
      console: {
        id: "console",
        pagesRoot: "console",
        enabled: true,
        requiresAuth: true,
        requiresWorkspace: false
      }
    }
  };
}

function isBootFailureWithCause(error, pattern) {
  return (
    error instanceof Error &&
    /failed during boot\(\)/.test(String(error.message || "")) &&
    pattern.test(String(error.details?.cause?.message || ""))
  );
}

test("auth supabase provider registers authService and contributes auth actions in users mode", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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
        authProviderUserSid: String(profile?.authProviderUserSid || "user-1"),
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
  assert.equal(definitions.some((definition) => definition.id === "auth.register.confirmation.resend"), true);
  assert.equal(definitions.some((definition) => definition.id === "auth.dev.loginAs"), false);
  const sessionRead = definitions.find((definition) => definition.id === "auth.session.read");
  assert.deepEqual(sessionRead?.surfaces, ["home", "console"]);
});

test("auth supabase provider registers authService in standalone mode without users.profile.sync.service", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_PROFILE_MODE: "standalone",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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

  const authService = app.make("authService");
  assert.equal(typeof authService?.login, "function");
});

test("auth supabase provider requires users.profile.sync.service when AUTH_PROFILE_MODE=users", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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

  assert.throws(() => app.make("authService"), /AUTH_PROFILE_MODE=users/);
});

test("auth supabase provider rejects unsupported AUTH_PROFILE_MODE values", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_PROFILE_MODE: "invalid",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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

  assert.throws(() => app.make("authService"), /Unsupported AUTH_PROFILE_MODE/);
});

test("auth supabase provider can boot dev auth without Supabase credentials", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: "dev-bootstrap-secret",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "development"
  });
  app.instance("jskit.logger", {
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
        authProviderUserSid: String(profile?.authProviderUserSid || "user-1"),
        email: String(profile?.email || "test@example.com"),
        displayName: String(profile?.displayName || "Test User")
      };
    }
  });
  app.instance("internal.repository.user-profiles", {
    async findById() {
      return null;
    },
    async findByEmail() {
      return null;
    }
  });

  await app.start({
    providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
  });

  const authService = app.make("authService");
  assert.equal(typeof authService?.devLoginAs, "function");
  assert.equal(typeof authService?.isDevAuthBootstrapEnabled, "function");
  assert.equal(authService.isDevAuthBootstrapEnabled(), true);

  const actionExecutor = app.make("actionExecutor");
  const definitions = actionExecutor.listDefinitions();
  assert.equal(definitions.some((definition) => definition.id === "auth.dev.loginAs"), true);
});

test("auth supabase provider rejects dev auth bypass in production", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: "dev-bootstrap-secret",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "https://example.com",
    NODE_ENV: "production"
  });
  app.instance("jskit.logger", {
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
        authProviderUserSid: String(profile?.authProviderUserSid || "user-1"),
        email: String(profile?.email || "test@example.com"),
        displayName: String(profile?.displayName || "Test User")
      };
    }
  });
  app.instance("internal.repository.user-profiles", {
    async findById() {
      return null;
    },
    async findByEmail() {
      return null;
    }
  });

  await assert.rejects(
    () =>
      app.start({
        providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
      }),
    (error) => isBootFailureWithCause(error, /must not be enabled in production/)
  );
});

test("auth supabase provider rejects dev auth bypass without a secret during boot", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "development"
  });
  app.instance("jskit.logger", {
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
        authProviderUserSid: String(profile?.authProviderUserSid || "user-1"),
        email: String(profile?.email || "test@example.com"),
        displayName: String(profile?.displayName || "Test User")
      };
    }
  });
  app.instance("internal.repository.user-profiles", {
    async findById() {
      return null;
    },
    async findByEmail() {
      return null;
    }
  });

  await assert.rejects(
    () =>
      app.start({
        providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
      }),
    (error) => isBootFailureWithCause(error, /AUTH_DEV_BYPASS_SECRET is required/)
  );
});

test("auth supabase provider rejects dev auth bypass without internal.repository.user-profiles during boot", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: "dev-bootstrap-secret",
    AUTH_PROFILE_MODE: "users",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "development"
  });
  app.instance("jskit.logger", {
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
        authProviderUserSid: String(profile?.authProviderUserSid || "user-1"),
        email: String(profile?.email || "test@example.com"),
        displayName: String(profile?.displayName || "Test User")
      };
    }
  });

  await assert.rejects(
    () =>
      app.start({
        providers: [ActionRuntimeServiceProvider, AuthSupabaseServiceProvider]
      }),
    (error) => isBootFailureWithCause(error, /requires internal\.repository\.user-profiles with findById\(\) and findByEmail\(\)/)
  );
});

test("auth supabase provider reads oauth providers from appConfig.auth.oauth", async () => {
  const app = createApplication();
  app.instance("appConfig", {
    ...createAppConfigFixture(),
    auth: {
      oauth: {
        providers: ["github"],
        defaultProvider: "github"
      }
    }
  });
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_PROFILE_MODE: "standalone",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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

  const authService = app.make("authService");
  const catalog = authService.getOAuthProviderCatalog();
  assert.deepEqual(catalog.providers.map((provider) => provider.id), ["github"]);
  assert.equal(catalog.defaultProvider, "github");
});

test("auth supabase provider lets env oauth settings override appConfig.auth.oauth", async () => {
  const app = createApplication();
  app.instance("appConfig", {
    ...createAppConfigFixture(),
    auth: {
      oauth: {
        providers: ["github"],
        defaultProvider: "github"
      }
    }
  });
  app.instance("jskit.env", {
    AUTH_SUPABASE_URL: "https://example.supabase.co",
    AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    AUTH_OAUTH_PROVIDERS: "google",
    AUTH_OAUTH_DEFAULT_PROVIDER: "google",
    AUTH_PROFILE_MODE: "standalone",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
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

  const authService = app.make("authService");
  const catalog = authService.getOAuthProviderCatalog();
  assert.deepEqual(catalog.providers.map((provider) => provider.id), ["google"]);
  assert.equal(catalog.defaultProvider, "google");
});
