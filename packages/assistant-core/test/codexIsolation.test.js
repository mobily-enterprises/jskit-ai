import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodexAppServerIsolation,
  codexToolFreeConfiguration,
  readCodexToolFreeConfiguration
} from "../src/server/conversation/codexConfiguration.js";

// Carried from the original public helper bridge tests. Public profile, schema,
// prompt and request-settings assertions remain in that unchanged test file.
const MINIMUM_CODEX_VERSION = "0.151.0";
const POLICY_UNENFORCEABLE = "codex_policy_unenforceable";
const HELPER_DISABLED_FEATURES = Object.freeze([
  "apps",
  "artifact",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "code_mode_host",
  "computer_use",
  "current_time_reminder",
  "default_mode_request_user_input",
  "deferred_executor",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "psp",
  "recommended_plugins",
  "request_permissions_tool",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "sleep_tool",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "token_budget",
  "unified_exec",
  "unified_exec_zsh_fork",
  "view_image"
]);
const isolation = createCodexAppServerIsolation({
  clientName: "vibe64",
  minimumVersion: MINIMUM_CODEX_VERSION,
  disabledFeatures: HELPER_DISABLED_FEATURES
});

const HELPER_EXECUTION_CWD = "/runtime/vibe64/codex-helper/workspace";
const HELPER_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;

function helperExecutionProviderParts() {
  return {
    async currentHelperExecutionContext() {
      return {
        accountIdentitySignature: HELPER_ACCOUNT_IDENTITY_SIGNATURE,
        cwd: HELPER_EXECUTION_CWD,
        executionMode: "helper"
      };
    }
  };
}

function helperInventoryProvider({
  generation = 1,
  hooks = [],
  mcpServers = {},
  records = null,
  userAgent = `vibe64/${MINIMUM_CODEX_VERSION} (unit test)`
} = {}) {
  const calls = [];
  return {
    ...helperExecutionProviderParts(),
    calls,
    currentConnectionGeneration() {
      return generation;
    },
    currentServerInfo() {
      return { userAgent };
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: records || [{
          cwd: cwds[0],
          errors: [],
          hooks,
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: mcpServers
        }
      };
    }
  };
}

// The original application's prepare callback now supplies already authorized
// policy values. These fixtures exercise only the native ownership boundary.
async function prepareHelper({ provider }) {
  const enforcement = await isolation.inspect(provider, { effort: "low", summary: "none" });
  return { enforcement, settings: { config: enforcement.config, cwd: enforcement.executionCwd } };
}

function startHelper(options) {
  return isolation.start(options.provider, () => prepareHelper(options));
}

function resumeHelper(options) {
  return isolation.resume(options.provider, options.threadId, () => prepareHelper(options));
}

test("Codex helper inventories preserve immutable native isolation and read ordering", async () => {
  const provider = helperInventoryProvider({
    hooks: [{
      currentHash: "sha256:malicious-hook",
      enabled: true,
      handlerType: "command",
      isManaged: false,
      key: "/repo/worktree/.codex/hooks.json:stop:0:0",
      sourcePath: "/repo/worktree/.codex/hooks.json"
    }, {
      currentHash: "sha256:disabled-managed-hook",
      enabled: false,
      handlerType: "command",
      isManaged: true,
      key: "managed:disabled:0",
      sourcePath: "/etc/codex/hooks.json"
    }],
    mcpServers: {
      "danger.server": {
        command: "write-anywhere"
      },
      "quoted\"server": {
        command: "exfiltrate"
      }
    }
  });
  const prepared = await prepareHelper({ provider });

  assert.equal(prepared.enforcement.connectionGeneration, 1);
  assert.deepEqual(prepared.enforcement.mcpServerNames, [
    "danger.server",
    "quoted\"server"
  ]);
  assert.deepEqual(prepared.settings.config.mcp_servers, {
    "danger.server": {
      enabled: false
    },
    "quoted\"server": {
      enabled: false
    }
  });
  assert.deepEqual(prepared.settings.config.hooks, {
    state: {
      "/repo/worktree/.codex/hooks.json:stop:0:0": {
        enabled: false
      }
    }
  });
  assert.equal(prepared.settings.config.features.shell_tool, false);
  assert.equal(prepared.settings.config.features.plugins, false);
  assert.equal(prepared.settings.config.features.apps, false);
  assert.equal(prepared.settings.config.features.browser_use, false);
  assert.equal(prepared.settings.config.features.computer_use, false);
  assert.equal(prepared.settings.config.features.hooks, false);
  assert.equal(prepared.settings.config.features.multi_agent, false);
  assert.equal(prepared.settings.config.features.tool_suggest, false);
  assert.equal(prepared.settings.config.features.view_image, false);
  assert.equal(prepared.settings.config.features.current_time_reminder, false);
  assert.equal(prepared.settings.config.features.sleep_tool, false);
  assert.equal(prepared.settings.config.features.token_budget, false);
  assert.deepEqual(prepared.settings.config.notify, []);
  assert.equal(prepared.settings.config.orchestrator.mcp.enabled, false);
  assert.equal(prepared.settings.config.orchestrator.skills.enabled, false);
  assert.equal(prepared.settings.config.skills.include_instructions, false);
  assert.equal(prepared.settings.config.include_apps_instructions, false);
  assert.equal(prepared.settings.config.include_permissions_instructions, false);
  assert.equal(prepared.settings.config.include_environment_context, false);
  assert.equal(prepared.settings.config.project_doc_max_bytes, 0);
  assert.equal(Object.isFrozen(prepared.settings.config), true);
  assert.equal(Object.isFrozen(prepared.settings.config.mcp_servers["danger.server"]), true);

  assert.deepEqual(provider.calls, [[
    "readConfig",
    {
      cwd: HELPER_EXECUTION_CWD,
      includeLayers: false
    }
  ], [
    "listHooks",
    [HELPER_EXECUTION_CWD]
  ]]);
});

test("Codex helper accepts the minimum and newer patch, minor and major versions with isolation", async () => {
  const [major, minor, patch] = MINIMUM_CODEX_VERSION.split(".").map(Number);
  for (const version of [
    MINIMUM_CODEX_VERSION,
    `${major}.${minor}.${patch + 1}`,
    `${major}.${minor}.${patch + 10}`,
    `${major}.${minor + 1}.0`,
    `${major}.${minor + 10}.0`,
    `${major + 1}.0.0`
  ]) {
    const provider = helperInventoryProvider({ userAgent: `vibe64/${version} (unit test)` });
    assert.deepEqual(isolation.assertCompatibility(provider), {
      minimumVersion: MINIMUM_CODEX_VERSION,
      version
    });
    const prepared = await prepareHelper({
      provider
    });
    assert.equal(prepared.settings.config.features.shell_tool, false, version);
    assert.equal(prepared.settings.config.features.hooks, false, version);
    assert.equal(provider.calls.length, 2, version);
  }
});

test("Codex helper rejects versions below the minimum before inventory", async () => {
  const minimumParts = MINIMUM_CODEX_VERSION.split(".").map(Number);
  for (const [index, part] of minimumParts.entries()) {
    if (part === 0) {
      continue;
    }
    const olderParts = [...minimumParts];
    olderParts[index] -= 1;
    olderParts.fill(999, index + 1);
    const version = olderParts.join(".");
    const provider = helperInventoryProvider({ userAgent: `vibe64/${version} (unit test)` });
    await assert.rejects(prepareHelper({
      provider
    }), (error) => {
      assert.equal(error.code, POLICY_UNENFORCEABLE);
      assert.equal(error.minimumVersion, MINIMUM_CODEX_VERSION);
      assert.equal(error.actualVersion, version);
      assert.equal(error.message, `Codex helper execution requires app-server ${MINIMUM_CODEX_VERSION} or newer; current version is ${version}. Update Codex and retry.`);
      return true;
    });
    assert.deepEqual(provider.calls, [], version);
  }
});

test("Codex helper fails closed before inventory when app-server cannot enforce the policy", async () => {
  for (const [label, provider] of [
    ["missing version API", {
      ...helperInventoryProvider(),
      currentServerInfo: undefined
    }],
    ["malformed version", helperInventoryProvider({
      userAgent: "vibe64/development"
    })],
    ["spoofed product", helperInventoryProvider({
      userAgent: `attacker/999.0.0 vibe64/${MINIMUM_CODEX_VERSION}`
    })],
    ["leading zero", helperInventoryProvider({
      userAgent: `vibe64/0${MINIMUM_CODEX_VERSION}`
    })],
    ["control character", helperInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION}\nattacker/999.0.0`
    })],
    ["oversized user agent", helperInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION} ${"x".repeat(600)}`
    })],
    ["prerelease version", helperInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION}-beta.1 (unit test)`
    })],
    ["unsafe version component", helperInventoryProvider({
      userAgent: `vibe64/${Number.MAX_SAFE_INTEGER + 1}.0.0 (unit test)`
    })]
  ]) {
    await assert.rejects(prepareHelper({
      provider
    }), (error) => {
      assert.equal(
        error.code,
        POLICY_UNENFORCEABLE,
        label
      );
      assert.equal(error.minimumVersion, MINIMUM_CODEX_VERSION, label);
      assert.match(error.message, /Update Codex and retry/u, label);
      return true;
    });
    assert.deepEqual(provider.calls, [], label);
  }

  const supported = helperInventoryProvider();
  await prepareHelper({
    provider: supported
  });
  assert.equal(supported.calls.length, 2);
});

test("Codex helper fails closed for managed hooks and incomplete hook discovery", async () => {
  await assert.rejects(prepareHelper({
    provider: helperInventoryProvider({
      hooks: [{
        currentHash: "sha256:managed-hook",
        enabled: true,
        handlerType: "command",
        isManaged: true,
        key: "managed:stop:0",
        sourcePath: "/etc/codex/hooks.json"
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /cannot disable a managed hook/u);
    return true;
  });

  await assert.rejects(prepareHelper({
    provider: helperInventoryProvider({
      records: [{
        cwd: HELPER_EXECUTION_CWD,
        errors: [{ message: "malformed hook configuration" }],
        hooks: [],
        warnings: []
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /hook discovery has errors/u);
    assert.doesNotMatch(JSON.stringify(error), /malformed hook configuration/u);
    return true;
  });
});

test("Codex helper inventories MCP servers independently of a large unrelated native model catalogue", async () => {
  const provider = helperInventoryProvider({ mcpServers: { example: { command: "example" } } });
  const read = provider.readConfig;
  provider.readConfig = async (params) => {
    const response = await read(params);
    response.config.model_catalog = { notes: "catalogue".repeat(100_000) };
    return response;
  };
  const prepared = await prepareHelper({
    provider
  });
  assert.deepEqual(prepared.enforcement.mcpServerNames, ["example"]);
  assert.equal(prepared.settings.config.mcp_servers.example.enabled, false);
  assert.equal(prepared.settings.config.model_catalog, undefined);
});

test("Codex helper bounds config and hook inventories without exposing their payloads", async () => {
  const cases = [{
    label: "too many MCP servers",
    provider: helperInventoryProvider({
      mcpServers: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
        `server-${index}`,
        { command: "unsafe" }
      ]))
    })
  }, {
    label: "oversized MCP configuration",
    provider: helperInventoryProvider({
      mcpServers: {
        malicious: {
          secret: `config-secret-${"x".repeat(300 * 1024)}`
        }
      }
    })
  }, {
    label: "oversized hook inventory",
    provider: helperInventoryProvider({
      hooks: [{
        currentHash: "hash",
        enabled: false,
        handlerType: "command",
        isManaged: false,
        key: "hook-key",
        sourcePath: `hook-secret-${"x".repeat(520 * 1024)}`
      }]
    })
  }];

  for (const { label, provider } of cases) {
    await assert.rejects(prepareHelper({
      provider
    }), (error) => {
      assert.equal(
        error.code,
        POLICY_UNENFORCEABLE,
        label
      );
      assert.doesNotMatch(JSON.stringify(error), /config-secret|hook-secret/u, label);
      return true;
    });
  }
});

test("Codex helper deletes a new thread when execution surfaces change during startup", async () => {
  const calls = [];
  let inventory = 0;
  const provider = {
    ...helperExecutionProviderParts(),
    currentConnectionGeneration() {
      return 4;
    },
    currentServerInfo() {
      return { userAgent: `vibe64/${MINIMUM_CODEX_VERSION} (unit test)` };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      inventory += 1;
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: inventory === 1 ? {} : {
            "late-write-tool": {
              command: "write-anywhere"
            }
          }
        }
      };
    },
    async startThread(params) {
      calls.push(["startThread", params]);
      return {
        id: "helper-thread"
      };
    }
  };

  await assert.rejects(startHelper({
    provider
  }), (error) => {
    assert.equal(
      error.code,
      POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /execution surfaces changed/u);
    return true;
  });
  assert.deepEqual(calls.at(-1), ["deleteThread", "helper-thread"]);
});

test("Codex helper reports retryable ownership when post-start deletion fails", async () => {
  let inventory = 0;
  const provider = helperInventoryProvider();
  provider.readConfig = async () => {
    inventory += 1;
    return {
      config: {
        mcp_servers: inventory === 1 ? {} : {
          "late-write-tool": {
            command: "write-anywhere"
          }
        }
      }
    };
  };
  provider.startThread = async () => ({ id: "unclean-helper-thread" });
  provider.deleteThread = async () => {
    throw new Error("delete transport failed");
  };

  await assert.rejects(startHelper({
    provider
  }), (error) => {
    assert.equal(
      error.code,
      POLICY_UNENFORCEABLE
    );
    assert.equal(error.codexAppServerHelperThreadCleanupRequired, true);
    assert.equal(error.codexAppServerHelperThreadId, "unclean-helper-thread");
    assert.equal(error.cleanupFailed, true);
    assert.match(error.message, /could not retire a helper thread/u);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("Codex helper safely reapplies isolation when resuming a controller-owned thread", async () => {
  const calls = [];
  const provider = {
    ...helperExecutionProviderParts(),
    currentConnectionGeneration() {
      return 7;
    },
    currentServerInfo() {
      return { userAgent: `vibe64/${MINIMUM_CODEX_VERSION} (unit test)` };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: {
            filesystem: {
              command: "unsafe-fixture"
            }
          }
        }
      };
    },
    async resumeThread(threadId, params) {
      calls.push(["resumeThread", threadId, params]);
      return {
        id: threadId
      };
    }
  };

  const result = await resumeHelper({
    provider,
    threadId: "registered-helper-thread"
  });

  assert.equal(result.threadId, "registered-helper-thread");
  assert.equal(calls.filter(([method]) => method === "readConfig").length, 2);
  assert.equal(calls.filter(([method]) => method === "listHooks").length, 2);
  const resumeCall = calls.find(([method]) => method === "resumeThread");
  assert.equal(resumeCall[1], "registered-helper-thread");
  assert.equal(resumeCall[2].config.mcp_servers.filesystem.enabled, false);
  assert.equal(calls.some(([method]) => method === "deleteThread"), false);
});

// Supplementary ownership-boundary checks, alongside the original assertions.
test("helper inventory rejects a reconnect at either sequential read boundary", async () => {
  for (const changedAt of ["readConfig", "listHooks"]) {
    const provider = helperInventoryProvider();
    let generation = 1;
    provider.currentConnectionGeneration = () => generation;
    const original = provider[changedAt];
    provider[changedAt] = async (...args) => {
      const result = await original(...args);
      generation++;
      return result;
    };
    await assert.rejects(prepareHelper({ provider }), /reconnected during helper policy verification/);
    assert.deepEqual(provider.calls.map(([method]) => method),
      changedAt === "readConfig" ? ["readConfig"] : ["readConfig", "listHooks"]);
  }
});

test("helper thread guards precede host preparation and preserve unsuccessful receipt ownership", async () => {
  const calls = [];
  const prepare = async () => { calls.push("prepare"); return { settings: {} }; };
  await assert.rejects(isolation.start({ startThread() {} }, prepare), /cannot own and clean up/);
  await assert.rejects(isolation.resume({ resumeThread() {} }, "thread", prepare), /cannot safely resume and clean up/);
  await assert.rejects(isolation.resume({ resumeThread() {}, deleteThread() {} }, "", prepare), /controller-owned thread id/);
  assert.deepEqual(calls, []);
  await assert.rejects(isolation.start({
    async startThread() { calls.push("start"); return {}; },
    async deleteThread() { calls.push("delete"); }
  }, prepare), /did not return a helper thread id/);
  assert.deepEqual(calls, ["prepare", "start"]);
});

test("helper start and resume retire exact threads after account, generation, directory or hook changes", async () => {
  for (const operation of ["start", "resume"]) {
    for (const changed of ["account", "generation", "cwd", "hook"]) {
      const provider = helperInventoryProvider();
      let after = false;
      const deleted = [];
      provider.currentConnectionGeneration = () => after && changed === "generation" ? 2 : 1;
      provider.currentHelperExecutionContext = async () => ({
        accountIdentitySignature: after && changed === "account" ? `sha256:${"b".repeat(64)}` : HELPER_ACCOUNT_IDENTITY_SIGNATURE,
        cwd: after && changed === "cwd" ? "/runtime/other-helper/workspace" : HELPER_EXECUTION_CWD,
        executionMode: "helper"
      });
      const list = provider.listHooks;
      provider.listHooks = async (...args) => {
        const result = await list(...args);
        if (after && changed === "hook") result.data[0].hooks.push({ key: "new-hook", enabled: false });
        return result;
      };
      provider.deleteThread = async threadId => { deleted.push(threadId); };
      provider.startThread = async () => { after = true; return { id: "exact-helper" }; };
      provider.resumeThread = async threadId => { after = true; return { id: threadId }; };
      await assert.rejects(operation === "start"
        ? startHelper({ provider })
        : resumeHelper({ provider, threadId: "exact-helper" }), error => {
        assert.match(error.message, /execution surfaces changed/);
        assert.equal(error.codexAppServerHelperThreadId, "exact-helper");
        assert.equal(error.codexAppServerHelperThreadRetired, true);
        return true;
      });
      assert.deepEqual(deleted, ["exact-helper"], `${operation} ${changed}`);
    }
  }
});

test("helper isolation requires an absolute dedicated account context before inventory", async () => {
  for (const context of [
    { accountIdentitySignature: HELPER_ACCOUNT_IDENTITY_SIGNATURE, cwd: HELPER_EXECUTION_CWD, executionMode: "interactive" },
    { accountIdentitySignature: "unverified", cwd: HELPER_EXECUTION_CWD, executionMode: "helper" },
    { accountIdentitySignature: HELPER_ACCOUNT_IDENTITY_SIGNATURE, cwd: "relative", executionMode: "helper" }
  ]) {
    const provider = helperInventoryProvider();
    provider.currentHelperExecutionContext = async () => context;
    await assert.rejects(prepareHelper({ provider }), /runtime isolation could not be verified/);
    assert.deepEqual(provider.calls, []);
  }
});

test("common tool-free configuration uses verified inventories and a separate mutable policy copy", async () => {
  const provider = helperInventoryProvider({
    hooks: [{ key: "ambient", enabled: true }],
    mcpServers: { files: { command: "ambient" } }
  });
  const configResult = await provider.readConfig({ cwd: HELPER_EXECUTION_CWD });
  const hookResult = await provider.listHooks([HELPER_EXECUTION_CWD]);
  const options = { configResult, hookResult, workdir: HELPER_EXECUTION_CWD };
  const verified = isolation.configuration(options);
  assert.equal(isolation.hasConfiguration(verified), true);
  assert.equal(createCodexAppServerIsolation().hasConfiguration(verified), false);
  assert.equal(Object.isFrozen(verified.hooks.state.ambient), true);
  const common = codexToolFreeConfiguration(options);
  assert.equal(isolation.hasConfiguration(common), false);
  assert.deepEqual(common.mcp_servers, verified.mcp_servers);
  assert.deepEqual(common.hooks, verified.hooks);
  assert.equal(Object.hasOwn(common, "model_reasoning_summary"), false);
  assert.equal(Object.hasOwn(common.features, "sleep_tool"), false);
  common.features.goals = true;
  common.shell_environment_policy.set.PATH = "/host/bin";
  common.hooks.state.ambient.enabled = true;
  assert.equal(verified.features.goals, false);
  assert.deepEqual(verified.shell_environment_policy.set, {});
  assert.equal(verified.hooks.state.ambient.enabled, false);
  assert.throws(() => codexToolFreeConfiguration({
    ...options, hookResult: { data: [{ cwd: `${HELPER_EXECUTION_CWD}/../workspace`, hooks: [], errors: [] }] }
  }), /incomplete hook inventory/);
});

test("standalone helper version policy uses its own literal client name", () => {
  const native = createCodexAppServerIsolation();
  assert.deepEqual(native.assertCompatibility({ currentServerInfo: () => ({ userAgent: "jskit/0.151.0 (native)" }) }), {
    minimumVersion: "0.151.0", version: "0.151.0"
  });
  const named = createCodexAppServerIsolation({ clientName: "host+integration", minimumVersion: "1.2.3" });
  assert.deepEqual(named.assertCompatibility({ currentServerInfo: () => ({ userAgent: "host+integration/1.2.3" }) }), {
    minimumVersion: "1.2.3", version: "1.2.3"
  });
  assert.throws(() => named.assertCompatibility({ currentServerInfo: () => ({ userAgent: "hostintegration/99.0.0" }) }), /unrecognised app-server version/);
});

test("ephemeral configuration reads inventories in parallel and preserves the original native tool settings", async () => {
  const workdir = "/host/ephemeral";
  const provider = helperInventoryProvider({
    userAgent: `jskit/${MINIMUM_CODEX_VERSION}`,
    hooks: [{ key: "ambient", enabled: true }],
    mcpServers: { files: { command: "ambient" } }
  });
  provider.currentHelperExecutionContext = () => assert.fail("An ephemeral inventory does not select a Helper workspace.");
  const release = Promise.withResolvers();
  const readConfig = provider.readConfig;
  provider.readConfig = async params => {
    const result = await readConfig(params);
    await release.promise;
    return result;
  };
  const pending = readCodexToolFreeConfiguration(provider, workdir);
  try {
    assert.deepEqual(provider.calls, [
      ["readConfig", { cwd: workdir, includeLayers: false }],
      ["listHooks", [workdir]]
    ]);
  } finally {
    release.resolve();
  }
  const config = await pending;
  // Native configuration assertions carried from the original Public
  // non-project ephemeral conversation case; its thread policy stays there.
  assert.equal(config.features.shell_tool, false);
  assert.equal(config.features.web_search, undefined);
  assert.equal(config.web_search, "disabled");
  assert.deepEqual(config.mcp_servers, { files: { enabled: false } });
  assert.deepEqual(config.hooks.state, { ambient: { enabled: false } });
  assert.deepEqual(config.shell_environment_policy, { inherit: "none", set: {} });
  assert.equal(Object.isFrozen(config), false);
});

test("ephemeral configuration preserves compatibility and positive-generation admission before reads", async () => {
  const provider = helperInventoryProvider();
  const policyError = new Error("Existing host compatibility policy rejected the provider.");
  await assert.rejects(readCodexToolFreeConfiguration(provider, "/host/ephemeral", value => {
    assert.equal(value, provider);
    throw policyError;
  }), error => error === policyError);
  assert.deepEqual(provider.calls, []);
  for (const missing of ["readConfig", "listHooks", "currentConnectionGeneration"]) {
    const provider = helperInventoryProvider();
    provider[missing] = undefined;
    await assert.rejects(readCodexToolFreeConfiguration(provider, "/host/ephemeral", isolation.assertCompatibility), /cannot verify tool isolation/);
    assert.deepEqual(provider.calls, []);
  }
  for (const generation of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const provider = helperInventoryProvider({ generation });
    await assert.rejects(readCodexToolFreeConfiguration(provider, "/host/ephemeral", isolation.assertCompatibility), /no active connection/);
    assert.deepEqual(provider.calls, []);
  }
});

test("ephemeral configuration rejects either read's connection change and preserves native read errors", async () => {
  for (const changedAt of ["readConfig", "listHooks"]) {
    const provider = helperInventoryProvider();
    let generation = 1;
    provider.currentConnectionGeneration = () => generation;
    const read = provider[changedAt];
    provider[changedAt] = async (...args) => {
      const result = await read(...args);
      generation++;
      return result;
    };
    await assert.rejects(readCodexToolFreeConfiguration(provider, "/host/ephemeral", isolation.assertCompatibility), /reconnected while verifying/);
    assert.deepEqual(provider.calls.map(([method]) => method), ["readConfig", "listHooks"]);
  }
  const provider = helperInventoryProvider();
  const readError = new Error("Native configuration read failed.");
  provider.readConfig = async () => { throw readError; };
  await assert.rejects(readCodexToolFreeConfiguration(provider, "/host/ephemeral", isolation.assertCompatibility), error => error === readError);
  assert.deepEqual(provider.calls, [["listHooks", ["/host/ephemeral"]]]);
});
