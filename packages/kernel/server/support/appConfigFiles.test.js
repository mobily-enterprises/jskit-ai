import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadAppConfigFromAppRoot, loadAppConfigFromModuleUrl } from "./appConfigFiles.js";

async function createModuleUrlAt(absolutePath) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "export {};\n", "utf8");
  return pathToFileURL(absolutePath).href;
}

test("loadAppConfigFromModuleUrl merges public and server config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kernel-app-config-"));
  const appRoot = path.join(tempRoot, "app");
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await writeFile(path.join(appRoot, "config", "public.js"), "export const config = { a: 1, shared: 'public' };", "utf8");
  await writeFile(path.join(appRoot, "config", "server.js"), "export const config = { b: 2, shared: 'server' };", "utf8");
  const moduleUrl = await createModuleUrlAt(path.join(appRoot, "packages", "main", "src", "server", "MainServiceProvider.js"));

  const loaded = await loadAppConfigFromModuleUrl({ moduleUrl });

  assert.deepEqual(loaded, {
    a: 1,
    b: 2,
    shared: "server"
  });
  assert.equal(Object.isFrozen(loaded), true);
});

test("loadAppConfigFromAppRoot merges public and server config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kernel-app-config-"));
  const appRoot = path.join(tempRoot, "app");
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await writeFile(path.join(appRoot, "config", "public.js"), "export const config = { a: 1, shared: 'public' };", "utf8");
  await writeFile(path.join(appRoot, "config", "server.js"), "export const config = { b: 2, shared: 'server' };", "utf8");

  const loaded = await loadAppConfigFromAppRoot({ appRoot });

  assert.deepEqual(loaded, {
    a: 1,
    b: 2,
    shared: "server"
  });
  assert.equal(Object.isFrozen(loaded), true);
});

test("loadAppConfigFromAppRoot re-reads config changes within the same process", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kernel-app-config-"));
  const appRoot = path.join(tempRoot, "app");
  const publicConfigPath = path.join(appRoot, "config", "public.js");
  await mkdir(path.dirname(publicConfigPath), { recursive: true });
  await writeFile(publicConfigPath, "export const config = { mobile: { enabled: false } };", "utf8");

  const firstLoaded = await loadAppConfigFromAppRoot({ appRoot });
  await writeFile(publicConfigPath, "export const config = { mobile: { enabled: true } };", "utf8");
  const secondLoaded = await loadAppConfigFromAppRoot({ appRoot });

  assert.equal(firstLoaded.mobile.enabled, false);
  assert.equal(secondLoaded.mobile.enabled, true);
});

test("loadAppConfigFromAppRoot requires an explicit appRoot", async () => {
  await assert.rejects(
    loadAppConfigFromAppRoot({ appRoot: "" }),
    /requires appRoot/
  );
});

test("loadAppConfigFromModuleUrl tolerates missing server config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kernel-app-config-"));
  const appRoot = path.join(tempRoot, "app");
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await writeFile(path.join(appRoot, "config", "public.js"), "export const config = { a: 1 };", "utf8");
  const moduleUrl = await createModuleUrlAt(path.join(appRoot, "packages", "main", "src", "server", "MainServiceProvider.js"));

  const loaded = await loadAppConfigFromModuleUrl({ moduleUrl });

  assert.deepEqual(loaded, {
    a: 1
  });
});

test("loadAppConfigFromModuleUrl throws when app root cannot be resolved", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kernel-app-config-"));
  const moduleUrl = await createModuleUrlAt(path.join(tempRoot, "missing", "packages", "main", "src", "server", "MainServiceProvider.js"));

  await assert.rejects(
    loadAppConfigFromModuleUrl({ moduleUrl }),
    /Unable to locate app root/
  );
});
