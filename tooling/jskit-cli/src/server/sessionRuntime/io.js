import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeText(value) {
  return String(value || "").trim();
}

function timestampForReceipt(now = new Date()) {
  return now.toISOString();
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  if (!filePath || !(await fileExists(filePath))) {
    return "";
  }
  return readFile(filePath, "utf8");
}

async function readTrimmedFile(filePath) {
  return normalizeText(await readTextIfExists(filePath));
}

async function writeTextFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${String(value || "").replace(/\s*$/u, "")}\n`, "utf8");
}

async function runCommand(command, args = [], { cwd, env = {}, timeout = 30000 } = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      maxBuffer: 1024 * 1024 * 10,
      timeout
    });
    return {
      exitCode: 0,
      ok: true,
      output: String([result.stdout, result.stderr].filter(Boolean).join("\n")).trim(),
      stderr: String(result.stderr || "").trim(),
      stdout: String(result.stdout || "").trim()
    };
  } catch (error) {
    const stdout = String(error?.stdout || "").trim();
    const stderr = String(error?.stderr || "").trim();
    return {
      exitCode: typeof error?.code === "number" ? error.code : 1,
      ok: false,
      output: String(error?.message || [stdout, stderr].filter(Boolean).join("\n")).trim(),
      stderr,
      stdout
    };
  }
}

async function runGit(targetRoot, args = [], options = {}) {
  return runCommand("git", args, {
    cwd: targetRoot,
    ...options
  });
}

async function runGitInWorktree(worktree, args = [], options = {}) {
  return runCommand("git", args, {
    cwd: worktree,
    ...options
  });
}

export {
  fileExists,
  normalizeText,
  readTextIfExists,
  readTrimmedFile,
  runCommand,
  runGit,
  runGitInWorktree,
  timestampForReceipt,
  writeTextFile
};
