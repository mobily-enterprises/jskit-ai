import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("assistant services compose with supplied repositories without database imports", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";

    registerHooks({ resolve(specifier, context, nextResolve) {
      if (["@jskit-ai/database-runtime", "knex"].some((name) => specifier === name || specifier.startsWith(name + "/"))) {
        throw new Error("Unexpected database import: " + specifier);
      }
      return nextResolve(specifier, context);
    } });

    for (const name of ["@jskit-ai/database-runtime", "knex"]) {
      await assert.rejects(() => import(name), /Unexpected database import/);
    }

    const { createAssistantRuntime } = await import(${JSON.stringify(new URL("../src/server/createAssistantRuntime.js", import.meta.url).href)});
    let record = { targetSurfaceId: "home", workspaceId: null, settings: { systemPrompt: "Initial prompt" } };
    const scope = { targetSurfaceId: "home", workspaceId: null };
    const repositories = {
      config: {
        async findByScope(input) {
          assert.deepEqual(input, scope);
          return record;
        },
        async upsertByScope({ patch, ...input }) {
          assert.deepEqual(input, scope);
          record = { ...record, settings: patch };
          return record;
        },
        createDefaultRecord() { throw new Error("The supplied record should be used."); }
      },
      conversations: {},
      messages: {},
      turnRequests: {}
    };
    const assistant = createAssistantRuntime({
      repositories,
      actionCatalogue: { listDefinitions: () => [], async execute() {} },
      config: {
        surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
        assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
      },
      env: {}
    });

    for (const [name, repository] of Object.entries(repositories)) {
      assert.equal(assistant.repositories[name], repository);
    }
    const options = { context: { actor: { id: 23 } } };
    assert.equal(await assistant.services.config.getSettings({ targetSurfaceId: "home" }, options), record);
    const updated = await assistant.services.config.updateSettings(
      { targetSurfaceId: "home" }, { systemPrompt: "Updated prompt" }, options
    );
    assert.equal(updated, record);
    assert.equal(await assistant.services.config.resolveSystemPrompt({ targetSurfaceId: "home" }), "Updated prompt");
    assert.equal(typeof assistant.services.chat.streamChat, "function");
    assert.equal(typeof assistant.services.transcript.getConversationMessagesForUser, "function");
    assert.equal(typeof assistant.aiClientFactory.resolveClient, "function");
    assert.equal(typeof assistant.toolCatalog.resolveToolSet, "function");
  `], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
});
