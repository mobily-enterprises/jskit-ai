import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createProviderRuntimeFromApp } from "./providerRuntime.js";

async function createTestAppRoot(prefix) {
  const appRoot = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
  await writeFile(
    path.join(appRoot, ".jskit", "lock.json"),
    `${JSON.stringify({ lockVersion: 1, installedPackages: {} }, null, 2)}\n`,
    "utf8"
  );
  await mkdir(path.join(appRoot, "src", "server", "providers"), { recursive: true });
  return appRoot;
}

test("createProviderRuntimeFromApp loads app local providers from src/server/providers", async () => {
  const appRoot = await createTestAppRoot("framework-core-provider-runtime-");
  try {
    await writeFile(
      path.join(appRoot, "src", "server", "providers", "AlphaProvider.js"),
      [
        "export default class AlphaProvider {",
        "  static id = \"app.alpha\";",
        "  register(app) {",
        "    app.instance(\"app.alpha.value\", 42);",
        "  }",
        "  boot() {}",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "server", "providers", "ignored.js"),
      "export const value = 1;\n",
      "utf8"
    );

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      profile: "app"
    });

    assert.deepEqual(runtime.packageOrder, []);
    assert.deepEqual(runtime.providerPackageOrder, []);
    assert.equal(runtime.appLocalProviderOrder.length, 1);
    assert.equal(runtime.appLocalProviderOrder[0], "app:src/server/providers/AlphaProvider.js");
    assert.deepEqual(runtime.diagnostics.providerOrder, ["app.alpha"]);
    assert.equal(runtime.app.make("app.alpha.value"), 42);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("createProviderRuntimeFromApp rejects ambiguous app local provider exports", async () => {
  const appRoot = await createTestAppRoot("framework-core-provider-runtime-error-");
  try {
    await writeFile(
      path.join(appRoot, "src", "server", "providers", "BrokenProvider.js"),
      [
        "export class AlphaProvider {",
        "  static id = \"app.alpha\";",
        "  register() {}",
        "}",
        "",
        "export class BetaProvider {",
        "  static id = \"app.beta\";",
        "  register() {}",
        "}"
      ].join("\n"),
      "utf8"
    );

    await assert.rejects(
      () =>
        createProviderRuntimeFromApp({
          appRoot,
          profile: "app"
        }),
      /exports multiple providers/
    );
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
