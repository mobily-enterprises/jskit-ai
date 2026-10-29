import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

// At process start Codex syncs the openai/plugins repository into `.tmp/plugins`
// and downloads plugin, app and connector catalogues into `cache/`, roughly
// 100-250 MB per home, refreshed and never pruned. No JSKIT conversation uses
// plugins or apps (helper and tool-free threads also disable them per thread),
// so every Codex process JSKIT launches turns both off. Codex's terminal also
// starts a shared app-server daemon by default (`daemon_auto_start`, 0.163),
// with a detached updater that keeps it running after the terminal closes; a
// JSKIT terminal runs its own process or its host's app-server instead.
const CODEX_DISABLED_PROCESS_FEATURES = Object.freeze(["plugins", "apps", "daemon_auto_start"]);

export function codexDisabledProcessFeatureArguments() {
  return CODEX_DISABLED_PROCESS_FEATURES.flatMap((feature) => ["-c", `features.${feature}=false`]);
}

// What those features leave behind (Codex 0.162: core-plugins startup_sync.rs,
// git_policy.rs, marketplace_policy.rs and remote_catalog_cache.rs; connectors
// directory_cache.rs and connector_runtime persistence.rs). User-installed
// plugins under `plugins/` and configured marketplaces are not listed.
const PLUGIN_AND_APP_ENTRIES = Object.freeze([
  [".tmp", /^(?:plugins(?:$|[.-])|git-|bundled-marketplaces$)/u],
  ["cache", /^(?:remote_plugin_catalog|codex_apps_tools|codex_apps_server_info|codex_app_directory|bundled_plugin_exclusions)$/u]
]);

// A home that will not launch again keeps its auth, config, catalogue, sessions
// and state/goal/memory/queue/thread-history databases, which retained
// conversations may still read. Its diagnostic log database and temporary and
// cache directories serve only a running process; Codex prunes the log database
// (10 days, 64 MiB) only while it runs.
const RETIRED_HOME_ENTRIES = /^(?:logs_\d+\.sqlite(?:-wal|-shm)?|\.tmp|cache|tmp)$/u;

async function directoryNames(directory) {
  try {
    // Never follow a linked home or subdirectory.
    if (!(await lstat(directory)).isDirectory()) return [];
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Existing Codex-owned entries in `codexHome` that no JSKIT-launched Codex
 * uses: plugin and app caches, or with `retired: true` everything runtime-only
 * in a home that will not launch again. Returns sorted absolute paths; a link is
 * returned as itself. Remove them only while no Codex process uses the home.
 */
export async function codexHomeDisposablePaths(codexHome, { retired = false } = {}) {
  if (typeof codexHome !== "string" || !path.isAbsolute(codexHome)) {
    throw new TypeError("An absolute Codex home is required.");
  }
  const found = [];
  const names = await directoryNames(codexHome);
  if (retired) {
    for (const name of names) {
      if (RETIRED_HOME_ENTRIES.test(name)) found.push(path.join(codexHome, name));
    }
  } else if (names.length) {
    for (const [directory, pattern] of PLUGIN_AND_APP_ENTRIES) {
      for (const name of await directoryNames(path.join(codexHome, directory))) {
        if (pattern.test(name)) found.push(path.join(codexHome, directory, name));
      }
    }
  }
  return found.sort();
}
