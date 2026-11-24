import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLIENT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "client");

// An app's tests load this package's Vue source as it is (vitest inlines it, and nothing is tree-shaken there): an
// import from "vuetify/components" makes each of them load and transform every Vuetify component. On 24 Nov the voice
// host's ConversationDialog cost a Vibe64 test file 3.7 s of its 7.6 s that way, for two components.
test("the voice client imports each Vuetify component from its own entry, never the whole set", () => {
  const whole = readdirSync(CLIENT_DIRECTORY, { recursive: true })
    .filter((file) => /\.(?:vue|js)$/u.test(file))
    .filter((file) => /from\s+["']vuetify\/components["']/u.test(readFileSync(path.join(CLIENT_DIRECTORY, file), "utf8")));
  assert.deepEqual(whole, []);
});
