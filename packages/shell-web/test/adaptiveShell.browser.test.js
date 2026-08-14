import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";
import {
  DEFAULT_VIEWPORTS,
  runAdaptiveShellSmokeCase
} from "../src/test/adaptiveShellSmoke.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/adaptive-shell");
const RUN_BROWSER_TEST = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1";

function parseRgb(color) {
  const channels = String(color || "").match(/[\d.]+/gu)?.map(Number) || [];
  return {
    red: channels[0] || 0,
    green: channels[1] || 0,
    blue: channels[2] || 0,
    alpha: channels.length > 3 ? channels[3] : 1
  };
}

function relativeLuminance(color) {
  const channels = [color.red, color.green, color.blue].map(normalizeChannel);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function normalizeChannel(channel) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function assertTooltipContrast(page, linkName, interaction) {
  const link = page.getByRole("link", { name: linkName, exact: true });
  if (interaction === "focus") {
    await link.focus();
  } else {
    await link.hover();
  }
  const tooltip = page.locator(".shell-navigation-tooltip").filter({ hasText: linkName }).last();
  await expect(tooltip).toBeVisible();
  const colors = await tooltip.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      opacity: Number(style.opacity)
    };
  });
  const background = parseRgb(colors.background);
  const foreground = parseRgb(colors.color);
  assert.equal(colors.opacity, 1);
  assert.equal(background.alpha, 1);
  assert.ok(
    contrastRatio(foreground, background) >= 4.5,
    `${linkName} tooltip contrast was ${contrastRatio(foreground, background).toFixed(2)}:1.`
  );
  await page.keyboard.press("Escape");
}

async function assertDrawerFit(page) {
  const drawer = page.getByTestId("jskit-shell-drawer");
  await expect(drawer).toHaveAttribute("data-presentation", "drawer");
  assert.equal(
    await drawer.locator(".v-list-subheader").count(),
    0,
    "The drawer must not repeat the surface label from the top app bar."
  );
  const configuredSpacing = Number(await drawer.getAttribute("data-navigation-item-spacing"));
  assert.ok(Number.isFinite(configuredSpacing));
  await expect.poll(async () => {
    const configured = Number(await drawer.getAttribute("data-drawer-width"));
    const box = await drawer.boundingBox();
    return box ? Math.abs(box.width - configured) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  const result = await drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const border = Number.parseFloat(window.getComputedStyle(element).borderRightWidth) || 0;
    const innerEnd = drawerRect.right - border;
    const labels = Array.from(element.querySelectorAll(".v-list-item-title")).map((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const rect = range.getBoundingClientRect();
      range.detach?.();
      const iconRect = label.closest(".v-list-item")?.querySelector(".v-icon")?.getBoundingClientRect();
      return {
        clientHeight: label.clientHeight,
        clientWidth: label.clientWidth,
        rect,
        scrollHeight: label.scrollHeight,
        scrollWidth: label.scrollWidth,
        iconLabelGap: iconRect ? rect.left - iconRect.right : null
      };
    });
    const furthestEnd = Math.max(...labels.map((label) => label.rect.right));
    return {
      clipped: labels.some((label) => (
        label.scrollWidth > label.clientWidth ||
        label.scrollHeight > label.clientHeight
      )),
      endGap: innerEnd - furthestEnd,
      iconLabelGaps: labels
        .map((label) => label.iconLabelGap)
        .filter((gap) => Number.isFinite(gap)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert.equal(result.clipped, false, "A drawer label was clipped or ellipsized.");
  assert.ok(
    Math.abs(result.endGap - configuredSpacing) <= 1.1,
    `Drawer label end gap was ${result.endGap}px; expected ${configuredSpacing}px.`
  );
  assert.ok(result.iconLabelGaps.length > 0, "Drawer links exposed no measurable icon/label gap.");
  for (const gap of result.iconLabelGaps) {
    assert.ok(
      Math.abs(gap - configuredSpacing) <= 1,
      `Drawer icon/label gap was ${gap}px; expected ${configuredSpacing}px.`
    );
  }
  assert.ok(result.overflow <= 1, `Page overflowed horizontally by ${result.overflow}px.`);
}

async function assertRailKeyboardAndSelection(page) {
  const drawer = page.getByTestId("jskit-shell-drawer");
  await page.getByTestId("jskit-shell-nav-toggle").click();
  await expect(drawer).toHaveAttribute("data-presentation", "rail");
  const configuredRailWidth = Number(await drawer.getAttribute("data-rail-width"));
  await expect.poll(async () => {
    const box = await drawer.boundingBox();
    return box ? Math.abs(box.width - configuredRailWidth) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);

  const activeLink = page.getByRole("link", { name: "Bookings", exact: true });
  const activeBackground = await activeLink.locator(".v-list-item__overlay").evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  );
  assert.notEqual(activeBackground, "rgba(0, 0, 0, 0)");

  const contacts = page.getByRole("link", { name: "Contacts", exact: true });
  await contacts.focus();
  await contacts.press("Enter");
  await expect(page).toHaveURL(/\/contacts(?:\?|$)/u);

  const assistant = page.getByRole("link", { name: "Assistant", exact: true });
  await assistant.focus();
  const scrollBeforeSpace = await page.evaluate(() => window.scrollY);
  await assistant.press("Space");
  await expect(page).toHaveURL(/\/assistant(?:\?|$)/u);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeSpace);
}

test("shell-web adaptive navigation passes package-owned browser contracts", {
  skip: RUN_BROWSER_TEST
    ? false
    : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 to run shell-web browser integration",
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser = null;

  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const context = await browser.newContext({
      baseURL: vite.baseURL,
      locale: "en-US"
    });

    for (const viewport of DEFAULT_VIEWPORTS) {
      const page = await context.newPage();
      await runAdaptiveShellSmokeCase({ page, expect, viewport });
      if (viewport.name !== "compact") {
        await expect(page).toHaveURL(/\/home\/settings\/general$/u);
      }
      await page.close();
    }

    for (const pathAndTheme of [
      "/home?theme=light",
      "/home?theme=dark",
      "/w/acme/admin/bookings?theme=light",
      "/w/acme/admin/bookings?theme=dark"
    ]) {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(pathAndTheme);
      await expect(page.getByTestId("jskit-shell-drawer")).toBeVisible();
      await assertDrawerFit(page);
      await assertTooltipContrast(page, "Bookings", "focus");
      await assertTooltipContrast(page, "Help and support", "hover");
      await page.close();
    }

    const railPage = await context.newPage();
    await railPage.setViewportSize({ width: 1280, height: 900 });
    await railPage.goto("/w/acme/admin/bookings?theme=light");
    await assertDrawerFit(railPage);
    await assertRailKeyboardAndSelection(railPage);
    await railPage.close();

    const configuredPage = await context.newPage();
    await configuredPage.setViewportSize({ width: 1280, height: 900 });
    await configuredPage.goto(
      "/w/acme/admin/bookings?theme=light&railWidth=64&navigationItemSpacing=8"
    );
    const configuredDrawer = configuredPage.getByTestId("jskit-shell-drawer");
    await expect(configuredDrawer).toHaveAttribute("data-navigation-item-spacing", "8");
    await assertDrawerFit(configuredPage);
    await configuredPage.getByTestId("jskit-shell-nav-toggle").click();
    await expect(configuredDrawer).toHaveAttribute("data-presentation", "rail");
    await expect(configuredDrawer).toHaveAttribute("data-rail-width", "64");
    await expect.poll(async () => {
      const box = await configuredDrawer.boundingBox();
      return box ? Math.abs(box.width - 64) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(1);
    await configuredPage.close();
    await context.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});
