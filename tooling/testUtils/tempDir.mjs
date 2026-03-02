import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function withTempDir(run, { prefix = "jskit-test-" } = {}) {
  if (typeof run !== "function") {
    throw new TypeError("withTempDir requires an async callback.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export { withTempDir };
