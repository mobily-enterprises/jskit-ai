import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  DEFAULT_VIEWPORTS,
  runAdaptiveShellSmokeCase
} from "../src/test/adaptiveShellSmoke.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, "../../..");
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/adaptive-shell");
const VITE_CLI = path.join(REPOSITORY_ROOT, "node_modules", "vite", "bin", "vite.js");
const RUN_BROWSER_TEST = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1";

function startVite(port) {
  const child = spawn(process.execPath, [
    VITE_CLI,
    "--config",
    path.join(FIXTURE_ROOT, "vite.config.mjs"),
    "--port",
    String(port),
    "--clearScreen",
    "false"
  ], {
    cwd: FIXTURE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });
  let output = "";
  child.stdout.on("data", collectOutput);
  child.stderr.on("data", collectOutput);

  function collectOutput(chunk) {
    output += chunk.toString("utf8");
  }

  async function waitUntilReady() {
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(checkReadiness, 50);

      function checkReadiness() {
        if (new RegExp(`http://127\\.0\\.0\\.1:${port}/`, "u").test(output)) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (child.exitCode !== null) {
          clearInterval(timer);
          reject(new Error(`Vite exited before becoming ready.\n${output}`));
          return;
        }
        if (Date.now() - startedAt >= 30_000) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for Vite.\n${output}`));
        }
      }
    });
  }

  return Object.freeze({ child, waitUntilReady });
}

async function stopVite(runtime) {
  const child = runtime?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const forceTimer = setTimeout(forceStop, 5_000);
    child.once("exit", finishStop);
    child.kill("SIGTERM");

    function forceStop() {
      child.kill("SIGKILL");
    }

    function finishStop() {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
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
      return {
        clientHeight: label.clientHeight,
        clientWidth: label.clientWidth,
        rect,
        scrollHeight: label.scrollHeight,
        scrollWidth: label.scrollWidth
      };
    });
    const furthestEnd = Math.max(...labels.map((label) => label.rect.right));
    return {
      clipped: labels.some((label) => (
        label.scrollWidth > label.clientWidth ||
        label.scrollHeight > label.clientHeight
      )),
      endGap: innerEnd - furthestEnd,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert.equal(result.clipped, false, "A drawer label was clipped or ellipsized.");
  assert.ok(result.endGap >= 9 && result.endGap <= 11, `Drawer label end gap was ${result.endGap}px.`);
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
  const port = await reservePort();
  const vite = startVite(port);
  let browser = null;

  try {
    await vite.waitUntilReady();
    const executablePath = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${port}`,
      locale: "en-US"
    });

    for (const viewport of DEFAULT_VIEWPORTS) {
      const page = await context.newPage();
      await runAdaptiveShellSmokeCase({ page, expect, viewport });
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
    await context.close();
  } finally {
    await browser?.close();
    await stopVite(vite);
  }
});
