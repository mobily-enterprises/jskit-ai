import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/keyboard-ripple", import.meta.url)),
  configFile: "vite.config.js"
});
// Vuetify ends a ripple 250 ms after it began at the earliest, then fades it out for 300 ms.
const ENDED = { timeout: 3000 };

// A control's own Enter handler that moves focus (a card opening a panel and focusing its title) ran before Vuetify's
// ripple directive heard the key, so the card's ripple showed after the card had lost focus, its keyup reached the
// panel's title, and the ripple stayed drawn, over the text around the card for axe, while no other control showed a
// keyboard ripple. Material 3's pressed state ends with the press.
test("a keyboard press's ripple ends with the press when the control's own Enter handler moves focus away, and the next press ripples", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  await page.goto("/");

  const card = page.getByTestId("card");
  const title = page.getByTestId("panel-title");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(title).toBeFocused();
  await expect(title).toHaveText("Opened 1 times");
  await expect(card.locator(".v-ripple__animation"), "the card's ripple ends once Enter comes up on the panel").toHaveCount(0, ENDED);

  const next = page.getByTestId("next");
  await next.focus();
  await page.keyboard.down("Enter");
  await expect(next.locator(".v-ripple__animation"), "the next control shows its keyboard ripple while Enter is down").toHaveCount(1);
  await page.keyboard.up("Enter");
  await expect(next.locator(".v-ripple__animation"), "and ends it when Enter comes up").toHaveCount(0, ENDED);
});
