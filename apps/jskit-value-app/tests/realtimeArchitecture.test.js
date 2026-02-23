import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SOCKET_IMPORT_ALLOWLIST = new Set([
  path.resolve(ROOT_DIR, "server/realtime/registerSocketIoRealtime.js"),
  path.resolve(ROOT_DIR, "src/services/realtime/realtimeRuntime.js")
]);

const FEATURE_REALTIME_FILES = [
  "server/modules/projects/controller.js",
  "server/modules/workspace/controller.js",
  "server/modules/ai/service.js",
  "server/modules/ai/tools/workspaceRename.tool.js"
];

async function collectJsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsFiles(entryPath);
      results.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(entryPath);
    }
  }

  return results;
}

test("socket transport imports remain isolated to realtime runtime modules", async () => {
  const files = [
    ...(await collectJsFiles(path.resolve(ROOT_DIR, "server"))),
    ...(await collectJsFiles(path.resolve(ROOT_DIR, "src")))
  ];

  const violations = [];
  const socketImportPattern =
    /from\s+["'](?:socket\.io|socket\.io-client|@socket\.io\/redis-streams-adapter)["']|import\s*\(\s*["'](?:socket\.io|socket\.io-client|@socket\.io\/redis-streams-adapter)["']\s*\)/;

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    if (!socketImportPattern.test(content)) {
      continue;
    }
    if (!SOCKET_IMPORT_ALLOWLIST.has(filePath)) {
      violations.push(path.relative(ROOT_DIR, filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test("feature modules use realtime publisher facade instead of direct service publish calls", async () => {
  const directPublishPattern = /realtimeEventsService\s*\.\s*publish(?:Workspace|Project)Event\s*\(/;
  const violations = [];

  for (const relativePath of FEATURE_REALTIME_FILES) {
    const absolutePath = path.resolve(ROOT_DIR, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    if (directPublishPattern.test(content)) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});
