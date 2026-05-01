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
    aiConfigPrefix: "ADMIN_ASSISTANT",
    provider: "anthropic",
    apiKey: "config-key",
    baseUrl: "https://config.example.test",
    model: "claude-config",
    timeoutMs: 45_000,
    barredActionIds: ["demo.admin.secret"],
    toolSkipActionPrefixes: ["demo.hidden."]
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
