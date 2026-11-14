import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

const TEST_ENV = Object.freeze({ APP_ENV: "test" });
const TABLE_RUNTIME = ["@jskit-ai/database-runtime", "@jskit-ai/resource-runtime"];
const readManifest = async (url) => JSON.parse(await readFile(url, "utf8"));

/**
 * An app installed as npm installs it: each package's manifest under node_modules, by name, and nothing else, so no
 * package of the monorepo is reached by accident.
 * @param {import("node:test").TestContext} t
 * @param {object[]} manifests
 */
async function installedApp(t, manifests) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "connectors-core-without-database-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  for (const manifest of manifests) {
    const packageRoot = path.join(appRoot, "node_modules", ...manifest.name.split("/"));
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify(manifest));
  }
  const [own] = manifests;
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    name: "app-without-database",
    private: true,
    dependencies: { [own.name]: own.version }
  }));
  return appRoot;
}

test("an app without a database installs @jskit-ai/connectors-core without the table runtime, composes it and starts", async (t) => {
  const manifest = await readManifest(new URL("../package.json", import.meta.url));
  // npm installs a package's dependencies, never its optional peers: the table runtime comes with an app's database.
  for (const name of TABLE_RUNTIME) {
    assert.equal(manifest.dependencies?.[name], undefined, `${name} is not a dependency`);
    assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} is an optional peer`);
  }

  const started = await createInstalledRuntime({ appRoot: await installedApp(t, [manifest]), env: TEST_ENV, logger: silentLogger });
  assert.ok(started.packageOrder.includes(manifest.name));
  assert.equal(started.packageOrder.some((name) => TABLE_RUNTIME.includes(name)), false);

  // Installed as a dependency, the table runtime would need a database driver the app does not have.
  const databaseRuntime = await readManifest(new URL("../../database-runtime/package.json", import.meta.url));
  await assert.rejects(
    createInstalledRuntime({ appRoot: await installedApp(t, [manifest, databaseRuntime]), env: TEST_ENV, logger: silentLogger }),
    /requires capability runtime\.database\.driver, but no installed package provides it/u
  );
});
