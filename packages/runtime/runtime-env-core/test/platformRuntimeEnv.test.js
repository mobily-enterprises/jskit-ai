import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformRuntimeEnv, __testables } from "../src/platformRuntimeEnv.js";

test("createPlatformRuntimeEnv uses platform defaults with neutral db names", () => {
  const runtimeEnv = createPlatformRuntimeEnv({
    env: {
      REDIS_NAMESPACE: "jskit:test"
    },
    loadDotenv: false,
    strict: true
  });

  assert.equal(runtimeEnv.DB_HOST, "127.0.0.1");
  assert.equal(runtimeEnv.DB_USER, "app");
  assert.equal(runtimeEnv.DB_NAME, "app");
  assert.equal(runtimeEnv.AUTH_PROVIDER, "supabase");
  assert.equal(runtimeEnv.REDIS_NAMESPACE, "jskit:test");
});

test("createPlatformRuntimeEnv keeps redis namespace optional at load time", () => {
  const runtimeEnv = createPlatformRuntimeEnv({
    env: {},
    loadDotenv: false,
    strict: true
  });

  assert.equal(runtimeEnv.REDIS_NAMESPACE, "");
});

test("createPlatformRuntimeEnv allows app-level default overrides", () => {
  const runtimeEnv = createPlatformRuntimeEnv({
    env: {},
    defaults: {
      REDIS_NAMESPACE: "jskit:default",
      DB_NAME: "tenant_app",
      DB_USER: "tenant_user"
    },
    loadDotenv: false,
    strict: true
  });

  assert.equal(runtimeEnv.REDIS_NAMESPACE, "jskit:default");
  assert.equal(runtimeEnv.DB_NAME, "tenant_app");
  assert.equal(runtimeEnv.DB_USER, "tenant_user");
});

test("dotenv helper resolves normalized file list", () => {
  const files = __testables.resolveDotenvPaths({
    rootDir: "/tmp/example",
    dotenvFiles: [".env", " .env.local ", ""]
  });

  assert.deepEqual(files, ["/tmp/example/.env", "/tmp/example/.env.local"]);
});
