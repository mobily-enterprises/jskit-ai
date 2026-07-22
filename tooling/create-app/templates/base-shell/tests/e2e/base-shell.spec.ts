import { expect, test } from "@playwright/test";
import { DEFAULT_VIEWPORTS, runGeneratedAppSmokeCase } from "@jskit-ai/jskit-cli/test/playwright";

test.describe("generated app responsive smoke", () => {
  for (const viewport of DEFAULT_VIEWPORTS) {
    test(`${viewport.name} home route renders without horizontal overflow`, async ({ page }) => {
      await runGeneratedAppSmokeCase({ page, expect, expectedText: "Ready", viewport });
    });
  }
});
