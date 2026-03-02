import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadServerAppExtensions } from "../../server/app/loadExtensions.server.js";

async function withTempAppDir(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-server-ext-"));
  const appDir = tempDir;
  await fs.mkdir(path.join(appDir, "extensions.d"), { recursive: true });
  await fs.mkdir(path.join(appDir, "settings.extensions.d"), { recursive: true });
  await fs.mkdir(path.join(appDir, "workers.extensions.d"), { recursive: true });

  try {
    return await callback({ appDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

test("loadServerAppExtensions sorts deterministically and composes runtime arrays", async () => {
  await withTempAppDir(async ({ appDir }) => {
    await writeFile(
      path.join(appDir, "extensions.d", "20-beta.server.js"),
      `export default { id: "beta", order: 20, realtimeTopics: ["workspace.beta"] };`
    );
    await writeFile(
      path.join(appDir, "extensions.d", "10-alpha.server.js"),
      `export default { id: "alpha", order: 10, realtimeTopics: ["workspace.alpha"] };`
    );
    await writeFile(
      path.join(appDir, "settings.extensions.d", "10-settings.server.js"),
      `export default { id: "settings", fields: [{ id: "theme" }] };`
    );
    await writeFile(
      path.join(appDir, "workers.extensions.d", "10-worker.server.js"),
      `export default { id: "worker", workerRuntime: { concurrency: 3 } };`
    );

    const result = await loadServerAppExtensions({ appDir });
    assert.deepEqual(
      result.server.map((entry) => entry.id),
      ["alpha", "beta"]
    );
    assert.deepEqual(result.runtime.realtimeTopics, ["workspace.alpha", "workspace.beta"]);
    assert.deepEqual(result.runtime.settingsFields, [{ id: "theme" }]);
    assert.equal(result.runtime.workerRuntime.concurrency, 3);
  });
});

test("loadServerAppExtensions rejects duplicate extension ids", async () => {
  await withTempAppDir(async ({ appDir }) => {
    await writeFile(path.join(appDir, "extensions.d", "10-one.server.js"), `export default { id: "dup" };`);
    await writeFile(path.join(appDir, "extensions.d", "20-two.server.js"), `export default { id: "dup" };`);

    await assert.rejects(() => loadServerAppExtensions({ appDir }), /duplicated/);
  });
});

test("loadServerAppExtensions rejects unknown keys", async () => {
  await withTempAppDir(async ({ appDir }) => {
    await writeFile(
      path.join(appDir, "extensions.d", "10-invalid.server.js"),
      `export default { id: "invalid", unknownKey: true };`
    );

    await assert.rejects(() => loadServerAppExtensions({ appDir }), /unsupported key "unknownKey"/);
  });
});

test("loadServerAppExtensions rejects duplicate settings field ids", async () => {
  await withTempAppDir(async ({ appDir }) => {
    await writeFile(
      path.join(appDir, "settings.extensions.d", "10-one.server.js"),
      `export default { id: "s1", fields: [{ id: "alertEmail" }] };`
    );
    await writeFile(
      path.join(appDir, "settings.extensions.d", "20-two.server.js"),
      `export default { id: "s2", fields: [{ id: "alertEmail" }] };`
    );

    await assert.rejects(() => loadServerAppExtensions({ appDir }), /settings field id "alertEmail" is duplicated/);
  });
});
