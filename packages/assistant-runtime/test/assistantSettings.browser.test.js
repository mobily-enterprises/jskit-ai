import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

// The assistant settings pane in the shell: the top app bar carries its title and its Save, a submit button for the
// pane's form, and the pane shows a note and no Save until it has settings to edit.
const RUN = process.env.JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION === "1";
const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/settings/", import.meta.url));
const options = { skip: RUN ? false : "set JSKIT_ASSISTANT_RUNTIME_BROWSER_INTEGRATION=1 to run it", timeout: 120_000 };

function settingsDocument(targetSurfaceId, systemPrompt, workspaceId = null) {
  return {
    contentType: "application/vnd.api+json",
    json: {
      data: {
        type: "assistant-settings",
        id: targetSurfaceId,
        attributes: { targetSurfaceId, scopeKey: targetSurfaceId, workspaceId, settings: { systemPrompt } }
      }
    }
  };
}

/**
 * The shell and a browser, stopped in after hooks, which run when a test fails or times out too. The last hook prints
 * each page's errors and console errors, so a fixture that fails to render says why.
 */
async function startFixture(t) {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  const pages = [];
  t.after(() => {
    for (const { errors, console: messages } of pages) {
      if (errors.length + messages.length > 0) console.log(`page errors: ${JSON.stringify(errors)}; console errors: ${JSON.stringify(messages)}`);
    }
  });
  return { vite, browser, pages };
}

/** One page with the settings API behind it: `routes` answers "METHOD /path"; anything else fails the test. */
async function openPage({ vite, browser, pages }, { viewport, routes }) {
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(15_000);
  const api = { page, requests: [], unexpected: [], errors: [], console: [] };
  pages.push(api);
  page.on("pageerror", (error) => api.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") api.console.push(message.text().slice(0, 600));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: { authenticated: true, csrfToken: "fixture-csrf" } });
      return;
    }
    api.requests.push({ key, body: request.postDataJSON() });
    const answer = routes[key];
    if (!answer) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    await route.fulfill(typeof answer === "function" ? await answer(request.postDataJSON()) : answer);
  });
  return api;
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

const barSave = (page) => page.locator(".v-app-bar").getByRole("button", { name: "Save", exact: true });
const prompt = (page) => page.getByLabel("System prompt");

test("the app bar's Save submits the assistant settings, on phones and wide windows", options, async (t) => {
  const fixture = await startFixture(t);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const answer = Promise.withResolvers();
    const api = await openPage(fixture, {
      viewport,
      routes: {
        "GET /api/assistant/console/settings": settingsDocument("console", "Answer briefly."),
        "PATCH /api/assistant/console/settings": () => answer.promise
      }
    });
    const { page } = api;
    await page.goto("/settings/console");
    await expect(prompt(page)).toHaveValue("Answer briefly.");
    // The bar's title is the page's one h1, and its Save submits the pane's form; the card has no Save of its own.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistant settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const save = barSave(page);
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute("type", "submit");
    await expect(save).toHaveAttribute("form", "assistant-settings-form");
    await expect(page.locator("#assistant-settings-form")).toHaveCount(1);
    await expect(page.locator("main").getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

    await prompt(page).fill("Answer in two sentences.");
    await save.click();
    await expect(save).toHaveClass(/v-btn--loading/u);
    const patched = () => api.requests.find((request) => request.key === "PATCH /api/assistant/console/settings");
    await expect.poll(() => Boolean(patched())).toBe(true);
    const saved = patched();
    assert.deepEqual(saved.body, { data: { type: "assistant-settings", attributes: { systemPrompt: "Answer in two sentences." } } });
    answer.resolve(settingsDocument("console", "Answer in two sentences."));
    await expect(save).not.toHaveClass(/v-btn--loading/u);
    await expect(prompt(page)).toHaveValue("Answer in two sentences.");
    assert.deepEqual(await page.evaluate(() => window.settingsFixture.reports), []);
    await finish(api);
  }
});

test("a refused save shows the prompt's message and reports the failure", options, async (t) => {
  const fixture = await startFixture(t);
  const api = await openPage(fixture, {
    viewport: { width: 1280, height: 900 },
    routes: {
      "GET /api/assistant/console/settings": settingsDocument("console", "Answer briefly."),
      "PATCH /api/assistant/console/settings": {
        status: 422,
        json: { error: "Validation failed.", details: { fieldErrors: { systemPrompt: "That prompt is refused." } } }
      }
    }
  });
  const { page } = api;
  await page.goto("/settings/console");
  await expect(prompt(page)).toHaveValue("Answer briefly.");
  await prompt(page).fill("Something refused");
  await barSave(page).click();
  await expect(page.getByText("That prompt is refused.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.settingsFixture.reports.at(-1)?.source)).toBe("assistant.settings");
  await expect(prompt(page)).toHaveValue("Something refused");
  await finish(api);
});

test("workspace settings show a note and no Save until the address names a workspace", options, async (t) => {
  const fixture = await startFixture(t);
  const api = await openPage(fixture, {
    viewport: { width: 1280, height: 900 },
    routes: { "GET /api/w/alpha/assistant/admin/settings": settingsDocument("admin", "Workspace prompt.", "42") }
  });
  const { page } = api;
  await page.goto("/settings/admin");
  await expect(page.getByText("Select a workspace to configure assistant settings.")).toBeVisible();
  await expect(barSave(page)).toHaveCount(0);
  await expect(prompt(page)).toHaveCount(0);
  assert.deepEqual(api.requests.map(({ key }) => key), []);

  await page.goto("/settings/admin?workspace=alpha");
  await expect(prompt(page)).toHaveValue("Workspace prompt.");
  await expect(barSave(page)).toBeVisible();
  await finish(api);
});
