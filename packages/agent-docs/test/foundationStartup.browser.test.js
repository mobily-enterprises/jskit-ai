import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions } from "../../../tooling/testUtils/browserFixture.mjs";

test("foundation documents remain usable before JavaScript at every viewport", {
  skip: process.env.JSKIT_FOUNDATION_STARTUP_INTEGRATION !== "1"
}, async () => {
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const foundation of ["minimal-foundation", "shell-foundation"]) {
      const html = await readFile(new URL(`../patterns/${foundation}/example/index.html`, import.meta.url), "utf8");
      for (const width of [390, 768, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
        let releaseScripts;
        const held = new Promise(resolve => { releaseScripts = resolve; });
        try {
          const page = await context.newPage();
          let scripts = 0;
          await page.route("**/*", async route => {
            if (route.request().resourceType() === "script") {
              scripts += 1;
              await held;
              return route.abort();
            }
            return route.fulfill({ contentType: "text/html", body: html });
          });
          await page.goto("http://foundation.test/home", { waitUntil: "commit" });
          await expect(page.getByRole("status")).toHaveText("Loading application…");
          await expect(page.getByRole("status")).toBeVisible();
          await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
          await expect.poll(() => scripts).toBeGreaterThan(0);
          const geometry = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            reloadHeight: document.querySelector("#startup-shell a").getBoundingClientRect().height
          }));
          assert.ok(geometry.scrollWidth <= geometry.width + 1);
          assert.ok(geometry.reloadHeight >= 48);
        } finally {
          releaseScripts();
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
});
