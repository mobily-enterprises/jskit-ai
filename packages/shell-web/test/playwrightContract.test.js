import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isRequestedOrDescendantLocation
} from "../src/test/adaptiveShellSmoke.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell-web owns the exact Playwright dependency used by its generated smoke", async () => {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const rootPackage = JSON.parse(await readFile(path.resolve(PACKAGE_ROOT, "../../package.json"), "utf8"));

  assert.equal(packageJson.jskit.mutations.dependencies.dev["@playwright/test"], "1.61.1");
  assert.equal(
    packageJson.jskit.mutations.dependencies.dev["@playwright/test"],
    rootPackage.devDependencies["@playwright/test"]
  );
});

test("adaptive shell smoke navigates through Playwright baseURL", async () => {
  const source = await readFile(path.join(PACKAGE_ROOT, "src/test/adaptiveShellSmoke.js"), "utf8");

  assert.match(source, /page\.goto\(smokePath\)/u);
  assert.doesNotMatch(source, /PLAYWRIGHT_BASE_URL/u);
  assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1/u);
});

test("adaptive shell navigation accepts canonical descendants without accepting prefix siblings", () => {
  const requested = new URL("https://example.test/home/settings?tab=profile");

  assert.equal(
    isRequestedOrDescendantLocation(
      new URL("https://example.test/home/settings?tab=profile"),
      requested
    ),
    true
  );
  assert.equal(
    isRequestedOrDescendantLocation(
      new URL("https://example.test/home/settings/general?tab=profile"),
      requested
    ),
    true
  );
  assert.equal(
    isRequestedOrDescendantLocation(
      new URL("https://example.test/home/settings-other?tab=profile"),
      requested
    ),
    false
  );
  assert.equal(
    isRequestedOrDescendantLocation(
      new URL("https://example.test/home/settings/general?tab=security"),
      requested
    ),
    false
  );
});

test("adaptive shell smoke follows rendered layout state and waits for drawer transitions", async () => {
  const source = await readFile(path.join(PACKAGE_ROOT, "src/test/adaptiveShellSmoke.js"), "utf8");

  assert.match(source, /data-layout/u);
  assert.match(source, /data-navigation-item-spacing/u);
  assert.match(source, /data-rail-width/u);
  assert.match(source, /expect\.poll/u);
  assert.match(source, /toBeFocused/u);
  assert.match(source, /v-navigation-drawer__scrim/u);
  assert.match(source, /page\.keyboard\.press\("Escape"\)[\s\S]*data-presentation", "drawer"/u);
  assert.match(source, /centers\.push\(box\.x \+ box\.width \/ 2\)/u);
  assert.match(source, /fit\.endGap - configuredSpacing/u);
  assert.match(source, /fit\.iconLabelGaps/u);
  assert.doesNotMatch(source, /viewport\.name === "compact"/u);
  assert.doesNotMatch(source, /await new Promise.*setTimeout|waitForTimeout/u);
});
