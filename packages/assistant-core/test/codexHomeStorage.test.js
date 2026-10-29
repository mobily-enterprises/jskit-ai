import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  codexDisabledProcessFeatureArguments,
  codexHomeDisposablePaths
} from "../src/server/hosts/codexConfiguration.js";

async function home(t, entries) {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, ".codex");
  for (const entry of entries) {
    const target = path.join(codexHome, entry);
    if (entry.endsWith("/")) await mkdir(target, { recursive: true });
    else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "x"); }
  }
  return { root, codexHome };
}

const kept = ["auth.json", "config.toml", "models.json", "state_5.sqlite", "goals_1.sqlite", "memories_1.sqlite",
  "queue_1.sqlite", "thread_history_1.sqlite", "sessions/2026/10/rollout.jsonl", "plugins/cache/installed/",
  ".tmp/marketplaces/", ".tmp/rollout-maintenance.lock", "cache/unrelated/"];
const pluginAndApp = [".tmp/plugins/", ".tmp/plugins.sha", ".tmp/plugins.sync.lock", ".tmp/plugins-clone-a1/",
  ".tmp/plugins-backup-b2/", ".tmp/git-c3/", ".tmp/bundled-marketplaces/", "cache/remote_plugin_catalog/",
  "cache/codex_apps_tools/", "cache/codex_apps_server_info/", "cache/codex_app_directory/", "cache/bundled_plugin_exclusions/"];

test("Codex processes are launched with plugin and app background work and the shared background server off", () => {
  assert.deepEqual(codexDisabledProcessFeatureArguments(), ["-c", "features.plugins=false", "-c", "features.apps=false",
    "-c", "features.daemon_auto_start=false"]);
});

test("a used home loses only plugin and app caches; a retired home also loses its runtime-only data", async (t) => {
  const { codexHome } = await home(t, [...kept, ...pluginAndApp, "logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm", "tmp/arg0/"]);
  const strip = (entry) => path.join(codexHome, entry.replace(/\/$/u, ""));
  assert.deepEqual(await codexHomeDisposablePaths(codexHome), pluginAndApp.map(strip).sort());
  assert.deepEqual(await codexHomeDisposablePaths(codexHome, { retired: true }),
    [".tmp", "cache", "logs_2.sqlite", "logs_2.sqlite-shm", "logs_2.sqlite-wal", "tmp"].map(strip).sort());
});

test("missing, linked and relative homes list nothing they do not own", async (t) => {
  const { root, codexHome } = await home(t, ["cache/remote_plugin_catalog/"]);
  assert.deepEqual(await codexHomeDisposablePaths(path.join(root, "missing")), []);
  const linked = path.join(root, "linked");
  await symlink(codexHome, linked);
  assert.deepEqual(await codexHomeDisposablePaths(linked), []);
  assert.deepEqual(await codexHomeDisposablePaths(linked, { retired: true }), []);
  const elsewhere = path.join(root, "elsewhere");
  await mkdir(path.join(elsewhere, ".tmp/plugins"), { recursive: true });
  await rm(path.join(codexHome, "cache"), { recursive: true });
  await symlink(path.join(elsewhere, ".tmp"), path.join(codexHome, ".tmp"));
  assert.deepEqual(await codexHomeDisposablePaths(codexHome), [], "a linked .tmp is not followed");
  assert.deepEqual(await codexHomeDisposablePaths(codexHome, { retired: true }), [path.join(codexHome, ".tmp")]);
  await assert.rejects(codexHomeDisposablePaths(".codex"), /absolute Codex home/u);
});
