import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("assistant-core owns its portable json-rest-schema dependency directly", () => {
  const specifier = String(packageJson.dependencies?.["json-rest-schema"] || "");

  assert.match(
    specifier,
    /^(?:[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|\d+\.x\.x)$/,
    "assistant-core must declare a publishable json-rest-schema dependency"
  );
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
});

test("original assistant-core import contracts forward to the same native and submission owners", async () => {
  const contracts = [
    {
      subpath: "server/codex-events",
      owner: "../src/server/conversation/codexEvents.js",
      names: [
        "classifyCodexAppServerEvent",
        "codexAppServerAssistantItemText",
        "codexAppServerContentText",
        "codexAppServerContextRefreshReason",
        "codexAppServerErrorText",
        "codexAppServerNotificationError",
        "codexAppServerNotificationEvent",
        "codexAppServerNotificationEventPayload",
        "codexAppServerNotificationEventType",
        "codexAppServerNotificationItem",
        "codexAppServerNotificationItemId",
        "codexAppServerNotificationParams",
        "codexAppServerNotificationThreadId",
        "codexAppServerNotificationTurnId",
        "codexAppServerNotificationTurnStatus",
        "codexAppServerNotificationUsageLimitExceeded",
        "codexAppServerOutputOwnerTurnId",
        "codexAppServerProviderThreadAssistantSegments",
        "codexAppServerStatusFromValue",
        "codexAppServerUserMessageText"
      ]
    },
    {
      subpath: "server/codex-turn",
      owner: "../src/server/conversation/codexTurn.js",
      names: [
        "codexAppServerTurnStatusIsActive",
        "codexAppServerTurnStatusIsComplete",
        "codexAppServerTurnStatusIsProviderFailure",
        "codexAppServerTurnStatusIsSuccessfulComplete",
        "createCodexAppServerDetachedTurnWatcher"
      ]
    },
    {
      subpath: "server/codex-client",
      owner: "../src/server/conversation/codexClient.js",
      names: [
        "CodexAppServerJsonRpcClient",
        "socketPathFromCodexAppServerEndpoint"
      ]
    },
    {
      subpath: "server/opencode-client",
      owner: "../src/server/conversation/openCodeClient.js",
      names: [
        "OPENCODE_RESPONSE_LIMIT_BYTES",
        "createOpenCodeServerClient",
        "openCodeAssistantMessageText",
        "readBoundedResponse"
      ]
    },
    {
      subpath: "client/conversation-submit",
      owner: "../src/client/conversation/submitText.js",
      names: [
        "createAssistantTextSubmission"
      ]
    }
  ];
  for (const { subpath, owner, names } of contracts) {
    const namespace = await import(`@jskit-ai/assistant-core/${subpath}`);
    const implementation = await import(owner);
    for (const name of names) {
      assert.notEqual(implementation[name], undefined, `${subpath} original owner exports ${name}`);
      assert.equal(namespace[name], implementation[name], `${subpath} forwards the original ${name}`);
    }
  }
});
