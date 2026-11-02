import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexProviderCatalogPath,
  codexProviderFileConfiguration,
  copyCodexProviderHome
} from "../src/server/conversation/codexConfiguration.js";

const provider = {
  id: "fixture",
  label: "Fixture",
  baseUrl: "https://provider.invalid/v1",
  webSearch: false,
  models: [{ id: "fixture-model", defaultThinking: "medium" }]
};

async function homes(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-provider-home-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const sourceHome = path.join(root, "source");
  const targetHome = path.join(root, "target");
  await Promise.all([mkdir(sourceHome), mkdir(targetHome)]);
  return { sourceHome, targetHome };
}

test("a copied provider home names its own catalogue", async t => {
  const { sourceHome, targetHome } = await homes(t);
  await writeFile(path.join(sourceHome, "config.toml"), codexProviderFileConfiguration(provider, "secret", sourceHome));
  await writeFile(codexProviderCatalogPath(sourceHome), "{\"models\":[]}");

  await copyCodexProviderHome(sourceHome, targetHome);

  assert.equal(
    await readFile(path.join(targetHome, "config.toml"), "utf8"),
    codexProviderFileConfiguration(provider, "secret", targetHome)
  );
  assert.equal(await readFile(codexProviderCatalogPath(targetHome), "utf8"), "{\"models\":[]}");
});

test("a provider config that does not name its own catalogue is refused, not copied", async t => {
  const { sourceHome, targetHome } = await homes(t);
  const elsewhere = path.join(path.dirname(sourceHome), "elsewhere");
  await writeFile(path.join(sourceHome, "config.toml"), codexProviderFileConfiguration(provider, "secret", elsewhere));
  await writeFile(codexProviderCatalogPath(sourceHome), "{}");

  await assert.rejects(copyCodexProviderHome(sourceHome, targetHome), /does not name its own model catalogue/);
  await assert.rejects(readFile(path.join(targetHome, "config.toml")), { code: "ENOENT" });
});
