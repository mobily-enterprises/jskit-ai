import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { access } from "node:fs/promises";

function normalizeText(value = "") {
  return String(value || "").trim();
}

async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isTruthyFlag(rawValue = "") {
  const normalizedValue = normalizeText(rawValue).toLowerCase();
  return normalizedValue === "true" || normalizedValue === "1" || normalizedValue === "yes";
}

function ensureCommandSucceeded(result, label, { createCliError, cwd = "", stdout, stderr, quiet = false } = {}) {
  if (!quiet) {
    const capturedStdout = String(result?.stdout || "");
    const capturedStderr = String(result?.stderr || "");
    if (capturedStdout) {
      stdout?.write(capturedStdout);
    }
    if (capturedStderr) {
      stderr?.write(capturedStderr);
    }
  }

  if (result?.error) {
    if (result.error.code === "ENOENT") {
      throw createCliError(`${label} is not available in PATH.`, {
        exitCode: 1
      });
    }
    throw result.error;
  }

  if (result?.status !== 0) {
    const suffix = cwd ? ` (cwd: ${cwd})` : "";
    throw createCliError(`${label} failed with exit code ${result?.status ?? 1}${suffix}.`, {
      exitCode: Number.isInteger(result?.status) ? result.status : 1
    });
  }

  return result;
}

function runExternalCommand(
  command,
  args = [],
  {
    cwd = "",
    env = {},
    stdout,
    stderr,
    quiet = false,
    createCliError
  } = {}
) {
  const result = spawnSync(command, Array.isArray(args) ? args : [], {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
  return ensureCommandSucceeded(result, command, {
    createCliError,
    cwd,
    stdout,
    stderr,
    quiet
  });
}

function runExternalCommandAsync(
  command,
  args = [],
  {
    cwd = "",
    env = {},
    stdout,
    stderr,
    quiet = false,
    createCliError
  } = {}
) {
  return new Promise((resolve, reject) => {
    let capturedStdout = "";
    let capturedStderr = "";
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        resolve(ensureCommandSucceeded(result, command, {
          createCliError,
          cwd,
          stdout,
          stderr,
          quiet: true
        }));
      } catch (error) {
        reject(error);
      }
    };

    try {
      child = spawn(command, Array.isArray(args) ? args : [], {
        cwd: cwd || process.cwd(),
        env: {
          ...process.env,
          ...env
        },
        shell: process.platform === "win32"
      });
    } catch (error) {
      finish({
        error,
        status: null,
        stdout: capturedStdout,
        stderr: capturedStderr
      });
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      capturedStdout += chunk;
      if (!quiet) {
        stdout?.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk) => {
      capturedStderr += chunk;
      if (!quiet) {
        stderr?.write(chunk);
      }
    });
    child.once("error", (error) => {
      finish({
        error,
        status: null,
        stdout: capturedStdout,
        stderr: capturedStderr
      });
    });
    child.once("close", (status, signal) => {
      finish({
        error: signal ? new Error(`${command} terminated by signal ${signal}.`) : null,
        status,
        stdout: capturedStdout,
        stderr: capturedStderr
      });
    });
  });
}

function runExternalShellCommand(
  commandText,
  {
    cwd = "",
    env = {},
    stdout,
    stderr,
    quiet = false,
    createCliError
  } = {}
) {
  const result = spawnSync(String(commandText || ""), {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    shell: true,
    env: {
      ...process.env,
      ...env
    }
  });

  return ensureCommandSucceeded(result, String(commandText || "").trim() || "shell command", {
    createCliError,
    cwd,
    stdout,
    stderr,
    quiet
  });
}

function formatUtcReleaseTimestamp(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return {
    branchStamp: `${year}${month}${day}-${hours}${minutes}${seconds}`,
    pretty: `${year}-${month}-${day} ${hours}:${minutes} UTC`
  };
}

function resolveLocalJskitBin(appRoot = "") {
  const binName = process.platform === "win32" ? "jskit.cmd" : "jskit";
  return path.join(appRoot, "node_modules", ".bin", binName);
}

async function runLocalJskit(
  appRoot,
  args = [],
  {
    stdout,
    stderr,
    createCliError,
    quiet = false
  } = {}
) {
  const localJskitBin = resolveLocalJskitBin(appRoot);
  if (!(await fileExists(localJskitBin))) {
    throw createCliError(`Local jskit binary not found at ${path.relative(appRoot, localJskitBin)}. Run npm install first.`, {
      exitCode: 1
    });
  }

  return runExternalCommand(localJskitBin, args, {
    cwd: appRoot,
    stdout,
    stderr,
    quiet,
    createCliError
  });
}

async function runLocalJskitAsync(
  appRoot,
  args = [],
  {
    env = {},
    stdout,
    stderr,
    createCliError,
    quiet = false
  } = {}
) {
  const localJskitBin = resolveLocalJskitBin(appRoot);
  if (!(await fileExists(localJskitBin))) {
    throw createCliError(`Local jskit binary not found at ${path.relative(appRoot, localJskitBin)}. Run npm install first.`, {
      exitCode: 1
    });
  }

  return runExternalCommandAsync(localJskitBin, args, {
    cwd: appRoot,
    env,
    stdout,
    stderr,
    quiet,
    createCliError
  });
}

export {
  fileExists,
  normalizeText,
  isTruthyFlag,
  runExternalCommand,
  runExternalCommandAsync,
  runExternalShellCommand,
  formatUtcReleaseTimestamp,
  resolveLocalJskitBin,
  runLocalJskit,
  runLocalJskitAsync
};
