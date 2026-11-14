import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { chromium, expect } from "@playwright/test";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createChromiumLaunchOptions } from "../../../tooling/testUtils/browserFixture.mjs";

// The page an editor's preview shows: an inline script stands in for the bridge the preview injects.
const APPLICATION_PAGE = `<!doctype html><html><body><p>Application page</p>
<script>document.body.insertAdjacentHTML("beforeend", "<p>Bridge ran</p>");</script></body></html>`;

/** An editor on another origin (its own port) whose page frames the application. */
async function startEditor(context) {
  let applicationUrl = "";
  const editor = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body><p>Editor</p><iframe title="Preview" src="${applicationUrl}"></iframe></body></html>`);
  });
  await new Promise((resolve) => editor.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => editor.close(resolve)));
  return Object.freeze({
    origin: `http://127.0.0.1:${editor.address().port}`,
    frame(url) {
      applicationUrl = url;
    }
  });
}

/**
 * The application, served by Fastify through JSKIT's installed runtime.
 * @param {import("node:test").TestContext} context
 * @param {{ env: Record<string, string>, config?: Record<string, unknown> }} options
 */
async function startApplication(context, { env, config = {} }) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-framing-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  const app = Fastify();
  context.after(() => app.close());
  await createInstalledRuntime({ appRoot, config, env, logger: silentLogger, fastify: app });
  app.get("/", async (request, reply) => reply.type("text/html; charset=utf-8").send(APPLICATION_PAGE));
  await app.listen({ host: "127.0.0.1", port: 0 });
  return `http://127.0.0.1:${app.server.address().port}/`;
}

/**
 * Opens the editor, which frames the application, and returns the preview frame.
 * @param {import("@playwright/test").Browser} browser
 * @param {string} editorOrigin
 */
async function openEditor(browser, editorOrigin) {
  const page = await browser.newPage();
  await page.goto(`${editorOrigin}/`);
  await expect(page.getByText("Editor")).toBeVisible();
  return page;
}

test("a preview frames the application in development and, when configured, in production", {
  skip: process.env.JSKIT_KERNEL_FRAMING_BROWSER_INTEGRATION !== "1",
  timeout: 120_000
}, async (context) => {
  const browser = await chromium.launch(createChromiumLaunchOptions());
  context.after(() => browser.close());

  await context.test("development: the framed page loads and its injected script runs", async (step) => {
    const editor = await startEditor(step);
    editor.frame(await startApplication(step, { env: { APP_ENV: "development" } }));
    const page = await openEditor(browser, editor.origin);
    const preview = page.frameLocator("iframe");
    await expect(preview.getByText("Application page")).toBeVisible();
    await expect(preview.getByText("Bridge ran")).toBeVisible();
    await page.close();
  });

  await context.test("production: another origin cannot frame the application by default", async (step) => {
    const editor = await startEditor(step);
    editor.frame(await startApplication(step, { env: { APP_ENV: "production", NODE_ENV: "production" } }));
    const page = await openEditor(browser, editor.origin);
    await expect.poll(() => page.frames().find((frame) => frame !== page.mainFrame())?.url() || "").toMatch(/^chrome-error:/u);
    await expect(page.frameLocator("iframe").getByText("Application page")).toHaveCount(0);
    await page.close();
  });

  await context.test("production: an editor named in frameAncestors frames the application and its script runs", async (step) => {
    const editor = await startEditor(step);
    const applicationUrl = await startApplication(step, {
      env: { APP_ENV: "production", NODE_ENV: "production" },
      config: { securityHeaders: { frameAncestors: ["'self'", editor.origin] } }
    });
    editor.frame(applicationUrl);
    const page = await openEditor(browser, editor.origin);
    const preview = page.frameLocator("iframe");
    await expect(preview.getByText("Application page")).toBeVisible();
    await expect(preview.getByText("Bridge ran")).toBeVisible();
    assert.ok(page.frames().every((frame) => !frame.url().startsWith("chrome-error:")));
    await page.close();
  });
});
