import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell-web owns the exact Playwright dependency used by its generated smoke", async () => {
  const descriptor = (await import(`${path.join(PACKAGE_ROOT, "package.descriptor.mjs")}?test=${Date.now()}`)).default;
  const rootPackage = JSON.parse(await readFile(path.resolve(PACKAGE_ROOT, "../../package.json"), "utf8"));

  assert.equal(descriptor.mutations.dependencies.dev["@playwright/test"], "1.61.1");
  assert.equal(
    descriptor.mutations.dependencies.dev["@playwright/test"],
    rootPackage.devDependencies["@playwright/test"]
  );
});

test("adaptive shell smoke navigates through Playwright baseURL", async () => {
  const source = await readFile(path.join(PACKAGE_ROOT, "src/test/adaptiveShellSmoke.js"), "utf8");

  assert.match(source, /page\.goto\(smokePath\)/u);
  assert.doesNotMatch(source, /PLAYWRIGHT_BASE_URL/u);
  assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1/u);
});
