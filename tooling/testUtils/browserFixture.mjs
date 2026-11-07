import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_FIXTURE_SERVER = fileURLToPath(new URL("./viteFixtureServer.mjs", import.meta.url));

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
  let processError = null;
  const listeners = new Set();

  function append(chunk) {
    output += chunk.toString("utf8");
    for (const listener of listeners) {
      listener();
    }
  }

  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    processError = error;
    for (const listener of listeners) {
      listener();
    }
  });

  function waitFor(pattern, timeout = 30_000) {
    if (!(pattern instanceof RegExp)) {
      throw new TypeError("startCapturedProcess().waitFor() requires a RegExp.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const check = () => {
        if (processError) {
          finish(
            reject,
            new Error(`${command} could not start: ${processError.message}`, {
              cause: processError
            })
          );
          return;
        }
        pattern.lastIndex = 0;
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

      function finish(complete, value) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        listeners.delete(check);
        child.off("exit", onExit);
        complete(value);
      }

      listeners.add(check);
      child.on("exit", onExit);
      if (child.exitCode !== null || child.signalCode !== null) {
        onExit(child.exitCode, child.signalCode);
        return;
      }
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
  if (child && child.exitCode === null && child.signalCode === null) {
    await stopChild(child);
  }
  await runtime?.cleanup?.();
}

async function stopChild(child) {
  await new Promise((resolve) => {
    let settled = false;
    let forceTimer = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      child.off("exit", finish);
      resolve();
    };
    child.once("exit", finish);
    forceTimer = setTimeout(() => {
      if (!child.kill("SIGKILL")) {
        finish();
      }
    }, 5_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }
    if (!child.kill("SIGTERM")) {
      finish();
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
  if (!address || typeof address !== "object") {
    server.close();
    throw new Error("Unable to reserve a loopback TCP port.");
  }
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

// Vite replaces a shared dependency cache directory under servers still reading it,
// so no two running servers share one. A fixture's server reuses a directory that a
// stopped server of the same fixture left in this test process, which keeps later
// starts warm; the directories are removed when the process exits.
const idleCacheDirs = new Map();
const processCacheDirs = [];

function takeCacheDir(configPath) {
  const idle = idleCacheDirs.get(configPath);
  if (idle?.length) {
    return idle.pop();
  }
  if (processCacheDirs.length === 0) {
    process.once("exit", () => {
      for (const cacheDir of processCacheDirs) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    });
  }
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), "jskit-vite-fixture-"));
  processCacheDirs.push(cacheDir);
  return cacheDir;
}

function returnCacheDir(configPath, cacheDir) {
  const idle = idleCacheDirs.get(configPath) ?? [];
  idle.push(cacheDir);
  idleCacheDirs.set(configPath, idle);
}

async function startViteFixture({
  fixtureRoot,
  configFile = "vite.config.mjs",
  env = {},
  port: requestedPort,
  cacheDir: requestedCacheDir
} = {}) {
  const resolvedFixtureRoot = String(fixtureRoot || "").trim();
  if (!resolvedFixtureRoot) {
    throw new TypeError("startViteFixture requires fixtureRoot.");
  }

  const normalizedRequestedPort = Number(requestedPort);
  if (requestedPort != null && (!Number.isInteger(normalizedRequestedPort) || normalizedRequestedPort <= 0)) {
    throw new TypeError("startViteFixture port must be a positive integer.");
  }
  const port = requestedPort == null ? await reservePort() : normalizedRequestedPort;
  const configPath = path.join(resolvedFixtureRoot, configFile);
  let ownCacheDir = requestedCacheDir ? null : takeCacheDir(configPath);
  const runtime = Object.freeze({
    ...startCapturedProcess(process.execPath, [
      VITE_FIXTURE_SERVER,
      configPath,
      String(port),
      requestedCacheDir || ownCacheDir
    ], {
      cwd: resolvedFixtureRoot,
      env
    }),
    cleanup: () => {
      if (ownCacheDir) {
        returnCacheDir(configPath, ownCacheDir);
        ownCacheDir = null;
      }
    },
    port,
    baseURL: `http://127.0.0.1:${port}`
  });

  try {
    await runtime.waitFor(new RegExp(`http://127\\.0\\.0\\.1:${port}/`, "u"));
  } catch (error) {
    await stopProcess(runtime);
    throw error;
  }

  return runtime;
}

function createChromiumLaunchOptions({ env = process.env } = {}) {
  const executablePath = String(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
  return Object.freeze({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
}

export {
  createChromiumLaunchOptions,
  reservePort,
  startCapturedProcess,
  startViteFixture,
  stopProcess
};
