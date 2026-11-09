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

// Starts the fixture's Vite server and a browser for one test and stops them in its after hooks, which run when the
// test fails or times out too: a `finally` in the test body never runs after a timeout, so the server and browser
// would keep the test file's process alive.
async function startFixture(t) {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  return { vite, browser };
}

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
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  try {
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
    // A label wider than the rail wraps to a second line instead of ending in an ellipsis.
    const wrapped = await railLabels.nth(1).evaluate((element) => {
      element.textContent = "Race Engineer";
      const box = element.getBoundingClientRect();
      const rail = element.closest("[data-testid=jskit-shell-rail]").getBoundingClientRect();
      return {
        lines: Math.round(box.height / Number.parseFloat(window.getComputedStyle(element).lineHeight)),
        clipped: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        inside: box.left >= rail.left && box.right <= rail.right
      };
    });
    assert.deepEqual(wrapped, { lines: 2, clipped: false, inside: true });
    await mediumPage.close();

    const railPage = await context.newPage();
    await railPage.setViewportSize({ width: 1280, height: 900 });
    // drawerWidth="material" asks for Material 3's full width in place of the fitted one.
    await railPage.goto("/w/acme/admin/bookings?theme=light&drawerWidth=material");
    await expect(railPage.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-drawer-width-mode", "fixed");
    await expect(railPage.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-drawer-width", "360");
    await assertRailKeyboardAndSelection(railPage);
    await railPage.close();

    // Without a drawerWidth the drawer fits its labels.
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
  } catch (error) {
    const fixtureOutput = vite.readOutput().trim();
    if (!fixtureOutput) {
      throw error;
    }
    throw new Error(
      `${error.message}\n\nAdaptive shell fixture output:\n${fixtureOutput}`,
      { cause: error }
    );
  }
});

test("the shared smoke case passes a phone shell whose destinations are all in the navigation bar", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL });
  // The standard topology: admin's main navigation goes to shell-layout:primary-bottom-nav on a phone and it has no
  // other destinations, so the shell draws no drawer or menu control there.
  const compact = DEFAULT_VIEWPORTS.find(({ name }) => name === "compact");
  await runAdaptiveShellSmokeCase({ page, expect, smokePath: "/w/acme/admin/bookings", viewport: compact });
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveCount(0);
  await expect(page.getByTestId("jskit-shell-nav-toggle")).toHaveCount(0);
  await page.close();
});

test("shell-web preserves the active form across responsive changes", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
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
}, async (t) => {
  const { vite, browser } = await startFixture(t);
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
});

// Material 3 keeps a snackbar clear of the FAB and the actions it reports on, so a person who saves can press Save
// again at once (a bottom-end snackbar over Save made each second press wait out its 5 seconds). On a phone the form's
// Save is the app bar's primary action; wider, the form's own Save at the content's bottom end counts too.
test("a snackbar never covers the FAB, the navigation bar or a form's Save, so Save can be pressed again at once", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  for (const viewport of DEFAULT_VIEWPORTS) {
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: viewport.width, height: viewport.height } });
    try {
      await page.goto("/home/feedback");
      await expect(page.getByTestId("fixture-feedback")).toBeVisible();
      const targets = {
        bar: page.getByTestId("jskit-shell-app-bar").getByRole("button", { name: "Save", exact: true }),
        form: page.getByTestId("fixture-form-save"),
        fab: page.getByRole("button", { name: "New", exact: true })
      };
      const names = viewport.name === "compact" ? ["bar", "fab"] : ["bar", "form", "fab"];
      const presses = page.getByTestId("fixture-presses");
      const box = (locator) => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      const counts = { bar: 0, form: 0, fab: 0 };
      for (const name of names) {
        await targets[name].click({ timeout: 2_000 });
        const snackbar = page.locator(".shell-error-host__snackbar .v-snackbar__wrapper");
        await expect(snackbar).toBeVisible();
        // The snackbar's own transitions, which end: an endless animation elsewhere (a progress bar) never would.
        await snackbar.evaluate((element) => Promise.all(element.closest(".v-snackbar").getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
          .map((animation) => animation.finished.catch(() => null))));
        const shown = await box(snackbar);
        for (const other of names) {
          assert.equal(overlaps(shown, await box(targets[other])), false,
            `${viewport.width}px: the snackbar from ${name} covers ${other}: ${JSON.stringify(shown)}`);
        }
        const bottomNavigation = page.getByTestId("jskit-shell-bottom-nav");
        if (await bottomNavigation.isVisible()) {
          assert.ok(shown.bottom <= (await box(bottomNavigation)).top, `${viewport.width}px: the snackbar sits above the navigation bar`);
        }
        // Pressed again at once, while the snackbar shows: nothing may be in the way.
        await targets[name].click({ timeout: 1_000 });
        await expect(snackbar).toBeVisible();
        counts[name] += 2;
        await expect(presses).toHaveText(`${counts.bar} ${counts.form} ${counts.fab}`);
        // Each press reported once: the second report waits its turn and shows when the first is dismissed.
        const current = page.locator(".shell-error-host__snackbar .v-snackbar__wrapper:not(.v-snackbar-transition-leave-active)");
        for (let report = 0; report < 2; report += 1) {
          await current.getByRole("button", { name: "Dismiss", exact: true }).click();
        }
        await expect(snackbar).toBeHidden();
      }
    } finally {
      await page.close();
    }
  }
});

// The drawer fits a long name in its identity (a workspace switcher, say) as well as its labels.
test("the drawer is wide enough for its identity's name", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
  const name = "Northwind Regional Distribution";
  await page.goto(`/home?identity=${encodeURIComponent(name)}`);
  const drawer = page.getByTestId("jskit-shell-drawer");
  await expect(drawer).toHaveAttribute("data-presentation", "drawer");
  await expect(drawer.getByRole("button", { name })).toBeVisible();
  // The name's text lies inside the button and the button inside the drawer, its 12dp padding beside it.
  const fit = () => drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const button = element.querySelector(".fixture-identity");
    const buttonRect = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button.querySelector(".v-btn__content"));
    const text = range.getBoundingClientRect();
    return {
      textInside: text.left >= buttonRect.left && text.right <= buttonRect.right,
      buttonInside: buttonRect.left >= drawerRect.left && buttonRect.right <= drawerRect.right - 12 + 0.5,
      width: Math.round(drawerRect.width)
    };
  });
  // The drawer measures again once the page's fonts load and animates its width, so each reading waits for both.
  const settle = () => drawer.evaluate(async (element) => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  await expect.poll(async () => {
    await settle();
    const { textInside, buttonInside } = await fit();
    return textInside && buttonInside;
  }).toBe(true);
  // It stays at that width: no jump once settled.
  const settled = (await fit()).width;
  assert.ok(settled <= 360, `the drawer is ${settled}px wide`);
  await page.waitForTimeout(300);
  await settle();
  assert.equal((await fit()).width, settled);
  // Without the long name the drawer fits its labels again.
  await page.goto("/home");
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.width || 0)).toBeLessThan(settled);
  await page.close();
});

// A list that fetches its rows is short when the router scrolls; Up and Back still return to where it was scrolled.
test("Up and Back return to a list's position once the list has drawn its rows", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
  const scrollY = () => page.evaluate(() => window.scrollY);
  await page.goto("/home/contacts");
  for (const back of [pressShellBack, (target) => target.goBack()]) {
    const opener = page.getByRole("link", { name: "Contact 35", exact: true });
    await opener.scrollIntoViewIfNeeded();
    const scrolled = await scrollY();
    assert.ok(scrolled > 400, "the contacts list did not scroll");
    await opener.click();
    await expect(page).toHaveURL(/\/home\/contacts\/contact-35$/u);
    await page.evaluate(() => {
      window.__fixtureRecordsDelayMs = 300;
    });
    await back(page);
    await expect(page).toHaveURL(/\/home\/contacts$/u);
    await expect(page.getByRole("link", { name: "Contact 35", exact: true })).toBeVisible();
    await expect.poll(scrollY).toBeGreaterThan(scrolled - 3);
    assert.ok(Math.abs(await scrollY() - scrolled) <= 2, `scrolled to ${await scrollY()}, not ${scrolled}`);
    await page.evaluate(() => {
      window.__fixtureRecordsDelayMs = 0;
    });
  }
  await page.close();
});

test("shell-web's app bar fills with surface-container once the page scrolls under it", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
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
});

test("shell-web's bar pieces give a layout that draws its own top app bar the shell's Up, title and actions", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
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
    // A title that is also a switcher: the menu activator is inside the h1, which keeps its id and focus target.
    const title = ownBar.getByRole("heading", { level: 1 });
    await expect(title, at).toHaveAttribute("id", "jskit-shell-page-title");
    await expect(title, at).toHaveAttribute("tabindex", "-1");
    await title.getByRole("button", { name: "Studio" }).click();
    await expect(page.getByText("Other studio", { exact: true }), at).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Other studio", { exact: true }), at).toBeHidden();

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
});

test("a surface with no navigation, or Home alone, draws no navigation bar, rail, drawer or menu control", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const navigation = { compact: "jskit-shell-bottom-nav", medium: "jskit-shell-rail", expanded: "jskit-shell-drawer" };
  for (const viewport of DEFAULT_VIEWPORTS) {
    const page = await browser.newPage({
      baseURL: vite.baseURL,
      viewport: { width: viewport.width, height: viewport.height }
    });
    const at = `${viewport.width}px`;
    await page.goto("/account");
    await expect(shellPageTitle(page), at).toHaveText("Account");
    for (const id of ["jskit-shell-bottom-nav", "jskit-shell-rail", "jskit-shell-drawer", "jskit-shell-nav-toggle"]) {
      await expect(page.getByTestId(id), `${at} ${id}`).toHaveCount(0);
    }
    assert.equal(Math.round((await page.locator("main").boundingBox()).x), 0, `${at}: the page starts at the window's edge`);
    // Its title and Up stay in the app bar; Up returns to the declared parent on another surface, which has navigation.
    await pressShellBack(page);
    await expect(page).toHaveURL(/\/home$/u);
    await expect(page.getByTestId(navigation[viewport.name]), at).toBeVisible();

    // Home alone is nowhere to go: Material 3 navigation needs two destinations.
    await page.goto("/solo");
    await expect(shellPageTitle(page), at).toHaveText("Solo");
    for (const id of ["jskit-shell-bottom-nav", "jskit-shell-rail", "jskit-shell-drawer", "jskit-shell-nav-toggle"]) {
      await expect(page.getByTestId(id), `${at} solo ${id}`).toHaveCount(0);
    }
    assert.equal(Math.round((await page.locator("main").boundingBox()).x), 0, `${at}: the solo page starts at the window's edge`);

    if (viewport.name === "expanded") {
      // The standard drawer's header holds its menu control alone; the control's tooltip is its label.
      await page.goto("/home");
      const header = page.getByTestId("jskit-shell-drawer").locator(".shell-layout__drawer-header");
      await expect(header).toBeVisible();
      assert.equal((await header.innerText()).trim(), "", `${at}: no text beside the menu control`);
      const toggle = page.getByTestId("jskit-shell-nav-toggle");
      await expect(toggle).toHaveAccessibleName("Collapse navigation drawer");
      await toggle.hover();
      await expect(page.getByRole("tooltip", { name: "Collapse navigation drawer" })).toBeVisible();
      await page.mouse.move(0, 0);
    }
    await page.close();
  }
});

// page.section-nav is a page's own tabs: Material 3 primary tabs (48dp, title-small, the active label primary over a
// 3dp indicator under its content), never navigation bar destinations, which belong to the navigation bar alone. The
// bar's item placed in a page draws the same tabs.
test("a page's section tabs are Material 3 primary tabs at every width, and the navigation bar keeps its destinations", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  for (const viewport of DEFAULT_VIEWPORTS) {
    const page = await browser.newPage({
      baseURL: vite.baseURL,
      viewport: { width: viewport.width, height: viewport.height }
    });
    const at = `${viewport.width}px`;
    await page.goto("/home/reports/overview");
    await expect(shellPageTitle(page), at).toHaveText("Reports");
    const rows = await page.evaluate(() => {
      const role = (name) => {
        const probe = document.body.appendChild(document.createElement("span"));
        probe.style.color = `rgb(var(--v-theme-${name}))`;
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const read = (testId) => [...document.querySelectorAll(`[data-testid=${testId}] .v-btn`)].map((tab) => {
        const label = tab.querySelector(".section-tab-link-item__label");
        const indicator = tab.querySelector(".section-tab-link-item__indicator");
        const style = getComputedStyle(tab);
        const labelStyle = label ? getComputedStyle(label) : null;
        const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
        return {
          name: tab.textContent.trim(),
          sectionTab: tab.classList.contains("section-tab-link-item"),
          barItem: tab.classList.contains("tab-link-item"),
          current: tab.getAttribute("aria-current") === "page",
          height: Math.round(tab.getBoundingClientRect().height),
          type: labelStyle ? [labelStyle.fontSize, labelStyle.fontWeight] : null,
          clipped: label ? label.scrollWidth > label.clientWidth + 1 : null,
          primaryLabel: style.color === role("primary"),
          indicator: indicatorStyle ? [indicatorStyle.opacity, indicatorStyle.height, indicatorStyle.borderTopLeftRadius] : null,
          indicatorUnderLabel: indicator && label ? Math.abs(indicator.getBoundingClientRect().width - label.getBoundingClientRect().width) <= 1 : null
        };
      });
      return { sections: read("fixture-section-tabs"), views: read("fixture-bar-items-in-page") };
    });
    for (const [row, tabs] of Object.entries(rows)) {
      assert.ok(tabs.length >= 2, `${at} ${row}: its tabs render`);
      for (const tab of tabs) {
        const active = tab.name === "Overview";
        assert.deepEqual(tab, {
          name: tab.name,
          sectionTab: true,
          barItem: false,
          current: active,
          height: 48,
          type: ["14px", "500"],
          clipped: false,
          primaryLabel: active,
          indicator: [active ? "1" : "0", "3px", "3px"],
          indicatorUnderLabel: true
        }, `${at} ${row} ${tab.name}`);
      }
    }
    // A tab moves to its section and becomes the active one.
    await page.getByTestId("fixture-section-tabs").getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/home\/reports\/activity$/u);
    await expect(page.getByTestId("fixture-report-section")).toHaveText("activity");
    await expect(page.getByTestId("fixture-section-tabs").getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
    if (viewport.name === "compact") {
      // The navigation bar's destinations keep their 64x32 indicators.
      const indicator = page.getByTestId("jskit-shell-bottom-nav").locator(".tab-link-item .v-icon").first();
      const box = await indicator.boundingBox();
      assert.deepEqual([Math.round(box.width), Math.round(box.height)], [64, 32], `${at}: a navigation bar destination`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${at}: the page never scrolls sideways; the tab row does`);
    await page.close();
  }
});

test("every button keeps its size, gets a 48dp touch target and ends a long label in an ellipsis; FABs and cards keep theirs", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
  await page.goto("/home/buttons");
  // Vuetify's heights for x-small, small and large, JSKIT's 40dp default; an icon button is 12dp more, JSKIT's 40dp.
  const heights = {
    "x-small": [20, 32],
    small: [28, 40],
    default: [40, 40],
    large: [44, 56]
  };
  for (const [size, [textHeight, iconHeight]] of Object.entries(heights)) {
    for (const [id, height] of [[`fixture-button-${size}`, textHeight], [`fixture-icon-button-${size}`, iconHeight]]) {
      const button = page.getByTestId(id);
      const box = await button.boundingBox();
      assert.equal(Math.round(box.height), height, `${id} keeps its visual height`);
      const target = await button.evaluate((element) => {
        const style = window.getComputedStyle(element, "::before");
        return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
      });
      assert.equal(Math.round(target.height), Math.max(48, height), `${id} touch target height`);
      assert.ok(target.width >= 48, `${id} touch target width ${target.width}`);
      if (height < 48) {
        // A tap just above the visual, inside the touch target, reaches the button.
        const point = [box.x + box.width / 2, box.y - (48 - height) / 2 + 1];
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest(".v-btn")?.dataset.testid, point);
        assert.equal(hit, id, `${id} answers inside its touch target`);
      }
    }
  }
  const long = page.getByTestId("fixture-long-label");
  const label = await long.evaluate((element) => {
    const content = element.querySelector(".v-btn__content");
    const style = window.getComputedStyle(content);
    return {
      buttonWidth: element.getBoundingClientRect().width,
      buttonRight: element.getBoundingClientRect().right,
      contentRight: content.getBoundingClientRect().right,
      clipped: content.scrollWidth > content.clientWidth,
      textOverflow: style.textOverflow,
      height: element.getBoundingClientRect().height
    };
  });
  assert.ok(label.buttonWidth <= 160.5, `the long button stays in its 160px (${label.buttonWidth})`);
  assert.ok(label.contentRight <= label.buttonRight + 0.5, "the label stays inside its button");
  assert.equal(label.clipped, true);
  assert.equal(label.textOverflow, "ellipsis");
  assert.equal(Math.round(label.height), 40, "the label stays on one line");
  // A touch target reaching past a scroll container's corner adds no scrollbar.
  const corner = await page.getByTestId("fixture-button-corner").evaluate((element) => ({
    extraWidth: element.scrollWidth - element.clientWidth,
    extraHeight: element.scrollHeight - element.clientHeight
  }));
  assert.deepEqual(corner, { extraWidth: 0, extraHeight: 0 });
  // FABs keep Material 3's sizes, not the common button's 40dp.
  for (const [id, width, height] of [
    ["fixture-fab", 56, 56],
    ["fixture-fab-small", 40, 40],
    ["fixture-fab-large", 96, 96],
    ["fixture-fab-extended", null, 56]
  ]) {
    const box = await page.getByTestId(id).locator(".v-btn").boundingBox();
    assert.equal(Math.round(box.height), height, `${id} height`);
    if (width) assert.equal(Math.round(box.width), width, `${id} width`);
  }
  // An elevated card has its level-1 shadow; flat and tonal cards have none.
  const shadows = {};
  for (const variant of ["elevated", "flat", "tonal"]) {
    shadows[variant] = await page.getByTestId(`fixture-card-${variant}`).evaluate((element) => window.getComputedStyle(element).boxShadow);
  }
  // A shadow of zero offsets, blur and spread (Vuetify's level 0) draws nothing.
  const drawsShadow = (shadow) => shadow !== "none" &&
    shadow.replace(/rgba?\([^)]*\)/gu, "").split(/[\s,]+/u).some((length) => Number.parseFloat(length) > 0);
  assert.equal(drawsShadow(shadows.elevated), true, shadows.elevated);
  assert.deepEqual([drawsShadow(shadows.flat), drawsShadow(shadows.tonal)], [false, false], JSON.stringify(shadows));
  await page.close();
});

async function openMainDestination(page, label) {
  await page.getByRole("link", { name: label, exact: true }).filter({ visible: true }).first().click();
}

test("adjacent icon buttons are at least 32dp and each answers a press on its own box, by mouse and by touch", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 120_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const width of [390, 1280]) {
      for (const touch of [false, true]) {
        const how = `${width}px ${touch ? "touch" : "mouse"}`;
        const context = await browser.newContext({ baseURL: vite.baseURL, viewport: { width, height: 900 }, hasTouch: touch });
        try {
          const page = await context.newPage();
          await page.goto("/home/buttons");
          for (const name of ["history", "edit", "more", "info", "archive"]) {
            const button = page.getByTestId(`fixture-adjacent-${name}`);
            await button.scrollIntoViewIfNeeded();
            const box = await button.boundingBox();
            assert.ok(Math.round(box.width) >= 32 && Math.round(box.height) >= 32, `${how} ${name} is ${box.width}x${box.height}`);
            // Its centre and the points just inside its sides are its own, not under its neighbour's touch target.
            const y = box.y + box.height / 2;
            for (const x of [box.x + 1, box.x + box.width / 2, box.x + box.width - 1]) {
              const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".v-btn")?.dataset.testid, [x, y]);
              assert.equal(hit, `fixture-adjacent-${name}`, `${how} ${name} at x=${Math.round(x - box.x)}`);
            }
            const centre = [box.x + box.width / 2, y];
            await (touch ? page.touchscreen.tap(...centre) : page.mouse.click(...centre));
            await expect(page.getByTestId("fixture-adjacent-pressed"), how).toHaveText(name);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("shell-web Up follows the tab's trail, falls back to the parent and returns to where the person was", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 180_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
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
    // A pasted edit link goes Up to its record: the parent "/contacts/:id" takes the id from the route.
    await pasted.goto("/home/contacts/ada/edit");
    await expect(shellPageTitle(pasted)).toHaveText("Edit contact");
    await pressShellBack(pasted);
    await expect(pasted).toHaveURL(/\/home\/contacts\/ada$/u);
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
});

// What an element in the bar is: its tag, whether it is the action's own button and the attributes it carries.
async function describeElement(locator) {
  return locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    button: element.classList.contains("v-btn") || element.classList.contains("v-list-item"),
    href: element.getAttribute("href"),
    target: element.getAttribute("target"),
    download: element.getAttribute("download"),
    color: window.getComputedStyle(element).color
  }));
}

test("page actions carry their attributes in every form, collapse into the overflow menu and keep the primary action adaptive", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 150_000
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
      const compact = viewport.name === "compact";
      await page.goto("/home/actions");
      const bar = page.getByTestId("jskit-shell-app-bar");
      const error = await readRoleColor(page, "error");
      const overflow = bar.getByTestId("jskit-shell-page-actions-overflow");

      // Compact: the bar keeps its one trailing place for the primary action or the avatar, so every action is in the
      // overflow menu; wider: every action but the overflow one is in the bar.
      const inBar = compact
        ? []
        : ["fixture-action-edit", "fixture-action-export", "fixture-action-site", "fixture-action-delete"];
      const inMenu = compact
        ? [
            "fixture-action-edit",
            "fixture-action-export",
            "fixture-action-site",
            "fixture-action-delete",
            "fixture-action-duplicate"
          ]
        : ["fixture-action-duplicate"];
      for (const id of inBar) {
        const element = await describeElement(bar.getByTestId(id));
        assert.equal(element.button, true, `${at} ${id}: the attribute is on the action's own button`);
      }
      await expect(overflow, at).toHaveAccessibleName("More actions");
      await expect(bar.locator("[data-testid=fixture-action-duplicate]"), at).toHaveCount(0);

      // The bar's own forms keep a download, a new tab and the error colour.
      if (!compact) {
        const exportAction = await describeElement(bar.getByTestId("fixture-action-export"));
        assert.deepEqual(
          [exportAction.tag, exportAction.href, exportAction.download],
          ["a", "/records.csv", "records.csv"],
          at
        );
        const site = await describeElement(bar.getByTestId("fixture-action-site"));
        assert.deepEqual([site.tag, site.href, site.target], ["a", "https://example.com/", "_blank"], at);
        assert.equal((await describeElement(bar.getByTestId("fixture-action-delete"))).color, error, `${at} Delete is error`);
      }

      // The menu holds the rest in bar order, with their attributes, and runs their handlers.
      await overflow.click();
      const menu = page.getByRole("menu");
      await expect(menu, at).toBeVisible();
      assert.deepEqual(
        await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.dataset.testid)),
        inMenu,
        at
      );
      if (compact) {
        const exportItem = await describeElement(menu.getByTestId("fixture-action-export"));
        assert.deepEqual([exportItem.tag, exportItem.href, exportItem.download], ["a", "/records.csv", "records.csv"], at);
        const site = await describeElement(menu.getByTestId("fixture-action-site"));
        assert.deepEqual([site.tag, site.href, site.target], ["a", "https://example.com/", "_blank"], at);
        assert.equal((await describeElement(menu.getByTestId("fixture-action-delete"))).color, error, `${at} Delete is error`);
      }
      await menu.getByRole("menuitem", { name: "Duplicate" }).click();
      await expect(page.getByTestId("fixture-action-log"), at).toHaveText("duplicate");
      await expect(menu, at).toBeHidden();
      if (compact) {
        await overflow.click();
        await expect(page.getByRole("menu"), at).toBeVisible();
        await page.getByRole("menu").getByRole("menuitem", { name: "Delete" }).click();
        await expect(page.getByTestId("fixture-action-log"), at).toHaveText("duplicate,delete");
      }

      // The primary action: an extended FAB on compact and medium windows, the bar's filled button on wider ones; its
      // click handler opens a dialog.
      const primary = page.getByTestId("fixture-primary");
      if (viewport.name === "expanded") {
        await expect(bar.getByTestId("fixture-primary"), at).toHaveText("New record");
        assert.equal((await describeElement(primary)).button, true, at);
        await expect(page.locator(".v-fab"), at).toHaveCount(0);
      } else {
        await expect(primary, at).toHaveClass(/v-fab--extended/u);
        await expect(primary.getByRole("button", { name: "New record" }), at).toBeVisible();
        await expect(bar.getByText("New record"), at).toHaveCount(0);
      }
      await (viewport.name === "expanded" ? primary : primary.locator(".v-btn")).click();
      await expect(page.getByTestId("fixture-new-dialog"), at).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("fixture-new-dialog"), at).toBeHidden();
      await page.close();
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("a nested component's title gives the page's own title back, and Save returns to the list with its query", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
    await page.goto("/home/actions?view=table");
    await expect(shellPageTitle(page)).toHaveText("Page actions");
    await page.getByTestId("fixture-toggle-panel").click();
    await expect(shellPageTitle(page)).toHaveText("Panel title");
    await page.getByTestId("fixture-toggle-panel").click();
    await expect(page.getByTestId("fixture-title-claim")).toHaveCount(0);
    await expect(shellPageTitle(page)).toHaveText("Page actions");

    // Save finishes to the list it was opened from, which comes back with its query; so does the close, the form's
    // Cancel, which takes the Up arrow's place instead of sitting beside it.
    await page.getByRole("link", { name: "New entry", exact: true }).click();
    await expect(page).toHaveURL(/\/home\/actions\/new$/u);
    await shellPageActionButton(page, "Save").click();
    await expect(page).toHaveURL(/\/home\/actions\?view=table$/u);
    await page.getByRole("link", { name: "New entry", exact: true }).click();
    const close = page.getByTestId("jskit-shell-back");
    await expect(close).toHaveAttribute("data-action", "close");
    await expect(close).toHaveAccessibleName("Cancel");
    // The close and Save, with no Cancel beside them.
    await expect(page.getByTestId("jskit-shell-app-bar").getByRole("button")).toHaveCount(2);
    await close.click();
    await expect(page).toHaveURL(/\/home\/actions\?view=table$/u);
    await expect(page.getByTestId("jskit-shell-back")).toHaveCount(0);
    // The close replaced the form's entry, so Back doesn't reopen it.
    await page.goBack();
    await expect(page).toHaveURL(/\/home\/actions\?view=table$/u);
    await page.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

test("on a phone, the bar keeps the items that fit beside the whole title, moves the rest into its menu and keeps each one mounted", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
  const bar = page.getByTestId("jskit-shell-app-bar");
  const overflow = bar.getByTestId("jskit-shell-page-actions-overflow");
  const items = page.getByTestId("jskit-shell-page-actions-overflow-items");
  const barItems = () =>
    bar.locator(".shell-layout__top-right [data-testid=fixture-status]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label"))
    );
  const room = () =>
    page.evaluate(() => {
      const title = document.querySelector("[data-testid=jskit-shell-page-title]");
      const trailing = Array.from(document.querySelectorAll("[data-testid=jskit-shell-app-bar] .v-btn")).at(-1);
      return {
        title: Math.round(title.getBoundingClientRect().width),
        clipped: title.scrollWidth > title.clientWidth + 1,
        right: Math.round(trailing.getBoundingClientRect().right)
      };
    });
  // Every item, in the bar or the menu, mounted once and never unmounted.
  const lifecycle = () => page.evaluate(() => window.__fixtureStatusLifecycle);
  const mountedOnce = { "Tools mounted": 1, "Status mounted": 1, "Account mounted": 1 };

  // Tools, status and the account avatar beside a short title and the page actions' menu: all three fit, so all three
  // stay in the bar, and the menu holds only the page actions.
  await page.goto("/home/actions?topRight=3&title=Actions");
  await expect(shellPageTitle(page)).toHaveText("Actions");
  await expect.poll(barItems).toEqual(["Tools", "Status", "Account"]);
  await expect(bar.locator(".shell-page-action")).toHaveCount(0);
  const short = await room();
  assert.ok(!short.clipped, `the short title is whole (${short.title}px)`);
  assert.ok(short.right <= 390, `the avatar is in the window (${short.right}px)`);
  await overflow.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Export", "Open site", "Delete", "Duplicate"]);
  await expect(items).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();

  // A title too long for the bar: the items farthest from the corner move into the menu, after the page actions, and
  // the avatar stays. The status's own surface stays on the page while its button is in the closed menu.
  await page.getByTestId("fixture-toggle-long-title").click();
  await expect(shellPageTitle(page)).toHaveText("Quarterly statements for every supplier");
  await expect.poll(barItems).toEqual(["Account"]);
  await expect(page.getByTestId("fixture-status")).toHaveCount(3);
  await expect(page.getByTestId("fixture-status-surface")).toBeVisible();
  const long = await room();
  assert.ok(long.right <= 390, `the avatar is in the window (${long.right}px)`);
  await overflow.click();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Export", "Open site", "Delete", "Duplicate"]);
  await expect(items.getByTestId("fixture-status")).toHaveCount(2);
  await expect(items.getByRole("button", { name: "Tools", exact: true })).toBeVisible();
  await expect(items.getByRole("button", { name: "Status", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(items).toBeHidden();
  await expect(page.getByTestId("fixture-status-surface")).toBeVisible();

  // The short title again: the items come back to the bar.
  await page.getByTestId("fixture-toggle-long-title").click();
  await expect(shellPageTitle(page)).toHaveText("Actions");
  await expect.poll(barItems).toEqual(["Tools", "Status", "Account"]);
  assert.deepEqual(await lifecycle(), mountedOnce);

  // A form's Save is a trailing item too: whatever does not fit beside it and the whole title, the avatar included,
  // is in the menu, and nothing remounts.
  await page.getByRole("link", { name: "New entry", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByTestId("jskit-shell-back")).toHaveAttribute("data-action", "close");
  await expect(page.getByTestId("fixture-status")).toHaveCount(3);
  const form = await room();
  const formItems = await barItems();
  assert.ok(!form.clipped || formItems.length === 0, `the form's title is whole, or the bar holds none of its items (${formItems})`);
  assert.ok(form.right <= 390, `the bar's trailing item is in the window (${form.right}px)`);
  assert.deepEqual(formItems, ["Tools", "Status", "Account"].slice(3 - formItems.length), "the bar keeps the items nearest the corner");
  await page.getByTestId("jskit-shell-back").click();
  await expect(shellPageTitle(page)).toHaveText("Actions");
  await expect.poll(barItems).toEqual(["Tools", "Status", "Account"]);

  // Wider windows keep every item in the bar, the same instances.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar.getByTestId("fixture-status")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(barItems).toEqual(["Tools", "Status", "Account"]);
  assert.deepEqual(await lifecycle(), mountedOnce);
  await page.close();
});

function shellPageActionButton(page, name) {
  return page.getByTestId("jskit-shell-app-bar").getByRole("button", { name, exact: true });
}

test("a segmented button and a button group in a filter row's narrow column keep 12dp segments and whole labels", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ baseURL: vite.baseURL, viewport });
      await page.goto("/home/components");
      for (const testId of ["fixture-segmented-two", "fixture-button-group"]) {
        const at = `${testId} at ${viewport.width}px`;
        const group = await page.getByTestId(testId).evaluate((element) => ({
          scrolls: element.scrollWidth > element.clientWidth + 1,
          widths: `group ${element.clientWidth}/${element.scrollWidth}px in a ${element.parentElement.clientWidth}px row: ${window.getComputedStyle(element.parentElement).gridTemplateColumns}`,
          segments: Array.from(element.querySelectorAll(":scope > .v-btn")).map((segment) => {
            const style = window.getComputedStyle(segment);
            const content = segment.querySelector(".v-btn__content");
            return {
              padding: [style.paddingInlineStart, style.paddingInlineEnd],
              cut: content.scrollWidth > content.clientWidth,
              room: segment.getBoundingClientRect().width - content.scrollWidth
            };
          })
        }));
        assert.equal(group.scrolls, false, `${at}: no segment scrolls inside the group (${group.widths})`);
        for (const segment of group.segments) {
          assert.deepEqual(segment.padding, ["12px", "12px"], `${at}: Material 3's 12dp segment sides`);
          assert.equal(segment.cut, false, `${at}: the whole label shows`);
          assert.ok(segment.room >= 23, `${at}: the label keeps its 12dp each side (${segment.room}px)`);
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

// A dialog is, with a menu, one of Vuetify's root defaults providers: under any VDialog default, an expansion panel
// around the dialog re-rendering rebuilds the dialog's defaults, its virtual-scroll list, given its items anew, loses
// their heights, and scrollToIndex gives up (material-web's README, Upstream workarounds). JSKIT sets no VDialog
// defaults; this fails with `VDialog: { VCard: {} }` in them.
test("a virtual-scroll list in a dialog reaches its last item after the page around it re-renders", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 60_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
    await page.goto("/home/components");
    await page.getByRole("button", { name: "Open bookings" }).click();
    const list = page.getByTestId("fixture-bookings-scroll");
    await expect(list.getByText("Booking 1", { exact: true })).toBeVisible();
    for (const renders of ["1", "2"]) {
      await list.evaluate((element) => { element.scrollTop = 0; });
      await page.getByRole("button", { name: /^Last booking/u }).click();
      await expect(page.getByTestId("fixture-page-renders")).toHaveText(renders);
      await expect(list.getByText("Booking 40", { exact: true }), `jump ${renders}`).toBeVisible();
    }
    await page.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});

// A list item's subtitle is at full strength, as Material 3's list draws its supporting text: on-surface-variant on an
// item at rest, the item's own colour on an active one, over the card and the active item's selected state layer.
// Vuetify's medium-emphasis opacity measured 4.35:1 at rest and 4.45:1 active on the card, under WCAG's 4.5:1.
test("a list item's subtitle is readable at rest and active, in light and dark", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 60_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: theme, viewport: { width: 390, height: 844 } });
    await page.goto(`/home/components?theme=${theme}`);
    const onSurfaceVariant = await readRoleColor(page, "on-surface-variant");
    for (const testId of ["fixture-active-item", "fixture-rest-item"]) {
      const item = await page.getByTestId(testId).evaluate((element) => {
        const style = (node) => window.getComputedStyle(node);
        const overlay = element.querySelector(".v-list-item__overlay");
        const subtitle = element.querySelector(".v-list-item-subtitle");
        return {
          card: style(element.closest(".v-card")).backgroundColor,
          color: style(element).color,
          // Vuetify draws a state layer only on an item that is active or can be clicked.
          overlay: overlay ? [style(overlay).backgroundColor, Number(style(overlay).opacity)] : ["rgb(0, 0, 0)", 0],
          subtitle: [style(subtitle).color, Number(style(subtitle).opacity)]
        };
      });
      const at = `${testId} in ${theme}`;
      // What shows under the subtitle: the card, then the item's state layer at its opacity.
      const card = parseRgb(item.card);
      const layer = parseRgb(item.overlay[0]);
      const mix = (top, bottom, alpha) => ({
        red: top.red * alpha + bottom.red * (1 - alpha),
        green: top.green * alpha + bottom.green * (1 - alpha),
        blue: top.blue * alpha + bottom.blue * (1 - alpha)
      });
      const background = mix(layer, card, layer.alpha * item.overlay[1]);
      const text = parseRgb(item.subtitle[0]);
      const ratio = contrastRatio(mix(text, background, text.alpha * item.subtitle[1]), background);
      assert.equal(item.subtitle[1], 1, `${at}: the subtitle is at full strength`);
      assert.equal(item.subtitle[0], testId === "fixture-rest-item" ? onSurfaceVariant : item.color, `${at}: its colour`);
      assert.ok(ratio >= 4.5, `${at}: the subtitle's contrast was ${ratio.toFixed(2)}:1`);
    }
    await page.close();
  }
});

test("an app's own v-bottom-navigation is Material 3's navigation bar: a 64x32 indicator around a 24dp icon, in light and dark", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 60_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: theme, viewport: { width: 390, height: 844 } });
    await page.goto(`/home/components?theme=${theme}`);
    const roles = {};
    for (const role of ["secondary-container", "on-secondary-container", "on-surface", "on-surface-variant"]) {
      roles[role] = await readRoleColor(page, role);
    }
    const read = (testId) => page.getByTestId(testId).evaluate((button) => {
      const style = (node) => window.getComputedStyle(node);
      const icon = button.querySelector(".v-icon");
      // A label in a span of its own beside an icon in the content, or the content itself beside a prepend-icon.
      const label = button.querySelector(".v-btn__content > span") || button.querySelector(".v-btn__content");
      const box = (node) => node.getBoundingClientRect();
      const visible = (node) => node && style(node).display !== "none";
      return {
        indicator: [Math.round(box(icon).width), Math.round(box(icon).height), style(icon).borderTopLeftRadius],
        glyph: Math.round(box(icon.querySelector("svg")).width),
        colors: [style(icon).backgroundColor, style(icon).color, style(label).color],
        stateLayer: style(icon).backgroundImage,
        label: [style(label).fontSize, style(label).lineHeight, style(label).fontWeight],
        gap: Math.round(box(label).top - box(icon).bottom),
        // The state layer is the indicator's, not Vuetify's across the whole button.
        buttonLayers: [".v-btn__overlay", ".v-btn__underlay"].some((selector) => visible(button.querySelector(`:scope > ${selector}`)))
      };
    });
    const at = (name) => `${name} in ${theme}`;
    const active = await read("fixture-navigation-active");
    const rest = await read("fixture-navigation-rest");
    for (const [name, destination] of [["active", active], ["rest", rest]]) {
      assert.deepEqual(destination.indicator, [64, 32, "16px"], at(`${name}: the indicator`));
      assert.equal(destination.glyph, 24, at(`${name}: the icon`));
      assert.deepEqual(destination.label, ["12px", "16px", "500"], at(`${name}: label-medium`));
      assert.equal(destination.gap, 4, at(`${name}: the label 4dp below the indicator`));
      assert.equal(destination.buttonLayers, false, at(`${name}: no whole-button state layer`));
    }
    assert.deepEqual(active.colors, [roles["secondary-container"], roles["on-secondary-container"], roles["on-surface"]], at("active"));
    assert.deepEqual(rest.colors, ["rgba(0, 0, 0, 0)", roles["on-surface-variant"], roles["on-surface-variant"]], at("rest"));
    // Hovered, the destination's indicator takes its state layer.
    await page.getByTestId("fixture-navigation-rest").hover();
    await expect.poll(() => page.getByTestId("fixture-navigation-rest").locator(".v-icon")
      .evaluate((icon) => window.getComputedStyle(icon).backgroundImage)).not.toBe(rest.stateLayer);
    await page.close();
  }
});

test("an app's colours win over the navigation bar's, and a denser bar, a badge and an append icon keep its shape", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 60_000
}, async (t) => {
  const { vite, browser } = await startFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
  await page.goto("/home/components");
  const roles = {};
  for (const role of ["primary", "on-primary", "secondary-container", "on-surface-variant"]) {
    roles[role] = await readRoleColor(page, role);
  }
  const transparent = "rgba(0, 0, 0, 0)";
  const read = (testId) => page.getByTestId(testId).evaluate((button) => {
    const style = (node) => window.getComputedStyle(node);
    const box = (node) => node.getBoundingClientRect();
    const bar = box(button.closest(".v-bottom-navigation"));
    // The destination's icon, a prepend-icon or one in a badge; its label, in a span or the content itself.
    const icon = button.querySelector(".v-btn__prepend > .v-icon, .v-badge__wrapper > .v-icon");
    const label = button.querySelector(".v-btn__content > span") || button.querySelector(".v-btn__content");
    return {
      indicator: [Math.round(box(icon).width), Math.round(box(icon).height)],
      colors: [style(icon).backgroundColor, style(icon).color, style(label).color],
      fits: box(icon).top >= bar.top - 0.5 && box(label).bottom <= bar.bottom + 0.5,
      // An append icon and a badge's own icon are not the destination's.
      otherIcons: Array.from(button.querySelectorAll(".v-btn__append .v-icon, .v-badge__badge .v-icon"))
        .map((other) => Math.round(box(other).width))
    };
  });

  // A bar the app colours: every destination takes the bar's on-primary, and the active indicator is drawn in it.
  const coloured = { active: await read("fixture-navigation-coloured-active"), rest: await read("fixture-navigation-coloured-rest") };
  assert.deepEqual(coloured.active.colors.slice(1), [roles["on-primary"], roles["on-primary"]], "coloured bar: active");
  assert.ok(![transparent, roles["secondary-container"]].includes(coloured.active.colors[0]), `coloured bar: ${coloured.active.colors[0]}`);
  assert.deepEqual(coloured.rest.colors, [transparent, roles["on-primary"], roles["on-primary"]], "coloured bar: rest");

  // A bar whose color tints its active destination: that one is primary, the rest keep Material 3's colours.
  const tinted = { active: await read("fixture-navigation-tinted-active"), rest: await read("fixture-navigation-tinted-rest") };
  assert.deepEqual(tinted.active.colors.slice(1), [roles.primary, roles.primary], "tinted bar: active");
  assert.ok(![transparent, roles["secondary-container"]].includes(tinted.active.colors[0]), `tinted bar: ${tinted.active.colors[0]}`);
  assert.deepEqual(tinted.rest.colors, [transparent, roles["on-surface-variant"], roles["on-surface-variant"]], "tinted bar: rest");

  // Denser bars fit their destinations: a comfortable one (48dp) drops the label's 4dp, a compact one (40dp) has a
  // 24dp indicator. The badge's icon and an append icon (below the label of a stacked button) keep their own size.
  for (const [density, indicator] of [["comfortable", [64, 32]], ["compact", [64, 24]]]) {
    for (const name of ["active", "rest"]) {
      const destination = await read(`fixture-navigation-${density}-${name}`);
      assert.deepEqual(destination.indicator, indicator, `${density} ${name}: the indicator`);
      assert.equal(destination.fits, true, `${density} ${name}: the indicator and label inside the bar`);
    }
    for (const name of ["active", "append"]) {
      const destination = await read(`fixture-navigation-${density}-${name}`);
      assert.deepEqual(destination.indicator, indicator, `${density} ${name}: the indicator`);
      assert.equal(destination.otherIcons.length, 1, `${density} ${name}: its badge or append icon`);
      assert.ok(destination.otherIcons[0] < 64, `${density} ${name}: ${destination.otherIcons}`);
    }
  }

  // A horizontal bar lays its destinations flat, as Vuetify draws them: no indicator around the icon.
  for (const name of ["active", "rest"]) {
    const destination = await read(`fixture-navigation-horizontal-${name}`);
    assert.ok(destination.indicator[0] < 64, `horizontal ${name}: ${destination.indicator}`);
  }
  await page.close();
});

test("segmented buttons, filter chips, fixed tabs, menus and dialog actions take Material 3's shapes and colours", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
    await page.goto("/home/components");
    const roles = {};
    for (const role of ["outline", "secondary-container", "on-secondary-container", "surface-container"]) {
      roles[role] = await readRoleColor(page, role);
    }
    const transparent = "rgba(0, 0, 0, 0)";

    // The segmented button: a 40dp pill in the outline role, equal segments with 48dp touch targets, the selected one
    // in secondary-container leading with a check, which replaces a segment's own icon.
    const segmented = page.getByTestId("fixture-segmented");
    const group = await segmented.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const segments = Array.from(element.querySelectorAll(":scope > .v-btn")).map((segment) => {
        const segmentStyle = window.getComputedStyle(segment);
        const check = window.getComputedStyle(segment.querySelector(".v-btn__content"), "::before");
        return {
          width: segment.getBoundingClientRect().width,
          height: segment.getBoundingClientRect().height,
          background: segmentStyle.backgroundColor,
          color: segmentStyle.color,
          check: check.content !== "none" && check.maskImage.includes("svg"),
          target: Number.parseFloat(window.getComputedStyle(segment, "::before").height)
        };
      });
      return {
        height: element.getBoundingClientRect().height,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        border: [style.borderTopWidth, style.borderTopColor],
        segments
      };
    });
    assert.equal(Math.round(group.height), 40);
    assert.ok(group.radius >= 20, `the segmented button is a pill (${group.radius}px)`);
    assert.deepEqual(group.border, ["1px", roles.outline]);
    const widths = group.segments.map((segment) => segment.width);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `equal segments: ${widths.join(", ")}`);
    // The pill's 1dp outline is inside its 40dp.
    assert.deepEqual(group.segments.map((segment) => Math.round(segment.height)), [38, 38, 38]);
    assert.deepEqual(group.segments.map((segment) => segment.target), [48, 48, 48]);
    assert.deepEqual(group.segments[0], { ...group.segments[0], background: roles["secondary-container"], color: roles["on-secondary-container"], check: true });
    assert.deepEqual([group.segments[1].background, group.segments[1].check], [transparent, false]);
    await segmented.getByRole("button", { name: "Month" }).click();
    // The selected container fades in.
    await expect.poll(() => segmented.getByRole("button", { name: "Month" }).evaluate((element) =>
      window.getComputedStyle(element).backgroundColor)).toBe(roles["secondary-container"]);
    const month = await segmented.getByRole("button", { name: "Month" }).evaluate((element) => ({
      background: window.getComputedStyle(element).backgroundColor,
      iconMask: window.getComputedStyle(element.querySelector(".v-btn__prepend .v-icon")).maskImage,
      glyph: window.getComputedStyle(element.querySelector(".v-btn__prepend svg")).visibility,
      contentCheck: window.getComputedStyle(element.querySelector(".v-btn__content"), "::before").content
    }));
    assert.equal(month.background, roles["secondary-container"]);
    assert.match(month.iconMask, /svg/u);
    assert.equal(month.glyph, "hidden");
    assert.equal(month.contentCheck, "none");

    // Filter chips: 32dp, 8dp corners, an outline-role border unselected, secondary-container with a check selected,
    // and a 48dp touch target; in a chip group and toggled with aria-pressed alike.
    const chip = (id) => page.getByTestId(id).evaluate((element) => {
      const style = window.getComputedStyle(element);
      const check = window.getComputedStyle(element, "::before");
      return {
        height: Math.round(element.getBoundingClientRect().height),
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        border: [style.borderTopWidth, style.borderTopColor],
        check: Boolean(element.querySelector(".v-chip__filter .v-icon")?.checkVisibility()) ||
          (check.content !== "none" && check.maskImage.includes("svg")),
        target: Math.round(Number.parseFloat(window.getComputedStyle(element, "::after").height))
      };
    });
    const selected = { height: 32, radius: "8px", background: roles["secondary-container"], check: true, target: 48 };
    const unselected = { height: 32, radius: "8px", background: transparent, border: ["1px", roles.outline], check: false, target: 48 };
    const open = await chip("fixture-chip-open");
    assert.deepEqual({ ...open, border: undefined }, { ...selected, border: undefined });
    assert.deepEqual(await chip("fixture-chip-closed"), unselected);
    const starred = await chip("fixture-pressed-chip");
    assert.deepEqual({ ...starred, border: undefined }, { ...selected, border: undefined });
    await page.getByTestId("fixture-pressed-chip").click();
    await expect(page.getByTestId("fixture-pressed-chip")).toHaveAttribute("aria-pressed", "false");
    assert.deepEqual(await chip("fixture-pressed-chip"), unselected);
    const assist = await page.getByTestId("fixture-outlined-chip").evaluate((element) => window.getComputedStyle(element).borderTopColor);
    assert.equal(assist, roles.outline);

    // Five fixed tabs share a phone's width without a 90dp minimum; tabs whose labels can't fit scroll, uncut.
    const tabs = (id) => page.getByTestId(id).evaluate((element) => {
      const container = element.querySelector(".v-slide-group__container");
      return {
        overflowing: container.scrollWidth > container.clientWidth + 1,
        widths: Array.from(element.querySelectorAll(".v-tab")).map((tab) => tab.getBoundingClientRect().width),
        cut: Array.from(element.querySelectorAll(".v-tab .v-btn__content")).some((label) => label.scrollWidth > label.clientWidth + 1)
      };
    });
    const grow = await tabs("fixture-grow-tabs");
    assert.equal(grow.overflowing, false, JSON.stringify(grow));
    assert.ok(Math.max(...grow.widths) - Math.min(...grow.widths) <= 1, `equal tabs: ${grow.widths.join(", ")}`);
    assert.ok(Math.min(...grow.widths) < 90, `tabs narrower than Vuetify's 90px minimum: ${grow.widths.join(", ")}`);
    const long = await tabs("fixture-long-tabs");
    assert.deepEqual([long.overflowing, long.cut], [true, false], JSON.stringify(long));

    // A menu's own list is surface-container at level 2; a list in a rich menu panel is a plain list.
    const list = (id) => page.getByTestId(id).evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { background: style.backgroundColor, shadow: style.boxShadow !== "none" && /[1-9]px/u.test(style.boxShadow) };
    });
    await page.getByRole("button", { name: "Plain menu" }).click();
    assert.deepEqual(await list("fixture-menu-list"), { background: roles["surface-container"], shadow: true });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rich menu" }).click();
    assert.deepEqual(await list("fixture-panel-list"), { background: transparent, shadow: false });
    await page.keyboard.press("Escape");

    // A disabled filled button is one pill: its state layer, shown at rest, takes the button's corners instead of
    // reaching out square past them.
    const disabled = await page.getByTestId("fixture-disabled-button").evaluate((element) => ({
      radius: window.getComputedStyle(element).borderTopLeftRadius,
      layers: Array.from(element.querySelectorAll(":scope > .v-btn__overlay, :scope > .v-btn__underlay"))
        .map((layer) => window.getComputedStyle(layer).borderTopLeftRadius)
    }));
    assert.ok(Number.parseFloat(disabled.radius) >= 20, `the disabled button is a pill (${disabled.radius})`);
    assert.deepEqual(disabled.layers, disabled.layers.map(() => disabled.radius));
    assert.ok(disabled.layers.length > 0);
    // Its container is on-surface at 12% and its label at 38%, over the primary its colour gives it.
    const onSurface = (await readRoleColor(page, "on-surface")).replace(/^rgb\((.*)\)$/u, "$1");
    assert.deepEqual(
      await page.getByTestId("fixture-disabled-button").evaluate((element) => [
        window.getComputedStyle(element).backgroundColor,
        window.getComputedStyle(element).color
      ]),
      [`rgba(${onSurface}, 0.12)`, `rgba(${onSurface}, 0.38)`]
    );

    // A button to the page above this one isn't active (selected) here.
    await expect(page.getByTestId("fixture-home-button")).not.toHaveClass(/v-btn--active/u);

    // A pagination's current page is a light activated layer inside its shape, so its number shows.
    const current = await page.getByTestId("fixture-pagination").locator(".v-pagination__item--is-active .v-btn").evaluate((element) => {
      const overlay = window.getComputedStyle(element.querySelector(":scope > .v-btn__overlay"));
      return {
        opacity: Number.parseFloat(overlay.opacity),
        radius: overlay.borderTopLeftRadius === window.getComputedStyle(element).borderTopLeftRadius
      };
    });
    assert.ok(current.opacity > 0 && current.opacity <= 0.2, `the current page's layer (${current.opacity})`);
    assert.equal(current.radius, true);

    // A shown placeholder is on-surface-variant at full strength; a labelled field hides it until active.
    const placeholder = (id) => page.getByTestId(id).locator("input").evaluate((element) => {
      const style = window.getComputedStyle(element, "::placeholder");
      return [style.color, style.opacity];
    });
    assert.deepEqual(await placeholder("fixture-placeholder"), [await readRoleColor(page, "on-surface-variant"), "1"]);
    assert.equal((await placeholder("fixture-labelled"))[1], "0");

    // Cards and expansion panels rest flat; a dialog keeps its level 3.
    const drawsShadow = (shadow) => shadow !== "none" &&
      shadow.replace(/rgba?\([^)]*\)/gu, "").split(/[\s,]+/u).some((length) => Number.parseFloat(length) > 0);
    const shadowOf = (locator) => locator.evaluate((element) => window.getComputedStyle(element).boxShadow);
    const card = await shadowOf(page.getByTestId("fixture-card"));
    assert.equal(drawsShadow(card), false, card);
    const panels = await page.getByTestId("fixture-expansion-panels").evaluate((element) =>
      Array.from(element.querySelectorAll(".v-expansion-panel, .v-expansion-panel__shadow"))
        .map((part) => window.getComputedStyle(part).display === "none" ? "none" : window.getComputedStyle(part).boxShadow));
    assert.deepEqual(panels.map(drawsShadow), panels.map(() => false), JSON.stringify(panels));

    // Dialog actions sit 24dp from the dialog's sides and bottom, 8dp apart, once the dialog has scaled in.
    await page.getByRole("button", { name: "Open dialog" }).click();
    const dialog = page.getByTestId("fixture-dialog");
    await expect(dialog).toBeVisible();
    const dialogActions = () => dialog.locator(".v-card-actions").evaluate((element) => {
      const style = window.getComputedStyle(element);
      const card = element.closest(".v-card").getBoundingClientRect();
      const buttons = Array.from(element.querySelectorAll(".v-btn")).map((button) => button.getBoundingClientRect());
      return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        gap: Math.round(buttons[1].left - buttons[0].right),
        right: Math.round(card.right - buttons[1].right),
        bottom: Math.round(card.bottom - buttons[1].bottom)
      };
    });
    await expect.poll(dialogActions).toEqual({ padding: ["0px", "24px", "24px", "24px"], gap: 8, right: 24, bottom: 24 });
    const dialogShadow = await shadowOf(dialog);
    assert.equal(drawsShadow(dialogShadow), true, dialogShadow);
    await page.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});
