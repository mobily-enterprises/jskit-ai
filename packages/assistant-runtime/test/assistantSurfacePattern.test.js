import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseSfc } from "@vue/compiler-sfc";

const exampleRoot = new URL("../patterns/assistant-surface/example/", import.meta.url);

test("assistant surface pattern keeps product config explicit and secrets external", async () => {
  const publicConfig = (await import(new URL("config/public.js", exampleRoot))).default;
  const serverConfig = (await import(new URL("config/server.js", exampleRoot))).default;
  const placementSource = await readFile(new URL("src/placement.js", exampleRoot), "utf8");
  const pagePaths = [
    "src/pages/admin/assistant/index.vue",
    "src/pages/admin/settings/assistant/index.vue"
  ];

  assert.deepEqual(publicConfig.assistantSurfaces.admin, {
    settingsSurfaceId: "admin",
    configScope: "global"
  });
  assert.equal(serverConfig.assistantServer.admin.aiConfigPrefix, "ADMIN_ASSISTANT");
  assert.doesNotMatch(JSON.stringify({ publicConfig, serverConfig }), /api[_-]?key|secret/iu);
  assert.doesNotMatch(placementSource, /generator|scaffold|receipt|provenance/u);

  for (const pagePath of pagePaths) {
    const source = await readFile(new URL(pagePath, exampleRoot), "utf8");
    const parsed = parseSfc(source, { filename: pagePath });
    assert.equal(parsed.errors.length, 0, `${pagePath}: ${parsed.errors.join("\n")}`);
  }
});
