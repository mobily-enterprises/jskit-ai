import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = packageJson.jskit;

test("assistant-runtime registers providers without install-time authoring machinery", async () => {
  assert.equal(packageMetadata.kind, "runtime");
  assert.equal(packageMetadata.capabilities?.requires?.includes("workspaces.core"), false);
  assert.equal(packageMetadata.runtime?.server?.providers?.[0]?.entrypoint, "src/server/AssistantProvider.js");
  assert.equal(packageMetadata.runtime?.server?.providers?.[0]?.export, "AssistantFeature");
  assert.equal(
    packageMetadata.runtime?.client?.providers?.[0]?.entrypoint,
    "src/client/providers/AssistantClientProvider.js"
  );
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
  assert.equal(Object.hasOwn(packageMetadata.metadata.apiSummary, "containerTokens"), false);
  assert.deepEqual(packageMetadata.migrations, { directories: ["migrations"] });
  assert.deepEqual((await readdir(path.join(PACKAGE_ROOT, "migrations"))).sort(), [
    "assistant_config_initial.cjs",
    "assistant_transcripts_initial.cjs"
  ]);

  const publicConfig = await readFile(
    path.join(PACKAGE_ROOT, "patterns/assistant-surface/example/config/public.js"),
    "utf8"
  );
  const serverConfig = await readFile(
    path.join(PACKAGE_ROOT, "patterns/assistant-surface/example/config/server.js"),
    "utf8"
  );
  assert.match(publicConfig, /assistantSurfaces/u);
  assert.match(serverConfig, /assistantServer/u);
});
