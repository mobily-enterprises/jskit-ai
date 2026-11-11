import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAssistantAiConfig,
  resolveAssistantServerConfig
} from "../src/server/support/assistantServerConfig.js";

test("assistant server config resolves per-surface AI config without app-level global fallback", () => {
  const appConfig = {
    assistantServer: {
      admin: {
        aiConfigPrefix: "ADMIN_ASSISTANT",
        provider: "anthropic",
        apiKey: "config-key",
        baseUrl: "https://config.example.test",
        model: "claude-config",
        timeoutMs: 45_000,
        barredActionIds: ["demo.admin.secret"],
        toolSkipActionPrefixes: ["demo.hidden."]
      }
    },
    assistant: {
      provider: "openai",
      apiKey: "global-key"
    }
  };
  const env = {
    ADMIN_ASSISTANT_AI_PROVIDER: "deepseek",
    ADMIN_ASSISTANT_AI_API_KEY: "surface-key",
    AI_PROVIDER: "openai",
    AI_API_KEY: "global-env-key"
  };

  assert.deepEqual(resolveAssistantServerConfig(appConfig, "admin"), {
    aiIntegrationId: "",
    aiIntegrationIds: [],
    aiConfigPrefix: "ADMIN_ASSISTANT",
    provider: "anthropic",
    apiKey: "config-key",
    baseUrl: "https://config.example.test",
    model: "claude-config",
    timeoutMs: 45_000,
    barredActionIds: ["demo.admin.secret"],
    toolSkipActionPrefixes: ["demo.hidden."],
    maxToolArgumentBytes: null,
    settingsUpdatePermission: null
  });
  assert.deepEqual(resolveAssistantAiConfig({ appConfig, env }, "admin"), {
    aiConfigPrefix: "ADMIN_ASSISTANT",
    ai: {
      enabled: true,
      provider: "deepseek",
      apiKey: "surface-key",
      baseUrl: "https://config.example.test",
      model: "claude-config",
      timeoutMs: 45_000
    }
  });
});

test("assistant server config requires explicit aiConfigPrefix for each surface", () => {
  assert.throws(
    () =>
      resolveAssistantAiConfig(
        {
          appConfig: {},
          env: {
            AI_PROVIDER: "anthropic",
            AI_API_KEY: "global-env-key"
          }
        },
        "admin"
      ),
    /requires assistantServer\.admin\.aiConfigPrefix/
  );
});

test("assistantServer.<surface>.maxToolArgumentBytes raises a surface's tool argument limit up to 1 MiB", () => {
  const resolve = maxToolArgumentBytes => resolveAssistantServerConfig({ assistantServer: { writer: { maxToolArgumentBytes } } }, "writer");
  assert.equal(resolve(undefined).maxToolArgumentBytes, null, "Absent, the surface keeps the catalogue's 32 KiB");
  assert.equal(resolve(128 * 1024).maxToolArgumentBytes, 128 * 1024);
  assert.equal(resolve(1024 * 1024).maxToolArgumentBytes, 1024 * 1024);
  for (const invalid of [0, -1, 1.5, "65536", 1024 * 1024 + 1, Number.POSITIVE_INFINITY, null, true]) {
    assert.throws(() => resolve(invalid), {
      name: "TypeError",
      message: /^assistantServer\.writer\.maxToolArgumentBytes must be/u
    }, String(invalid));
  }
});
