import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// The machine's test budget: how many test files (node --test) or Vitest workers a run may use at once; a Playwright
// worker, a browser and often an app server, takes two of it (browserTestWorkers() of ./browser-tests.mjs). A test
// runner that hands out slots exports V64_TEST_CONCURRENCY for each run; anywhere else a run takes half of the CPUs it
// may use, so a test suite neither runs one file at a time nor overwhelms the machine (a 2-vCPU VPS stays at 1).
const BUDGET_VARIABLE = "V64_TEST_CONCURRENCY";
const CGROUP_ROOT = "/sys/fs/cgroup";

/** The CPUs a cgroup v2 `cpu.max` ("<quota> <period>" or "max <period>") allows, or Infinity. */
function quotaCpus(text) {
  const [quota = "max", period] = String(text).trim().split(/\s+/u);
  const cpus = Number(quota) / Number(period);
  return quota !== "max" && Number.isFinite(cpus) && cpus > 0 ? cpus : Infinity;
}

/**
 * The CPUs this process may use: the machine's (availableParallelism(), which follows CPU affinity), capped by the
 * tightest cgroup v2 `cpu.max` quota from the process's own cgroup up to the root, which availableParallelism() does
 * not read. A container or a VPS slice given 3 CPUs of a 16-thread host has 3, not 16. Without cgroup v2 (another
 * system, or cgroup v1 alone), the machine's.
 * @param {{ parallelism?: number, readFile?: (file: string, encoding: string) => string }} [options]
 * @returns {number} a whole number of at least 1
 */
function availableCpus({ parallelism = os.availableParallelism(), readFile = readFileSync } = {}) {
  const read = (file) => {
    try {
      return String(readFile(file, "utf8"));
    } catch {
      return "";
    }
  };
  const line = read("/proc/self/cgroup").split("\n").find((entry) => entry.startsWith("0::"));
  let quota = Infinity;
  if (line) {
    for (let group = path.posix.join(CGROUP_ROOT, line.slice(3).trim()).replace(/\/+$/u, "");
      group.startsWith(CGROUP_ROOT); group = path.posix.dirname(group)) {
      quota = Math.min(quota, quotaCpus(read(path.posix.join(group, "cpu.max"))));
    }
  }
  return Math.max(1, Math.min(parallelism, Math.floor(quota)));
}

/**
 * @param {{ env?: Record<string, string | undefined>, parallelism?: number }} [options]
 * @returns {number} a whole number of at least 1
 */
function testConcurrency({ env = process.env, parallelism = availableCpus() } = {}) {
  const configured = String(env[BUDGET_VARIABLE] ?? "").trim();
  if (/^[1-9]\d*$/u.test(configured)) return Number(configured);
  return Math.max(1, Math.floor(parallelism / 2));
}

export { BUDGET_VARIABLE, availableCpus, testConcurrency };
