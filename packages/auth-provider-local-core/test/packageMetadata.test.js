import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("local auth contributes only its provider selection to CI", () => {
  assert.deepEqual(packageMetadata.ci, {
    environment: {
      AUTH_PROVIDER: "local"
    },
    services: [],
    steps: []
  });
});

test("local auth scaffolds the Nodemailer version used by the package", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    packageMetadata.mutations.dependencies.runtime.nodemailer,
    packageJson.dependencies.nodemailer
  );
});
