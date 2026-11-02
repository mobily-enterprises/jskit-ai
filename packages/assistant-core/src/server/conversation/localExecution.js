import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

/** Owned POSIX process groups for a trusted, single-user application.
 * Managed hosts replace this facility to enforce resource and identity policy.
 */
export function createLocalConversationExecution() {
  if (process.platform === "win32") {
    throw new Error("The local native-agent host requires POSIX process groups. Supply a Windows execution host or use an API connection.");
  }
  const executions = new Map();
  let closing = false;

  function groupExists(pid) {
    try { process.kill(-pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  }

  function signalGroup(pid, signal) {
    try { process.kill(-pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  async function stop(id, { allowMissingRecordScopeRecovery = false } = {}) {
    const entry = executions.get(id);
    if (!entry) {
      // A native runtime can use its own persisted identity proof. Absence here
      // is not that proof and never authorizes signalling by this facility.
      if (allowMissingRecordScopeRecovery) return { ok: false, scopeEmpty: false };
      throw new Error("This host does not own the requested execution.");
    }
    if (entry.stopping) return entry.stopping;
    entry.stopping = (async () => {
      try { await entry.started; }
      catch { await entry.exited; executions.delete(id); return { scopeEmpty: true }; }
      if (groupExists(entry.child.pid)) {
        if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
          throw new Error("The native process exited but its process group remains. This host cannot safely reclaim it; inspect the local process group before retrying cleanup.");
        }
        signalGroup(entry.child.pid, "SIGTERM");
        const deadline = Date.now() + 3_000;
        while (groupExists(entry.child.pid) && Date.now() < deadline) await delay(25);
        if (groupExists(entry.child.pid) && entry.child.exitCode === null && entry.child.signalCode === null) {
          signalGroup(entry.child.pid, "SIGKILL");
        }
        const killDeadline = Date.now() + 1_000;
        while (groupExists(entry.child.pid) && Date.now() < killDeadline) await delay(25);
      }
      if (groupExists(entry.child.pid)) {
        throw new Error("The owned native process group has not exited. Cleanup must finish before replacing it.");
      }
      await entry.exited;
      executions.delete(id);
      return { scopeEmpty: true };
    })().finally(() => { entry.stopping = null; });
    return entry.stopping;
  }

  // readable-check: allow no-env-default - platform object: like spawn, a command given no environment runs in Node's process.env
  async function start({ command, args = [], cwd, env = process.env, stream = false, limits, logPath } = {}) {
    if (closing) throw new Error("The conversation execution host is closed.");
    if (typeof command !== "string" || !command || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new TypeError("An executable and string arguments are required.");
    }
    if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new TypeError("Native execution requires an absolute working directory.");
    if (limits && Object.keys(limits).length) {
      throw new Error("The local execution host cannot enforce resource limits. Supply a managed execution host.");
    }
    if (logPath !== undefined && !isAbsolute(logPath)) throw new TypeError("Native logs require an absolute path.");
    let logDescriptor;
    let child;
    try {
      if (logPath) logDescriptor = openSync(logPath, "a", 0o600);
      child = spawn(command, args, { cwd, env, detached: true,
        stdio: stream ? ["pipe", "pipe", logDescriptor ?? "ignore"]
          : ["ignore", logDescriptor ?? "ignore", logDescriptor ?? "ignore"] });
    } finally { if (logDescriptor !== undefined) closeSync(logDescriptor); }
    const id = randomUUID();
    const started = new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    const entry = { child, started, exited, stopping: null };
    executions.set(id, entry);
    try { await started; }
    catch (cause) {
      await exited;
      executions.delete(id);
      throw new Error(`Could not start ${command}. Check the executable and working directory.`, { cause });
    }
    if (closing) {
      if (executions.has(id)) await stop(id);
      throw new Error("The conversation execution host closed during startup.");
    }
    return Object.freeze({
      id,
      pid: child.pid,
      stdin: child.stdin,
      stdout: child.stdout,
      exited,
      get running() { return child.exitCode === null && child.signalCode === null; }
    });
  }

  // readable-check: allow no-env-default - platform object: like spawn, a command given no environment runs in Node's process.env
  async function run({ command, args, cwd, baseEnv = process.env, credentialHome = {}, mode,
    logPath, timeout = 30_000, limits } = {}) {
    if (!["capture", "detached"].includes(mode)) throw new TypeError("Native execution requires capture or detached mode.");
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new TypeError("Native execution requires a positive timeout.");
    const env = { ...baseEnv };
    if (credentialHome.home) {
      if (!isAbsolute(credentialHome.home)) throw new TypeError("A credential home must be absolute.");
      Object.assign(env, { HOME: credentialHome.home,
        XDG_CACHE_HOME: join(credentialHome.home, ".cache"),
        XDG_CONFIG_HOME: join(credentialHome.home, ".config"),
        XDG_DATA_HOME: join(credentialHome.home, ".local", "share") });
      if (credentialHome.username) Object.assign(env, { USER: credentialHome.username, LOGNAME: credentialHome.username });
    }
    const captureRoot = mode === "capture" ? await mkdtemp(join(tmpdir(), "jskit-capture-")) : null;
    const outputPath = captureRoot ? join(captureRoot, "output.log") : logPath;
    let child;
    let timer;
    let cleanup = false;
    try {
      child = await start({ command, args, cwd, env, logPath: outputPath, limits });
      if (mode === "detached") {
        // A shared account service outlives the application's observer. Its
        // durable runtime owner, not this Node event loop, controls shutdown.
        executions.get(child.id).child.unref();
        return { ok: true, pid: child.pid, execution: { id: child.id } };
      }
      let timedOut = false;
      const result = await Promise.race([child.exited, new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          stop(child.id).then(() => child.exited).then(resolve, reject);
        }, timeout);
      })]);
      clearTimeout(timer);
      // The timeout may have already retired this exact execution.
      if (executions.has(child.id)) await stop(child.id);
      cleanup = true;
      const file = await open(outputPath, "r");
      let output;
      try {
        const { size } = await file.stat();
        const bytes = Buffer.alloc(Math.min(size, 64 * 1024));
        const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
        output = bytes.subarray(0, bytesRead).toString("utf8");
      } finally { await file.close(); }
      return { ok: !timedOut && result.code === 0, exitCode: result.code, signal: result.signal, timedOut, output };
    } finally {
      clearTimeout(timer);
      if (captureRoot && (!child || cleanup)) await rm(captureRoot, { recursive: true, force: true });
    }
  }

  async function close() {
    closing = true;
    const results = await Promise.allSettled([...executions.keys()].map(stop));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some owned native executions could not be stopped.");
  }

  return Object.freeze({

    start,

    run,

    stop,

    close

  });
}
