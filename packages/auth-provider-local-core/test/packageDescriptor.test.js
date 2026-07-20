import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("local auth contributes only its provider selection to CI", () => {
  assert.deepEqual(descriptor.ci, {
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
    descriptor.mutations.dependencies.runtime.nodemailer,
    packageJson.dependencies.nodemailer
  );
});
