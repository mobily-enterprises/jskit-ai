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
import { materialSymbols } from "@jskit-ai/material-web/client/symbols";
import {
  DEFAULT_VIEWPORTS,
  runAdaptiveShellSmokeCase
} from "../src/test/adaptiveShellSmoke.js";
import { pressShellBack, shellBackButton, shellPageTitle } from "../src/test/shellNavigation.js";

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

// The computed colour of a theme role, read from a probe painted with it.
async function readRoleColor(page, role) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `rgb(var(--v-theme-${name}))`;
    document.querySelector(".v-application").append(probe);
    const color = window.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, role);
}

function symbolPath(alias) {
  return materialSymbols[alias].slice("svg:".length);
}

// Material 3 chrome: a 64dp surface app bar and a surface drawer without dividers, the active destination on a
// secondary-container pill with its icon filled, and inactive labels readable on the drawer.
async function assertMaterialChrome(page, activeLabel, activeIcon) {
  const drawer = page.getByTestId("jskit-shell-drawer");
  await expect(drawer).toHaveAttribute("data-presentation", "drawer");
  const surface = await readRoleColor(page, "surface");
  const secondaryContainer = await readRoleColor(page, "secondary-container");
  const chrome = await page.evaluate((label) => {
    const style = (element) => window.getComputedStyle(element);
    const appBar = document.querySelector("[data-testid='jskit-shell-app-bar']");
    const drawerElement = document.querySelector("[data-testid='jskit-shell-drawer']");
    const items = Array.from(drawerElement.querySelectorAll("a.shell-menu-link-item"));
    const active = items.find((item) => item.textContent.trim() === label);
    const inactive = items.find((item) => item !== active);
    return {
      appBarHeight: appBar.getBoundingClientRect().height,
      appBarBackground: style(appBar).backgroundColor,
      appBarBorders: [style(appBar).borderBottomWidth, style(appBar).borderTopWidth],
      drawerBackground: style(drawerElement).backgroundColor,
      drawerBorder: style(drawerElement).borderRightWidth,
      activeBackground: style(active).backgroundColor,
      activeHeight: active.getBoundingClientRect().height,
      activeRadius: Number.parseFloat(style(active).borderTopLeftRadius),
      activeIconPath: active.querySelector(".v-icon svg path")?.getAttribute("d") || "",
      inactiveColor: style(inactive.querySelector(".v-list-item-title")).color
    };
  }, activeLabel);
  assert.equal(chrome.appBarHeight, 64);
  assert.equal(chrome.appBarBackground, surface);
  assert.deepEqual(chrome.appBarBorders, ["0px", "0px"]);
  assert.equal(chrome.drawerBackground, surface);
  assert.equal(chrome.drawerBorder, "0px");
  assert.equal(chrome.activeBackground, secondaryContainer);
  assert.equal(chrome.activeHeight, 56);
  assert.ok(chrome.activeRadius >= 28, `The active destination's corner radius was ${chrome.activeRadius}px.`);
  assert.equal(chrome.activeIconPath, symbolPath(activeIcon));
  const ratio = contrastRatio(parseRgb(chrome.inactiveColor), parseRgb(chrome.drawerBackground));
  assert.ok(ratio >= 4.5, `Inactive navigation labels had ${ratio.toFixed(2)}:1 contrast.`);
}

async function assertDrawerFit(page) {
  const drawer = page.getByTestId("jskit-shell-drawer");
  await expect(drawer).toHaveAttribute("data-presentation", "drawer");
  await expect(drawer).toHaveAttribute("data-drawer-width-mode", "content");
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
  const activeBackground = await activeLink.locator(".shell-menu-link-item__indicator").evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  );
  assert.equal(activeBackground, await readRoleColor(page, "secondary-container"));
  await expect(activeLink.locator(".shell-menu-link-item__rail-label")).toHaveText("Bookings");

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
        await expect(page).toHaveURL(/\/home\/settings$/u);
      }
      await page.close();
    }

    for (const [pathAndTheme, activeLabel, activeIcon] of [
      ["/home?theme=light", "Home", "homeFilled"],
      ["/home?theme=dark", "Home", "homeFilled"],
      ["/w/acme/admin/bookings?theme=light", "Bookings", "adminPanelSettingsFilled"],
      ["/w/acme/admin/bookings?theme=dark", "Bookings", "adminPanelSettingsFilled"]
    ]) {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(pathAndTheme);
      await expect(page.getByTestId("jskit-shell-drawer")).toBeVisible();
      await assertMaterialChrome(page, activeLabel, activeIcon);
      await page.close();
    }

    const mediumPage = await context.newPage();
    await mediumPage.setViewportSize({ width: 768, height: 1024 });
    await mediumPage.goto("/w/acme/admin/bookings?theme=light");
    await expect(mediumPage.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-layout", "medium");
    const railLabels = mediumPage.getByTestId("jskit-shell-rail").locator(".shell-menu-link-item__rail-label");
    await expect(railLabels.first()).toBeVisible();
    assert.ok(await railLabels.count() >= 5, "The navigation rail labels each destination.");
    await mediumPage.close();

    const railPage = await context.newPage();
    await railPage.setViewportSize({ width: 1280, height: 900 });
    await railPage.goto("/w/acme/admin/bookings?theme=light");
    await expect(railPage.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-drawer-width", "360");
    await assertRailKeyboardAndSelection(railPage);
    await railPage.close();

    const configuredPage = await context.newPage();
    await configuredPage.setViewportSize({ width: 1280, height: 900 });
    await configuredPage.goto(
      "/w/acme/admin/bookings?theme=light&railWidth=64&navigationItemSpacing=8&drawerWidth=content"
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
  } catch (error) {
    const fixtureOutput = vite.readOutput().trim();
    if (!fixtureOutput) {
      throw error;
    }
    throw new Error(
      `${error.message}\n\nAdaptive shell fixture output:\n${fixtureOutput}`,
      { cause: error }
    );
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("shell-web preserves the active form across responsive changes", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const startingWidth of [1280, 390]) {
      const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: startingWidth, height: 900 } });
      await page.goto("/w/acme/admin/contacts");
      await page.getByRole("link", { name: "Bookings", exact: true }).click();
      await expect(page).toHaveURL(/\/bookings$/u);
      await expect(page.locator(".shell-route-transition__pane")).toHaveCount(1);
      const answer = page.getByRole("textbox", { name: "Unsaved answer" });
      await answer.fill("Keep this unsaved answer");
      await page.getByText("More details", { exact: true }).click();
      await page.getByRole("button", { name: "Validate answer" }).click();
      await answer.focus();
      const originalInput = await answer.elementHandle();
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1024, height: 1024 },
        { width: 1280, height: 900 },
        { width: 1280, height: 420 },
        { width: 390, height: 420 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(answer).toHaveValue("Keep this unsaved answer");
        await expect(page.locator("details")).toHaveAttribute("open", "");
        await expect(page.getByRole("status")).toHaveText("Please review this answer.");
        await expect(answer).toBeFocused();
        assert.equal(await originalInput.evaluate((element) => element === document.activeElement), true);
        await expect(page.locator(".shell-route-transition__pane")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      }
      // Real compact navigation still replaces the pane and runs its animation.
      await page.getByRole("link", { name: "Contacts", exact: true }).click();
      await expect(page).toHaveURL(/\/contacts$/u);
      await expect(page.locator(".shell-route-transition__pane")).toHaveCount(1);
      await expect(answer).toHaveValue("");
      assert.equal(await originalInput.evaluate((element) => element.isConnected), false);
      // Desktop same-surface navigation continues to reuse the routed component.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("link", { name: "Bookings", exact: true }).click();
      await expect(page).toHaveURL(/\/bookings$/u);
      await answer.fill("Desktop state");
      await page.getByRole("link", { name: "Contacts", exact: true }).click();
      await expect(page).toHaveURL(/\/contacts$/u);
      await expect(answer).toHaveValue("Desktop state");
      await page.close();
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

function overlaps(first, second) {
  return first.bottom > second.top && first.top < second.bottom &&
    first.right > second.left && first.left < second.right;
}

async function reportBannerAndMeasure(page) {
  await page.evaluate(() => window.__shellFixtureReportBanner("Invalid email or password."));
  const banner = page.locator(".shell-error-host__banner").first();
  await expect(banner).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return banner.evaluate((element) => {
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    const close = element.querySelector(".v-alert__close .v-btn");
    const closeColor = window.getComputedStyle(close).color;
    // A themed button default must not recolour the close mark into the banner colour.
    close.classList.add("text-error");
    const closeColorWithThemedDefault = window.getComputedStyle(close).color;
    close.classList.remove("text-error");
    const appBar = document.querySelector("[data-testid='jskit-shell-app-bar']");
    return {
      banner: box(element),
      background: window.getComputedStyle(element).backgroundColor,
      closeColor,
      closeColorWithThemedDefault,
      appBar: appBar ? box(appBar) : null,
      content: Array.from(document.querySelectorAll("main h1, main input, main button"))
        .map((node) => ({ name: node.textContent.trim() || node.name, rect: box(node) }))
    };
  });
}

test("shell-web error banners never cover content and keep a readable close button", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ baseURL: vite.baseURL, viewport });
        await page.goto(`/sign-in?theme=${theme}`);
        await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
        await expect(page.getByTestId("jskit-shell-app-bar")).toHaveCount(0);
        const bare = await reportBannerAndMeasure(page);
        for (const item of bare.content) {
          assert.equal(
            overlaps(bare.banner, item.rect),
            false,
            `${viewport.width}px ${theme}: the banner covers "${item.name}" on a surface without an app bar.`
          );
        }
        const background = parseRgb(bare.background);
        for (const color of [bare.closeColor, bare.closeColorWithThemedDefault]) {
          const ratio = contrastRatio(parseRgb(color), background);
          assert.ok(ratio >= 3, `${viewport.width}px ${theme}: banner close contrast was ${ratio.toFixed(2)}:1.`);
        }

        await page.goto(`/home?theme=${theme}`);
        await expect(page.getByTestId("jskit-shell-app-bar")).toBeVisible();
        const shell = await reportBannerAndMeasure(page);
        assert.ok(
          shell.banner.top >= shell.appBar.bottom - 1,
          `${viewport.width}px ${theme}: the banner overlaps the top app bar.`
        );
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("shell-web's app bar fills with surface-container once the page scrolls under it", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
    await page.goto("/home/contacts?theme=light");
    const appBar = page.getByTestId("jskit-shell-app-bar");
    const background = () => appBar.evaluate((element) => window.getComputedStyle(element).backgroundColor);
    await expect.poll(background).toBe(await readRoleColor(page, "surface"));
    const bar = page.getByTestId("jskit-shell-bottom-nav");
    assert.equal(
      await bar.evaluate((element) => window.getComputedStyle(element).backgroundColor),
      await readRoleColor(page, "surface-container")
    );
    assert.equal(Math.round((await bar.boundingBox()).height), 80);
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(background).toBe(await readRoleColor(page, "surface-container"));
    await page.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("shell-web's bar pieces give a layout that draws its own top app bar the shell's Up, title and actions", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of DEFAULT_VIEWPORTS) {
      const page = await browser.newPage({
        baseURL: vite.baseURL,
        viewport: { width: viewport.width, height: viewport.height }
      });
      const at = `${viewport.width}px`;
      const ownBar = page.getByTestId("fixture-own-bar");

      // A top-level page: the title is the page's one h1, in the app's own bar, with no arrow.
      await page.goto("/home/studio");
      await expect(ownBar.getByRole("heading", { level: 1, name: "Studio" }), at).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 }), at).toHaveCount(1);
      await expect(shellBackButton(page), at).toHaveCount(0);

      // An inner page: Up, its title and its actions, in the app's own bar; Up returns along the trail.
      await page.getByRole("link", { name: "Ada Lovelace", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/studio\/ada$/u);
      await expect(ownBar.getByTestId("jskit-shell-page-title"), at).toHaveText("Ada Lovelace");
      await expect(ownBar.getByTestId("jskit-shell-back"), at).toHaveAccessibleName("Back");
      await expect(ownBar.getByRole("button", { name: "Run" }), at).toBeVisible();
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/studio$/u);
      await expect(shellBackButton(page), at).toHaveCount(0);

      // A pasted link goes Up to the declared parent.
      await page.goto("/home/studio/ada");
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/studio$/u);
      await page.close();
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

async function openMainDestination(page, label) {
  await page.getByRole("link", { name: label, exact: true }).filter({ visible: true }).first().click();
}

test("shell-web Up follows the tab's trail, falls back to the parent and returns to where the person was", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of DEFAULT_VIEWPORTS) {
      const context = await browser.newContext({
        baseURL: vite.baseURL,
        viewport: { width: viewport.width, height: viewport.height }
      });
      const page = await context.newPage();
      const at = `${viewport.width}px`;

      // Main-menu pages have no arrow.
      for (const path of ["/home", "/home/contacts", "/home/suppliers", "/home/bookings", "/home/settings"]) {
        await page.goto(path);
        await expect(shellPageTitle(page)).toBeVisible();
        await expect(shellBackButton(page), `${at} ${path}`).toHaveCount(0);
      }

      // contact -> supplier -> Up = contact -> Up = the Contacts list.
      await page.goto("/home/contacts");
      await page.getByRole("link", { name: "Ada Lovelace", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/contacts\/ada$/u);
      await expect(shellPageTitle(page)).toHaveText("Ada Lovelace");
      await expect(shellBackButton(page)).toHaveAccessibleName("Back");
      await page.getByRole("link", { name: "Supplier", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/suppliers\/acme$/u);
      // A refresh keeps the trail.
      await page.reload();
      await expect(shellPageTitle(page)).toHaveText("Acme Supplies");
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/contacts\/ada$/u);
      // The browser's Back and Forward move the trail with them.
      await page.goBack();
      await expect(page).toHaveURL(/\/home\/suppliers\/acme$/u);
      await page.goForward();
      await expect(page).toHaveURL(/\/home\/contacts\/ada$/u);
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/contacts$/u);
      await expect(shellBackButton(page)).toHaveCount(0);

      // The trail is a stack of visits: contact -> supplier -> the same contact -> Up = supplier.
      await page.getByRole("link", { name: "Ada Lovelace", exact: true }).click();
      await page.getByRole("link", { name: "Supplier", exact: true }).click();
      await page.getByRole("link", { name: "Contact", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/contacts\/ada$/u);
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/suppliers\/acme$/u);

      // A main destination starts a fresh trail.
      await openMainDestination(page, "Suppliers");
      await expect(page).toHaveURL(/\/home\/suppliers$/u);
      await page.getByRole("link", { name: "Acme Supplies", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/suppliers\/acme$/u);
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/suppliers$/u);

      // Up to a page that is no longer available goes to the current page's parent instead.
      await page.goto("/home/contacts/ada");
      await page.getByRole("link", { name: "Supplier", exact: true }).click();
      await page.evaluate(() => {
        window.__fixtureBlockedRecords = ["ada"];
      });
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/suppliers$/u);
      await page.evaluate(() => {
        window.__fixtureBlockedRecords = [];
      });

      // Up returns to the list where it was scrolled, with focus on the record it opened.
      await page.goto("/home/contacts");
      const deepLink = page.getByRole("link", { name: "Contact 35", exact: true });
      await deepLink.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      assert.ok(scrollBefore > 200, `${at}: the contacts list did not scroll.`);
      await deepLink.click();
      await expect(page).toHaveURL(/\/home\/contacts\/contact-35$/u);
      await pressShellBack(page);
      await expect(page).toHaveURL(/\/home\/contacts$/u);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore - 3);
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore) <= 2, `${at}: scroll was not restored.`);
      await expect(page.getByRole("link", { name: "Contact 35", exact: true })).toBeFocused();

      // A pasted supplier link goes Up to the Suppliers list.
      const pasted = await context.newPage();
      await pasted.goto("/home/suppliers/acme");
      await pressShellBack(pasted);
      await expect(pasted).toHaveURL(/\/home\/suppliers$/u);
      await expect(shellPageTitle(pasted)).toHaveText("Suppliers");
      await pasted.close();

      // List-detail: beside the visible list, General has no arrow; alone, it has one back to the list.
      await page.goto("/home/settings");
      await page.getByRole("link", { name: "General", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/settings\/general$/u);
      if (viewport.name === "expanded") {
        await expect(shellBackButton(page)).toHaveCount(0);
        await expect(page.getByRole("link", { name: "General", exact: true })).toBeVisible();
      } else {
        await pressShellBack(page);
        await expect(page).toHaveURL(/\/home\/settings$/u);
      }

      // No page carries a worded back control.
      await expect(page.getByText(/Back to /u)).toHaveCount(0);
      await context.close();
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});
