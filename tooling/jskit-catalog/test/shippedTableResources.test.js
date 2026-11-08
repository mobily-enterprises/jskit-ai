import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import knexLib from "knex";
import { isTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";

const PACKAGES = fileURLToPath(new URL("../../../packages/", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  }));
  return nested.flat();
}

// A module's table resources: those it exports, in a list or an object it exports, or answered by an exported
// function named for them (agentResources()).
function tableResourcesOf(namespace) {
  const found = [];
  const collect = (value) => {
    if (isTableResource(value)) found.push(value);
    else if (Array.isArray(value)) value.forEach((item) => isTableResource(item) && found.push(item));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => isTableResource(item) && found.push(item));
  };
  for (const [name, value] of Object.entries(namespace)) {
    // readable-check: allow method-probe - input validation: a module export may be a resource factory
    collect(typeof value === "function" && /Resources$/u.test(name) ? value() : value);
  }
  return found;
}

// Each package's tables are owned on every run whatever its database, so a table resource the resource runtime
// refuses fails here, not only in a package whose own data tests run on one database.
test("every table resource a JSKIT package ships can be owned", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  const runtime = await createTestResourceRuntime({ knex });
  const owned = [];
  for (const packageName of (await readdir(PACKAGES)).sort()) {
    const resources = new Map();
    for (const file of await sourceFiles(path.join(PACKAGES, packageName, "src"))) {
      const source = await readFile(file, "utf8");
      if (!source.includes("defineTableResource(") || file.endsWith(path.join("resource-core", "src", "shared", "tableResource.js"))) continue;
      for (const resource of tableResourcesOf(await import(pathToFileURL(file).href))) resources.set(resource.name, resource);
    }
    if (resources.size === 0) continue;
    await assert.doesNotReject(runtime.own(`${packageName}.test`, [...resources.values()]), `${packageName}'s table resources`);
    owned.push(...resources.keys());
  }
  // The packages whose tables JSKIT ships, each found: a package that stops being found would pass silently.
  for (const name of ["agentRuns", "assistantConversations", "localAuthUsers", "paymentAccounts", "connectorConnections", "consoleSettings", "rewardedRules", "userProfiles", "workspaces"]) {
    assert.ok(owned.includes(name), `${name} is owned (found: ${owned.join(", ")})`);
  }
});
