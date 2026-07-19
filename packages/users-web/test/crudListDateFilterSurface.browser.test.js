import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, "../../..");
const PACKAGE_ROOT = path.resolve(TEST_DIRECTORY, "..");
const FIXTURE_ROOT = path.join(PACKAGE_ROOT, "fixtures", "crud-list-date-filters");
const VITE_CLI = path.join(REPOSITORY_ROOT, "node_modules", "vite", "bin", "vite.js");
const RUN_BROWSER_TEST = process.env.JSKIT_USERS_WEB_DATE_FILTER_VISUAL_INTEGRATION === "1";
const VIEWPORT_WIDTHS = Object.freeze([375, 768, 1280, 1440]);
const QUERY = "?status=active&submittedOn=2026-04-18&arrivalDate=2026-05-04..2026-05-10";

function startCapturedProcess(command, args, { cwd } = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  function waitFor(pattern, timeout = 30_000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (pattern.test(output)) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (child.exitCode !== null) {
          clearInterval(timer);
          reject(new Error(`Vite exited before ${pattern}.\n${output}`));
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${pattern}.\n${output}`));
        }
      }, 50);
    });
  }

  return {
    child,
    readOutput: () => output,
    waitFor
  };
}

async function stopProcess(runtime) {
  const child = runtime?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill("SIGTERM");
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

async function readContract(page) {
  return JSON.parse(await page.getByTestId("date-filter-contract").textContent());
}

async function openCompactFilters(page) {
  const openButton = page.getByRole("button", { name: /^Filters/u });
  if (await openButton.isVisible()) {
    await openButton.click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
  }
}

async function assertResponsiveDateControls(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://127.0.0.1:${page.__jskitPort}/${QUERY}`, {
    waitUntil: "networkidle"
  });
  await openCompactFilters(page);

  for (const name of ["Submitted date", "Arrival from", "Arrival to"]) {
    const field = page.getByLabel(name, { exact: true });
    await field.waitFor({ state: "visible" });
    const box = await field.locator("xpath=ancestor::*[contains(@class, 'v-input')][1]").boundingBox();
    assert.ok(box, `${name} is missing a visible field at ${width}px.`);
    assert.ok(box.width >= 220, `${name} is only ${box.width}px wide at ${width}px.`);
    assert.ok(box.x >= 0 && box.x + box.width <= width, `${name} overflows at ${width}px.`);
  }

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clippedFields: Array.from(document.querySelectorAll(".crud-list-date-filter-control .v-field"))
      .filter((field) => field.scrollWidth > field.clientWidth + 1)
      .length,
    visibleCalendarIcons: Array.from(document.querySelectorAll(
      ".crud-list-date-filter-control .v-field__append-inner"
    )).filter((icon) => {
      const rect = icon.getBoundingClientRect();
      return rect.width > 0 && rect.right <= window.innerWidth;
    }).length
  }));
  assert.equal(layout.scrollWidth, layout.clientWidth, `Horizontal overflow at ${width}px.`);
  assert.equal(layout.clippedFields, 0, `A date field is clipped at ${width}px.`);
  assert.equal(layout.visibleCalendarIcons, 3, `Calendar affordance missing at ${width}px.`);

  const screenshot = await page.screenshot({ fullPage: true });
  assert.ok(screenshot.length > 5_000, `Visual evidence was empty at ${width}px.`);
}

async function selectPickerDayWithKeyboard(picker, day) {
  const dayButton = picker
    .locator(".v-date-picker-month__day-btn")
    .filter({ hasText: new RegExp(`^${day}$`, "u") })
    .first();
  await dayButton.focus();
  await dayButton.press("Space");
}

test("CRUD date filters render and operate without clipping across responsive layouts", {
  skip: RUN_BROWSER_TEST
    ? false
    : "set JSKIT_USERS_WEB_DATE_FILTER_VISUAL_INTEGRATION=1 to run the browser visual regression",
  timeout: 180_000
}, async () => {
  const port = await reservePort();
  const viteRuntime = startCapturedProcess(process.execPath, [
    VITE_CLI,
    "--config",
    path.join(FIXTURE_ROOT, "vite.config.mjs"),
    "--port",
    String(port),
    "--clearScreen",
    "false"
  ], { cwd: FIXTURE_ROOT });
  let browser = null;

  try {
    await viteRuntime.waitFor(new RegExp(`http://127\\.0\\.0\\.1:${port}/`, "u"));
    const chromiumExecutablePath = String(
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ""
    ).trim();
    browser = await chromium.launch({
      headless: true,
      ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {})
    });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    page.__jskitPort = port;

    for (const width of VIEWPORT_WIDTHS) {
      await assertResponsiveDateControls(page, width);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/${QUERY}`, { waitUntil: "networkidle" });
    assert.deepEqual(await readContract(page), {
      values: {
        submittedOn: "2026-04-18",
        arrivalDate: { from: "2026-05-04", to: "2026-05-10" }
      },
      query: {
        submittedOn: "2026-04-18",
        arrivalDate: "2026-05-04..2026-05-10"
      }
    });
    await page.getByText("Submitted date: Apr 18, 2026", { exact: true }).waitFor();
    await page.getByText("Arrival: May 4, 2026 to May 10, 2026", { exact: true }).waitFor();

    const submittedField = page.getByLabel("Submitted date", { exact: true });
    await submittedField.focus();
    await submittedField.press("Enter");
    const submittedPicker = page.getByRole("dialog", { name: "Submitted date calendar" });
    await submittedPicker.waitFor({ state: "visible" });
    await selectPickerDayWithKeyboard(submittedPicker, 21);
    assert.equal((await readContract(page)).values.submittedOn, "2026-04-21");
    assert.equal((await readContract(page)).query.submittedOn, "2026-04-21");
    assert.equal(await submittedField.evaluate((element) => element === document.activeElement), true);

    const arrivalToField = page.getByLabel("Arrival to", { exact: true });
    await arrivalToField.focus();
    await arrivalToField.press("ArrowDown");
    const arrivalToPicker = page.getByRole("dialog", { name: "Arrival to calendar" });
    await arrivalToPicker.waitFor({ state: "visible" });
    await selectPickerDayWithKeyboard(arrivalToPicker, 12);
    assert.deepEqual((await readContract(page)).values.arrivalDate, {
      from: "2026-05-04",
      to: "2026-05-12"
    });
    assert.equal((await readContract(page)).query.arrivalDate, "2026-05-04..2026-05-12");

    await arrivalToField.focus();
    await arrivalToField.press("Enter");
    const clearButton = page
      .getByRole("dialog", { name: "Arrival to calendar" })
      .getByRole("button", { name: "Clear", exact: true });
    await clearButton.focus();
    await clearButton.press("Space");
    assert.deepEqual((await readContract(page)).values.arrivalDate, {
      from: "2026-05-04",
      to: ""
    });
    assert.equal((await readContract(page)).query.arrivalDate, "2026-05-04..");
    assert.equal(await arrivalToField.evaluate((element) => element === document.activeElement), true);

    const arrivalFromField = page.getByLabel("Arrival from", { exact: true });
    await arrivalFromField.focus();
    await arrivalFromField.press(" ");
    await page.getByRole("dialog", { name: "Arrival from calendar" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await arrivalFromField.evaluate((element) => element === document.activeElement), true);

    const clearAll = page.getByRole("button", { name: "Clear all", exact: true });
    await clearAll.focus();
    await clearAll.press("Space");
    assert.deepEqual((await readContract(page)).values, {
      submittedOn: "",
      arrivalDate: { from: "", to: "" }
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "networkidle" });
    const openFilters = page.getByRole("button", { name: /^Filters/u });
    const openButtonBox = await openFilters.boundingBox();
    assert.ok(openButtonBox && openButtonBox.height >= 48);
    await openFilters.click();
    const mobileSheet = page.getByRole("dialog");
    await mobileSheet.waitFor({ state: "visible" });
    const mobileSheetBox = await mobileSheet.boundingBox();
    assert.ok(mobileSheetBox && mobileSheetBox.width <= 375);
    await page.getByLabel("Arrival from", { exact: true }).waitFor({ state: "visible" });
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopProcess(viteRuntime);
  }
});
