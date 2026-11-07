import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Linux keeps /dev/shm in memory, so nothing a test writes there waits for a disk. A durable store syncs every save:
// the file connection store's write, fsync and rename take about 10 ms on an SSD and 0.2 ms in memory, and syncing
// was the largest cost of the connector suites. Elsewhere, the system's temporary directory.
function memoryRoot() {
  try {
    const root = realpathSync("/dev/shm");
    accessSync(root, constants.W_OK);
    return statSync(root).isDirectory() ? root : tmpdir();
  } catch {
    return tmpdir();
  }
}

const TEST_DIRECTORY_ROOT = memoryRoot();

/** A new private directory for one test, in memory where the system offers one. The test removes it. */
function makeTestDirectory(prefix) {
  return mkdtemp(path.join(TEST_DIRECTORY_ROOT, prefix));
}

export { TEST_DIRECTORY_ROOT, makeTestDirectory };
