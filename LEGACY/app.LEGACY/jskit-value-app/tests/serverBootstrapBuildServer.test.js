import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

const SERVER_ENTRY_URL = new URL("../server.js", import.meta.url).href;

function runBuildServer({ envOverrides = {}, repositoryConfigOverrides = null } = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(
      `
        import { parentPort } from "node:worker_threads";
        const repositoryConfigOverrides = ${JSON.stringify(repositoryConfigOverrides)};
        if (repositoryConfigOverrides && typeof repositoryConfigOverrides === "object") {
          globalThis.__JSKIT_TEST_REPOSITORY_CONFIG_OVERRIDE__ = repositoryConfigOverrides;
        }

        try {
          const serverModule = await import(${JSON.stringify(SERVER_ENTRY_URL)});
          const app = await serverModule.buildServer({ frontendBuildAvailable: false });
          await app.close();
          parentPort.postMessage({ ok: true });
        } catch (error) {
          parentPort.postMessage({
            ok: false,
            error: String(error?.stack || error?.message || error || "")
          });
        }
      `,
      {
        eval: true,
        type: "module",
        env: {
          ...process.env,
          NODE_ENV: "test",
          APP_PUBLIC_URL: "https://app.example.test",
          AI_API_KEY: "test_ai_key",
          ...envOverrides
        }
      }
    );

    worker.once("message", (result) => {
      resolve(result);
    });

    worker.once("error", (error) => {
      resolve({
        ok: false,
        error: String(error?.stack || error?.message || error || "")
      });
    });
  });
}

test("server buildServer bootstrap succeeds and closes cleanly", async () => {
  const result = await runBuildServer({
    repositoryConfigOverrides: {
      billing: {
        enabled: false
      }
    }
  });

  assert.equal(result.ok, true, String(result.error || ""));
});
