import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CREATE_APP_CLI_PATH = fileURLToPath(new URL("../../create-app/bin/jskit-create-app.js", import.meta.url));
const JSKIT_CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const DEV_HOST = "127.0.0.1";
const RUN_SCAFFOLD_E2E = process.env.JSKIT_RUN_SCAFFOLD_E2E === "1";
const JSKIT_LOCAL_DEPENDENCY_PREFIX = "file:node_modules/@jskit-ai/jskit/packages/";

function runNodeCli({ cwd, scriptPath, args = [] }) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function runNpm({ cwd, args = [] }) {
  return spawnSync("npm", args, {
    cwd,
    encoding: "utf8"
  });
}

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "jskit-scaffold-e2e-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, DEV_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port for dev server.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function startDevServer({ cwd, port }) {
  const logs = [];
  const child = spawn("npm", ["run", "dev", "--", "--host", DEV_HOST, "--port", String(port)], {
    cwd,
    env: {
      ...process.env,
      CI: "1"
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });

  return {
    child,
    readLogs() {
      return logs.join("");
    }
  };
}

async function stopDevServer(server) {
  if (!server || !server.child) {
    return;
  }
  const { child } = server;
  if (child.exitCode !== null) {
    return;
  }

  try {
    if (typeof child.pid === "number") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    delay(8_000).then(() => false)
  ]);

  if (!exited && child.exitCode === null) {
    try {
      if (typeof child.pid === "number") {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
    await once(child, "exit");
  }
}

async function waitForHttpReady({ url, server, timeoutMs = 120_000 }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`Dev server exited before becoming ready.\n${server.readLogs()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await delay(400);
  }

  throw new Error(`Timed out waiting for ${url}.\n${server.readLogs()}`);
}

async function assertTextVisible(page, text) {
  await page.getByText(text, { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
}

async function createAppAt({ rootDir, appName }) {
  const appRoot = path.join(rootDir, appName);
  const createResult = runNodeCli({
    cwd: rootDir,
    scriptPath: CREATE_APP_CLI_PATH,
    args: [appName, "--target", appRoot]
  });

  assert.equal(createResult.status, 0, createResult.stderr || createResult.stdout);
  return appRoot;
}

function runJskit({ appRoot, args = [] }) {
  return runNodeCli({
    cwd: appRoot,
    scriptPath: JSKIT_CLI_PATH,
    args
  });
}

function assertInternalDependencySpecsAreLocal(packageJson) {
  const dependencies = packageJson && typeof packageJson === "object" ? packageJson.dependencies || {} : {};
  let checked = 0;

  for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
    if (!dependencyName.startsWith("@jskit-ai/")) {
      continue;
    }
    if (dependencyName === "@jskit-ai/app-scripts") {
      continue;
    }

    checked += 1;
    assert.ok(
      String(dependencySpec).startsWith(JSKIT_LOCAL_DEPENDENCY_PREFIX),
      `Expected ${dependencyName} to use local file spec, found ${dependencySpec}.`
    );
  }

  assert.ok(checked > 0, "Expected at least one internal JSKIT dependency to be rewritten to local file spec.");
}

async function installShellInjectionPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "shell-e2e-module");
  await mkdir(path.join(packageRoot, "templates", "src", "pages", "admin", "errors"), { recursive: true });
  await mkdir(path.join(packageRoot, "templates", "src", "surfaces", "admin", "drawer"), { recursive: true });

  const descriptorSource = `export default Object.freeze({
  packageVersion: 1,
  packageId: "@test/shell-e2e-module",
  version: "0.0.1",
  dependsOn: [],
  options: {},
  capabilities: {
    provides: [],
    requires: ["runtime.web-shell-host"]
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/admin/errors/server.vue",
        to: "src/pages/admin/errors/server.vue"
      },
      {
        from: "templates/src/surfaces/admin/drawer/server-errors.entry.js",
        to: "src/surfaces/admin/drawer/server-errors.entry.js"
      }
    ]
  }
});
`;

  await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorSource, "utf8");
  await writeFile(
    path.join(packageRoot, "templates", "src", "pages", "admin", "errors", "server.vue"),
    "<template><section><h1>Server errors</h1><p>Injected by E2E package.</p></section></template>\n",
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "templates", "src", "surfaces", "admin", "drawer", "server-errors.entry.js"),
    'export default Object.freeze({ id: "admin-server-errors", title: "Server errors", route: "/errors/server", order: 45 });\n',
    "utf8"
  );

  const addPackageResult = runJskit({
    appRoot,
    args: ["add", "package", "@test/shell-e2e-module", "--no-install"]
  });
  assert.equal(addPackageResult.status, 0, addPackageResult.stderr || addPackageResult.stdout);
}

async function runScenarioBaseShell({ browser, rootDir }) {
  const appRoot = await createAppAt({ rootDir, appName: "matrix-base" });

  const installResult = runNpm({ cwd: appRoot, args: ["install"] });
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

  const port = await reservePort();
  const server = startDevServer({ cwd: appRoot, port });
  const baseUrl = `http://${DEV_HOST}:${port}`;

  try {
    await waitForHttpReady({ url: `${baseUrl}/`, server });
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await assertTextVisible(page, "Matrix Base");
    } finally {
      await page.close();
    }
  } finally {
    await stopDevServer(server);
  }
}

async function runScenarioWebShell({ browser, rootDir }) {
  const appRoot = await createAppAt({ rootDir, appName: "matrix-web-shell" });

  const addWebShell = runJskit({
    appRoot,
    args: ["add", "bundle", "web-shell", "--no-install"]
  });
  assert.equal(addWebShell.status, 0, addWebShell.stderr || addWebShell.stdout);

  const installResult = runNpm({ cwd: appRoot, args: ["install"] });
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

  const doctorResult = runJskit({ appRoot, args: ["doctor"] });
  assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout);

  const port = await reservePort();
  const server = startDevServer({ cwd: appRoot, port });
  const baseUrl = `http://${DEV_HOST}:${port}`;

  try {
    await waitForHttpReady({ url: `${baseUrl}/`, server });
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await assertTextVisible(page, "App Home");
      await assertTextVisible(page, "Home");

      await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
      await assertTextVisible(page, "Admin Dashboard");
      await assertTextVisible(page, "Dashboard");

      await page.locator("summary", { hasText: "Settings" }).first().click();
      await assertTextVisible(page, "Workspace");

      await page.goto(`${baseUrl}/console`, { waitUntil: "networkidle" });
      await assertTextVisible(page, "Console Overview");
      await assertTextVisible(page, "Overview");
    } finally {
      await page.close();
    }
  } finally {
    await stopDevServer(server);
  }
}

async function runScenarioWebShellInjection({ browser, rootDir }) {
  const appRoot = await createAppAt({ rootDir, appName: "matrix-web-shell-injected" });

  const addWebShell = runJskit({
    appRoot,
    args: ["add", "bundle", "web-shell", "--no-install"]
  });
  assert.equal(addWebShell.status, 0, addWebShell.stderr || addWebShell.stdout);

  await installShellInjectionPackage(appRoot);

  const installResult = runNpm({ cwd: appRoot, args: ["install"] });
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

  const doctorResult = runJskit({ appRoot, args: ["doctor"] });
  assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout);

  const port = await reservePort();
  const server = startDevServer({ cwd: appRoot, port });
  const baseUrl = `http://${DEV_HOST}:${port}`;

  try {
    await waitForHttpReady({ url: `${baseUrl}/admin`, server });
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
      const serverErrorsLink = page.getByRole("link", { name: "Server errors" }).first();
      await serverErrorsLink.waitFor({ state: "visible", timeout: 20_000 });
      await serverErrorsLink.click();
      await page.getByRole("heading", { name: "Server errors" }).waitFor({ state: "visible", timeout: 20_000 });
    } finally {
      await page.close();
    }
  } finally {
    await stopDevServer(server);
  }
}

async function runScenarioWebShellDbChat({ browser, rootDir }) {
  const appRoot = await createAppAt({ rootDir, appName: "matrix-web-shell-chat" });

  for (const bundleId of ["web-shell", "db-mysql", "auth-supabase", "chat-base"]) {
    const addResult = runJskit({
      appRoot,
      args: ["add", "bundle", bundleId, "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
  }

  const installResult = runNpm({ cwd: appRoot, args: ["install"] });
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

  const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
  assertInternalDependencySpecsAreLocal(packageJson);

  const doctorResult = runJskit({ appRoot, args: ["doctor"] });
  assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout);

  const port = await reservePort();
  const server = startDevServer({ cwd: appRoot, port });
  const baseUrl = `http://${DEV_HOST}:${port}`;

  try {
    await waitForHttpReady({ url: `${baseUrl}/`, server });
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await assertTextVisible(page, "App Home");
      await assertTextVisible(page, "Home");
    } finally {
      await page.close();
    }
  } finally {
    await stopDevServer(server);
  }

  const ciResult = runNpm({ cwd: appRoot, args: ["ci"] });
  assert.equal(ciResult.status, 0, ciResult.stderr || ciResult.stdout);

  const ciProdResult = runNpm({ cwd: appRoot, args: ["ci", "--omit=dev"] });
  assert.equal(ciProdResult.status, 0, ciProdResult.stderr || ciProdResult.stdout);
}

test(
  "scaffold E2E matrix: create-app -> add bundle -> run app -> assert surfaces",
  {
    timeout: 30 * 60_000
  },
  async (t) => {
    if (!RUN_SCAFFOLD_E2E) {
      t.skip("Set JSKIT_RUN_SCAFFOLD_E2E=1 to run scaffold matrix E2E scenarios.");
      return;
    }

    let chromium = null;
    try {
      ({ chromium } = await import("@playwright/test"));
    } catch {
      t.skip("@playwright/test is not available in this environment.");
      return;
    }

    let browser = null;
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      t.skip("Playwright browser is not installed. Run npx playwright install chromium.");
      return;
    }

    try {
      await withTempDir(async (rootDir) => {
        await runScenarioBaseShell({ browser, rootDir });
        await runScenarioWebShell({ browser, rootDir });
        await runScenarioWebShellInjection({ browser, rootDir });
        await runScenarioWebShellDbChat({ browser, rootDir });
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
);
