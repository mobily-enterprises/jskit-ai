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
    maxToolResultBytes: null,
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

for (const [key, fallback] of [["maxToolArgumentBytes", "32 KiB"], ["maxToolResultBytes", "48 KiB"]]) {
  test(`assistantServer.<surface>.${key} raises a surface's tool ${key === "maxToolArgumentBytes" ? "argument" : "result"} limit up to 1 MiB`, () => {
    const resolve = value => resolveAssistantServerConfig({ assistantServer: { writer: { [key]: value } } }, "writer");
    assert.equal(resolve(undefined)[key], null, `Absent, the surface keeps the catalogue's ${fallback}`);
    assert.equal(resolve(128 * 1024)[key], 128 * 1024);
    assert.equal(resolve(1024 * 1024)[key], 1024 * 1024);
    for (const invalid of [0, -1, 1.5, "65536", 1024 * 1024 + 1, Number.POSITIVE_INFINITY, null, true]) {
      assert.throws(() => resolve(invalid), {
        name: "TypeError",
        message: new RegExp(`^assistantServer\\.writer\\.${key} must be`, "u")
      }, String(invalid));
    }
  });
}
