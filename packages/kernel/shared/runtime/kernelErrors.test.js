import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { KernelError } from "./kernelErrors.js";

const APPLICATION_PATH = fileURLToPath(new URL("./application.js", import.meta.url));

test("KernelError preserves structured details while exposing the standard cause", () => {
  const cause = new Error("underlying failure");
  const error = new KernelError("outer failure", {
    cause,
    providerId: "example.provider"
  });

  assert.equal(error.cause, cause);
  assert.equal(error.details.cause, cause);
  assert.equal(error.details.providerId, "example.provider");
});

test("provider lifecycle failures expose their standard cause through Node error reporting", () => {
  const source = `
import { Application } from ${JSON.stringify(APPLICATION_PATH)};

const app = new Application();
app.configureProviders([{
  id: "json-rest-api.core",
  async boot() {
    throw new Error('DB_CLIENT is required. Use mysql2 or pg.');
  }
}]);

try {
  await app.bootProviders();
} catch (error) {
  console.error("Failed to start generated server:", error);
}
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  assert.match(result.stderr, /Failed to start generated server:/u);
  assert.match(result.stderr, /Provider "json-rest-api\.core" failed during boot\(\)\./u);
  assert.match(result.stderr, /DB_CLIENT is required\. Use mysql2 or pg\./u);
});
