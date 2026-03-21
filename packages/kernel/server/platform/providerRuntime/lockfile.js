import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileExists } from "../../../internal/node/fileSystem.js";

async function readLockFromApp({ appRoot, lockPath = ".jskit/lock.json" } = {}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("readLockFromApp requires appRoot.");
  }

  const absoluteLockPath = path.resolve(appRoot, String(lockPath || ".jskit/lock.json"));
  if (!(await fileExists(absoluteLockPath))) {
    throw new Error(`Lock file not found: ${absoluteLockPath}`);
  }

  const source = await readFile(absoluteLockPath, "utf8");
  const lock = JSON.parse(source);
  if (!lock || typeof lock !== "object") {
    throw new TypeError(`Invalid lock file payload at ${absoluteLockPath}.`);
  }

  return {
    lock,
    lockPath: absoluteLockPath
  };
}

export { readLockFromApp };
