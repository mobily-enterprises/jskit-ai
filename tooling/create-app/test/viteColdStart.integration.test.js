import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CREATE_APP_CLI = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const JSKIT_CLI = fileURLToPath(new URL("../../jskit-cli/bin/jskit.js", import.meta.url));
const AGENT_DOCS_PACKAGE_ROOT = fileURLToPath(new URL("../../../packages/agent-docs", import.meta.url));
const CONFIG_ESLINT_PACKAGE_ROOT = fileURLToPath(new URL("../../config-eslint", import.meta.url));
const JSKIT_CLI_PACKAGE_ROOT = fileURLToPath(new URL("../../jskit-cli", import.meta.url));
const JSKIT_CATALOG_PACKAGE_ROOT = fileURLToPath(new URL("../../jskit-catalog", import.meta.url));
const SHELL_WEB_PACKAGE_ROOT = fileURLToPath(new URL("../../../packages/shell-web", import.meta.url));
const RUN_COLD_START_INTEGRATION = process.env.JSKIT_VITE_COLD_START_INTEGRATION === "1";
const OPTIMIZED_SHELL_SUBPATHS = Object.freeze([
  "@jskit-ai/shell-web/client/placement",
  "@jskit-ai/shell-web/client/error"
]);

function runChecked(command, args, { cwd, label = command, timeout = 300_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
    }
  });
  assert.equal(
    result.status,
    0,
    `${label} failed.\nstdout:\n${String(result.stdout || "")}\nstderr:\n${String(result.stderr || "")}`
  );
  return result;
}

function startCapturedProcess(command, args, { cwd, env = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...env
    }
  });
  let output = "";
  const listeners = new Set();

  function append(chunk) {
    output += chunk.toString("utf8");
    for (const listener of listeners) {
      listener();
    }
  }

  child.stdout.on("data", append);
  child.stderr.on("data", append);

  function waitFor(pattern, timeout = 30_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const check = () => {
        if (pattern.test(output)) {
          finish(resolve);
        }
      };
      const onExit = (code, signal) => {
        finish(
          reject,
          new Error(
            `${command} exited before ${pattern} (code=${code}, signal=${signal || "none"}).\n${output}`
          )
        );
      };
      const timer = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for ${pattern}.\n${output}`));
      }, timeout);
      const finish = (complete, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        listeners.delete(check);
        child.off("exit", onExit);
        complete(value);
      };

      listeners.add(check);
      child.on("exit", onExit);
      check();
    });
  }

  return Object.freeze({
    child,
    readOutput: () => output,
    waitFor
  });
}

async function stopProcess(runtime) {
  const child = runtime?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
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
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function installPackedShellWeb(appRoot, tempRoot) {
  const packResult = runChecked(
    "npm",
    ["pack", SHELL_WEB_PACKAGE_ROOT, "--pack-destination", tempRoot, "--json"],
    { cwd: tempRoot, label: "pack current shell-web" }
  );
  const packPayload = JSON.parse(packResult.stdout);
  const tarballName = String(packPayload?.[0]?.filename || "").trim();
  assert.ok(tarballName, `npm pack did not report a tarball.\n${packResult.stdout}`);

  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies["@jskit-ai/shell-web"] = `file:${path.join(tempRoot, tarballName)}`;
  packageJson.devDependencies["@jskit-ai/agent-docs"] = `file:${AGENT_DOCS_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/config-eslint"] = `file:${CONFIG_ESLINT_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/jskit-cli"] = `file:${JSKIT_CLI_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/jskit-catalog"] = `file:${JSKIT_CATALOG_PACKAGE_ROOT}`;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  runChecked("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: appRoot,
    label: "fresh generated-app npm install"
  });
}

async function readOptimizerMetadata(appRoot) {
  const metadataPath = path.join(appRoot, "node_modules", ".vite", "deps", "_metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  return Object.keys(metadata?.optimized || {});
}

test("fresh generated shell-web/auth app optimizes dynamic shell subpaths before its first browser load", {
  skip: RUN_COLD_START_INTEGRATION
    ? false
    : "set JSKIT_VITE_COLD_START_INTEGRATION=1 to run the browser-backed cold-start regression",
  timeout: 600_000
}, async () => {
  await withTempDir(async (tempRoot) => {
    const appRoot = path.join(tempRoot, "cold-start-app");
    let apiRuntime = null;
    let viteRuntime = null;
    let browser = null;

    try {
      runChecked(process.execPath, [
        CREATE_APP_CLI,
        "cold-start-app",
        "--target",
        appRoot,
        "--initial-bundles",
        "auth"
      ], { cwd: tempRoot, label: "create generated auth app" });
      runChecked(process.execPath, [JSKIT_CLI, "add", "package", "auth-provider-local-core"], {
        cwd: appRoot,
        label: "add local auth provider"
      });
      runChecked(process.execPath, [JSKIT_CLI, "add", "package", "auth-web"], {
        cwd: appRoot,
        label: "add auth web"
      });
      await installPackedShellWeb(appRoot, tempRoot);

      const viteCachePath = path.join(appRoot, "node_modules", ".vite");
      await rm(viteCachePath, { recursive: true, force: true });
      await assert.rejects(access(viteCachePath), /ENOENT/u);

      const [apiPort, vitePort] = await Promise.all([reservePort(), reservePort()]);
      apiRuntime = startCapturedProcess(process.execPath, ["./bin/server.js"], {
        cwd: appRoot,
        env: { PORT: String(apiPort) }
      });
      await apiRuntime.waitFor(new RegExp(`Server listening at http://127\\.0\\.0\\.1:${apiPort}`));

      viteRuntime = startCapturedProcess(process.execPath, [
        "./node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        String(vitePort),
        "--strictPort",
        "--clearScreen",
        "false"
      ], {
        cwd: appRoot,
        env: {
          DEBUG: "vite:deps",
          VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`
        }
      });
      await viteRuntime.waitFor(new RegExp(`http://127\\.0\\.0\\.1:${vitePort}/`));
      await viteRuntime.waitFor(/dependencies optimized/u, 60_000);

      const initiallyOptimized = await readOptimizerMetadata(appRoot);
      for (const specifier of OPTIMIZED_SHELL_SUBPATHS) {
        assert.ok(
          initiallyOptimized.includes(specifier),
          `Expected ${specifier} in the pre-navigation optimizer metadata.\n${viteRuntime.readOutput()}`
        );
      }

      const navigationLogOffset = viteRuntime.readOutput().length;
      const playwrightUrl = pathToFileURL(
        path.join(appRoot, "node_modules", "@playwright", "test", "index.mjs")
      ).href;
      const { chromium } = await import(playwrightUrl);
      const chromiumExecutablePath = String(
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ""
      ).trim();
      browser = await chromium.launch({
        headless: true,
        ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {})
      });
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => {
        pageErrors.push(String(error?.message || error));
      });

      await page.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: "domcontentloaded" });
      await page.getByText("Ready", { exact: true }).waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle");

      const bodyText = await page.locator("body").innerText();
      assert.doesNotMatch(
        bodyText,
        /did not download\. The app may have been updated, or the network request failed\./u
      );
      assert.deepEqual(pageErrors, []);

      const navigationOutput = viteRuntime.readOutput().slice(navigationLogOffset);
      for (const specifier of OPTIMIZED_SHELL_SUBPATHS) {
        const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        assert.doesNotMatch(
          navigationOutput,
          new RegExp(`(?:new dependencies found|dependenc(?:y|ies) optimized)[^\\n]*${escapedSpecifier}`, "u")
        );
      }
      assert.doesNotMatch(navigationOutput, /optimized dependencies changed/u);
    } finally {
      if (browser) {
        await browser.close();
      }
      await stopProcess(viteRuntime);
      await stopProcess(apiRuntime);
    }
  }, { prefix: "jskit-vite-cold-start-" });
});
