import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const FILE_LOCK_ERROR_CODE = "file_lock_failed";

function fileLockError(message = "", code = FILE_LOCK_ERROR_CODE) {
  const error = new Error(message || "Exclusive file lock failed.");
  error.code = code;
  return error;
}

function normalizedAbsolutePath(value = "", label = "path", errorCode = FILE_LOCK_ERROR_CODE) {
  const normalized = String(value || "").trim();
  if (!normalized || !path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) {
    throw fileLockError(`${label} must be a normalized absolute path.`, errorCode);
  }
  return normalized;
}

async function tryAcquireExclusiveFileLock(lockPath = "", {
  cwd = "",
  errorCode = FILE_LOCK_ERROR_CODE
} = {}) {
  const normalizedLockPath = normalizedAbsolutePath(lockPath, "lockPath", errorCode);
  const normalizedCwd = cwd
    ? normalizedAbsolutePath(cwd, "cwd", errorCode)
    : path.dirname(normalizedLockPath);
  const lockHandle = await open(
    normalizedLockPath,
    fsConstants.O_CREAT | fsConstants.O_NOFOLLOW | fsConstants.O_RDWR,
    0o660
  );
  let child = null;
  let stderr = "";
  let closed = Promise.resolve({ code: null, signal: null });
  try {
    child = spawn(
      "/bin/sh",
      [
        "-c",
        "/usr/bin/flock --exclusive --nonblock 3 || exit 1; " +
          "printf 'locked\\n'; IFS= read -r _ || true"
      ],
      {
        cwd: normalizedCwd,
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe", lockHandle.fd]
      }
    );
    closed = new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const acquired = await new Promise((resolve, reject) => {
      let output = "";
      let settled = false;
      const settle = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };
      child.once("error", (error) => settle(reject, error));
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk || "")}`.slice(-4096);
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk || "");
        if (output.includes("\n")) {
          settle(resolve, true);
        }
      });
      child.once("exit", (code) => {
        if (code === 1) {
          settle(resolve, false);
          return;
        }
        settle(reject, fileLockError(
          `Exclusive file lock process failed${stderr ? `: ${stderr.trim()}` : "."}`, errorCode
        ));
      });
    });
    if (!acquired) {
      await lockHandle.close();
      return null;
    }

    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        child.stdin.end("release\n");
        const result = await closed;
        if (result.code !== 0) {
          throw fileLockError(
            `Exclusive file lock process exited unexpectedly${stderr ? `: ${stderr.trim()}` : "."}`, errorCode
          );
        }
      } finally {
        await lockHandle.close();
      }
    };
  } catch (error) {
    child?.stdin?.destroy();
    child?.kill?.("SIGTERM");
    await closed;
    await lockHandle.close().catch(() => null);
    if (error?.code === errorCode) {
      throw error;
    }
    throw fileLockError(error?.message || String(error || "Exclusive file lock failed."), errorCode);
  }
}

export {
  FILE_LOCK_ERROR_CODE,
  tryAcquireExclusiveFileLock
};
