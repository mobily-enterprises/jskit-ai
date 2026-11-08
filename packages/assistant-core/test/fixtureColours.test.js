import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkMaterial3 } from "../../../tooling/jskit-catalog/scripts/material3.mjs";

// The fixtures the browser tests draw are app UI too: their colours are the theme's roles, so they follow the light
// and dark schemes the tests check. jskit check m3 skips every file under fixtures/, so this test checks the fixture
// as an app of its own.
test("the responsive assistant fixtures draw with theme colour roles, never raw colours", async () => {
  const result = await checkMaterial3({
    projectRoot: fileURLToPath(new URL("../fixtures/responsive-assistant", import.meta.url)),
    paths: ["."]
  });

  assert.ok(result.files.includes("ConversationFixture.vue"), result.files.join(", "));
  assert.deepEqual(
    result.findings.filter((finding) => finding.rule === "m3/raw-hex").map(({ file, line, message }) => `${file}:${line} ${message}`),
    []
  );
});
