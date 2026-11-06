import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

// An element's text colour, the theme values it should come from, and its WCAG contrast over what is painted under
// it: each translucent background is laid over the next one out, down to the first opaque one (white when none is).
// Runs in the page.
function readText(element) {
  const channels = (value) => {
    const [red, green, blue, alpha = 1] = value.match(/[\d.]+/gu).map(Number);
    return { red, green, blue, alpha };
  };
  const over = (top, under) => ({
    red: top.red * top.alpha + under.red * (1 - top.alpha),
    green: top.green * top.alpha + under.green * (1 - top.alpha),
    blue: top.blue * top.alpha + under.blue * (1 - top.alpha),
    alpha: 1
  });
  const luminance = ({ red, green, blue }) => {
    const [r, g, b] = [red, green, blue].map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const layers = [];
  for (let node = element; node; node = node.parentElement) {
    const background = channels(getComputedStyle(node).backgroundColor);
    if (background.alpha > 0) layers.push(background);
    if (background.alpha === 1) break;
  }
  const backdrop = layers.reverse().reduce((under, layer) => over(layer, under), { red: 255, green: 255, blue: 255, alpha: 1 });
  const style = getComputedStyle(element);
  const color = channels(style.color);
  const [lighter, darker] = [luminance(over(color, backdrop)), luminance(backdrop)].sort((a, b) => b - a);
  return {
    color: [color.red, color.green, color.blue, color.alpha],
    onSurface: style.getPropertyValue("--v-theme-on-surface").split(",").map(Number),
    onSurfaceVariant: style.getPropertyValue("--v-theme-on-surface-variant").split(",").map(Number),
    contrast: (lighter + 0.05) / (darker + 0.05)
  };
}

test("the task transcript's user bubble, header time and footer follow the light and dark themes", {
  skip: process.env.JSKIT_ASSISTANT_CORE_BROWSER_INTEGRATION !== "1", timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/responsive-assistant", import.meta.url)) });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
      await page.goto(`${vite.baseURL}/?delivery=1&recovery=1&task=1${theme === "dark" ? "&dark=1" : ""}`);
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`v-theme--${theme}`, "u"));
      const bubble = page.locator(".assistant-transcript--task .assistant-transcript__message--user").filter({ hasText: "Question one" });
      await expect(bubble).toBeVisible();
      assert.equal(await bubble.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(126, 87, 194, 0.16)");
      // The transcript's own headers carry no time, so the check places one where an application's header would.
      const header = page.locator(".assistant-transcript__turn .assistant-transcript__message-header").first();
      await header.evaluate((element) => {
        const time = document.createElement("time");
        for (const { name } of element.attributes) {
          if (name.startsWith("data-v-")) time.setAttribute(name, "");
        }
        time.textContent = "06:02";
        element.append(time);
      });
      const samples = {
        "user bubble": [bubble.locator(".assistant-transcript__user-content"), "on-surface"],
        "user footer": [bubble.locator(".assistant-transcript__message-footer time"), "on-surface-variant"],
        "assistant footer": [page.locator(".assistant-transcript__message-footer--assistant time").first(), "on-surface-variant"],
        "header time": [header.locator("time"), "on-surface-variant"]
      };
      // Material 3 secondary text is the solid on-surface-variant role, not on-surface at a lower opacity.
      for (const [name, [locator, role]] of Object.entries(samples)) {
        const text = await locator.evaluate(readText);
        const expected = role === "on-surface" ? text.onSurface : text.onSurfaceVariant;
        assert.deepEqual(text.color.slice(0, 3), expected, `${theme} ${name}: the colour is the theme's ${role}`);
        assert.equal(text.color[3], 1, `${theme} ${name}: the opacity`);
        assert.ok(text.contrast >= 4.5, `${theme} ${name}: contrast ${text.contrast.toFixed(2)}:1 is under 4.5:1`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});
