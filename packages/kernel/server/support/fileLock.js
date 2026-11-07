import childProcess from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const FILE_LOCK_ERROR_CODE = "file_lock_failed";
// flock(1) exits with this status when another open file description holds the lock.
const LOCK_HELD_ELSEWHERE = 1;

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

// Node cannot call flock(2), so flock(1) takes the lock on the descriptor it inherits and exits. A flock lock belongs
// to the open file description, which this process keeps open, so the lock lasts until the handle closes: at release,
// or when this process ends for any reason. Each acquisition costs one short process and nothing runs while it is held.
function lockThroughDescriptor(fd, cwd) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "3"], {
      cwd,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "ignore", "pipe", fd]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk || "")}`.slice(-4096);
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stderr: stderr.trim() }));
  });
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
  let result;
  try {
    result = await lockThroughDescriptor(lockHandle.fd, normalizedCwd);
  } catch (error) {
    await lockHandle.close().catch(() => null);
    throw fileLockError(error?.message || String(error || "Exclusive file lock failed."), errorCode);
  }
  if (result.status !== 0) {
    await lockHandle.close();
    if (result.status === LOCK_HELD_ELSEWHERE) {
      return null;
    }
    throw fileLockError(`Exclusive file lock process failed${result.stderr ? `: ${result.stderr}` : "."}`, errorCode);
  }

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await lockHandle.close();
  };
}

export {
  FILE_LOCK_ERROR_CODE,
  tryAcquireExclusiveFileLock
};
