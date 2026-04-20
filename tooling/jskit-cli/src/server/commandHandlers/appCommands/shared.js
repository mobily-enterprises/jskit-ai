import { spawnSync } from "node:child_process";
import path from "node:path";
import { access, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";

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

async function resolveLocalRepoRoot({ appRoot = "", explicitRepoRoot = "" } = {}) {
  const explicit = normalizeText(explicitRepoRoot);
  if (explicit) {
    return explicit;
  }

  const envRepoRoot = normalizeText(process.env.JSKIT_REPO_ROOT);
  if (envRepoRoot) {
    return envRepoRoot;
  }

  let currentDirectory = path.dirname(appRoot);
  while (true) {
    const candidateRoot = path.join(currentDirectory, "jskit-ai");
    if (await fileExists(path.join(candidateRoot, "packages")) && await fileExists(path.join(candidateRoot, "tooling"))) {
      return candidateRoot;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return "";
    }
    currentDirectory = parentDirectory;
  }
}

async function discoverLocalPackageMap(repoRoot = "") {
  const packageMap = new Map();
  const parentDirectories = [
    path.join(repoRoot, "packages"),
    path.join(repoRoot, "tooling")
  ];

  for (const parentDirectory of parentDirectories) {
    if (!(await fileExists(parentDirectory))) {
      continue;
    }

    const entries = await readdir(parentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const packageRoot = path.join(parentDirectory, entry.name);
      const packageJsonPath = path.join(packageRoot, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        continue;
      }

      let packageJson = {};
      try {
        packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      } catch {
        continue;
      }

      const packageId = normalizeText(packageJson?.name);
      if (!packageId.startsWith("@jskit-ai/")) {
        continue;
      }

      const packageDirName = packageId.slice("@jskit-ai/".length);
      if (!packageDirName || packageDirName.includes("/")) {
        continue;
      }

      if (!packageMap.has(packageDirName)) {
        packageMap.set(packageDirName, packageRoot);
      }
    }
  }

  return packageMap;
}

async function linkPackageBinEntries({
  appRoot,
  packageDirName,
  sourceDir,
  stdout
} = {}) {
  const packageJsonPath = path.join(sourceDir, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return;
  }

  let packageJson = {};
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return;
  }

  const rawBin = packageJson?.bin;
  let binEntries = [];
  if (typeof rawBin === "string") {
    binEntries = [[packageDirName, rawBin]];
  } else if (rawBin && typeof rawBin === "object" && !Array.isArray(rawBin)) {
    binEntries = Object.entries(rawBin);
  }

  if (binEntries.length < 1) {
    return;
  }

  const binDirectory = path.join(appRoot, "node_modules", ".bin");
  const packageRoot = path.join(appRoot, "node_modules", "@jskit-ai", packageDirName);
  await mkdir(binDirectory, { recursive: true });

  for (const [rawBinName, rawBinTarget] of binEntries) {
    const binName = normalizeText(rawBinName);
    const binTarget = normalizeText(rawBinTarget);
    if (!binName || !binTarget) {
      continue;
    }

    const absoluteTarget = path.join(packageRoot, binTarget);
    if (!(await fileExists(absoluteTarget))) {
      continue;
    }

    const binPath = path.join(binDirectory, binName);
    await rm(binPath, { recursive: true, force: true });
    const relativeTarget = path.relative(binDirectory, absoluteTarget) || absoluteTarget;
    await symlink(relativeTarget, binPath);
    stdout?.write(`[link-local] linked bin ${binName} -> ${relativeTarget}\n`);
  }
}

function resolveSymlinkType() {
  return process.platform === "win32" ? "junction" : "dir";
}

export {
  fileExists,
  normalizeText,
  isTruthyFlag,
  runExternalCommand,
  runExternalShellCommand,
  formatUtcReleaseTimestamp,
  resolveLocalJskitBin,
  runLocalJskit,
  resolveLocalRepoRoot,
  discoverLocalPackageMap,
  linkPackageBinEntries,
  resolveSymlinkType
};
