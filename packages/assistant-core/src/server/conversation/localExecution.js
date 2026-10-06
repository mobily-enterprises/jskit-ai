import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { isPlainObject, normalizeText } from "./normalize.js";
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
    return Object.freeze({ id, pid: child.pid, stdin: child.stdin, stdout: child.stdout, exited,
      get running() { return child.exitCode === null && child.signalCode === null; } });
  }

  return Object.freeze({
    start,
    async run({ command, args, cwd, baseEnv = process.env, credentialHome = {}, mode,
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
    },
    stop,
    async close() {
      closing = true;
      const results = await Promise.allSettled([...executions.keys()].map(stop));
      const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, "Some owned native executions could not be stopped.");
    }
  });
}

/** Process-group ownership proof used by execution hosts; callers retain their metadata contract. */
export function createConversationProcessIdentity({
  runtimeTokenEnvironmentName = "JSKIT_EXECUTION_RUNTIME_TOKEN",
  commandHashEnvironmentName = "JSKIT_EXECUTION_COMMAND_HASH",
  label = "Native",
  unavailableCode = "native_process_identity_unavailable"
} = {}) {
  const PROCESS_IDENTITY_SETTLE_TIMEOUT_MS = 1000;
  const PROCESS_IDENTITY_SETTLE_POLL_MS = 25;
  const PROCESS_IDENTITY_VERSION = 1;
  const PROCESS_IDENTITY_PLATFORM = "linux-proc";
  const PROCESS_STATE = Object.freeze({ RUNNING: "running", STOPPED: "stopped" });
  const PROCESS_IDENTITY_STATUS = Object.freeze({
    ABSENT: "absent", AMBIGUOUS: "ambiguous", EXACT: "exact", INVALID: "invalid", MISMATCH: "mismatch"
  });

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
  }

  function processMetadataIsIdentifiable(metadata = {}) {
    return Boolean(
      Number.isSafeInteger(Number(metadata.pid)) && Number(metadata.pid) > 0 &&
      processIdentityIsWellFormed(metadata.processIdentity) &&
      [PROCESS_STATE.RUNNING, PROCESS_STATE.STOPPED].includes(metadata.processState)
    );
  }

  function processIsAlive(pid) {
    const normalizedPid = Number(pid);
    if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
      return false;
    }
    try {
      process.kill(normalizedPid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function processGroupIsAlive(processGroupId) {
    const normalizedProcessGroupId = Number(processGroupId);
    if (!Number.isSafeInteger(normalizedProcessGroupId) || normalizedProcessGroupId <= 0) {
      return false;
    }
    if (process.platform === "win32") {
      return processIsAlive(normalizedProcessGroupId);
    }
    try {
      process.kill(-normalizedProcessGroupId, 0);
      return true;
    } catch {
      return false;
    }
  }

  function signalProcessGroup(processGroupId, signal) {
    const normalizedProcessGroupId = Number(processGroupId);
    const target = process.platform === "win32"
      ? normalizedProcessGroupId
      : -normalizedProcessGroupId;
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      if (!["ESRCH", "EPERM"].includes(String(error?.code || ""))) {
        throw error;
      }
      return false;
    }
  }

  function linuxProcessStat(value = "") {
    const text = String(value || "");
    const commandEnd = text.lastIndexOf(")");
    if (commandEnd < 0) {
      return null;
    }
    const fields = text.slice(commandEnd + 1).trim().split(/\s+/u);
    const state = String(fields[0] || "");
    const parentPid = Number(fields[1]);
    const processGroupId = Number(fields[2]);
    const startTimeTicks = String(fields[19] || "");
    if (
      !/^[A-Z]$/u.test(state) ||
      !Number.isSafeInteger(parentPid) || parentPid < 0 ||
      !Number.isSafeInteger(processGroupId) || processGroupId <= 0 ||
      !/^\d+$/u.test(startTimeTicks)
    ) {
      return null;
    }
    return {
      parentPid,
      processGroupId,
      startTimeTicks,
      state
    };
  }

  function normalizeProcessIdentity(value = {}) {
    const normalized = isPlainObject(value) ? value : {};
    return {
      commandHash: normalizeText(normalized.commandHash),
      platform: normalizeText(normalized.platform),
      runtimeToken: normalizeText(normalized.runtimeToken),
      startTimeTicks: normalizeText(normalized.startTimeTicks),
      version: Number(normalized.version || 0)
    };
  }

  function processIdentityIsWellFormed(value = {}) {
    const identity = normalizeProcessIdentity(value);
    return Boolean(
      identity.version === PROCESS_IDENTITY_VERSION &&
      identity.platform === PROCESS_IDENTITY_PLATFORM &&
      /^[a-f0-9]{12}$/u.test(identity.commandHash) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identity.runtimeToken) &&
      /^\d+$/u.test(identity.startTimeTicks)
    );
  }

  function linuxProcessEnvironmentValue(buffer = Buffer.alloc(0), name = "") {
    const prefix = `${name}=`;
    for (const entry of buffer.toString("utf8").split("\0")) {
      if (entry.startsWith(prefix)) {
        return entry.slice(prefix.length);
      }
    }
    return "";
  }

  async function linuxProcessRecords() {
    const records = [];
    const entries = await readdir("/proc", {
      withFileTypes: true
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
        continue;
      }
      const pid = Number(entry.name);
      const statValue = await readFile(`/proc/${entry.name}/stat`, "utf8").catch(() => "");
      const processStat = linuxProcessStat(statValue);
      if (!processStat || processStat.state === "Z") {
        continue;
      }
      let environment = null;
      let environmentReadable = true;
      try {
        environment = await readFile(`/proc/${entry.name}/environ`);
      } catch (error) {
        if (String(error?.code || "") === "ENOENT") {
          continue;
        }
        environmentReadable = false;
      }
      records.push({
        ...processStat,
        environment,
        environmentReadable,
        pid
      });
    }
    return records;
  }

  function normalizeProcessIdentityInspection(value = {}) {
    const status = Object.values(PROCESS_IDENTITY_STATUS).includes(value?.status)
      ? value.status
      : PROCESS_IDENTITY_STATUS.AMBIGUOUS;
    return {
      processGroupIds: [...new Set((Array.isArray(value?.processGroupIds)
        ? value.processGroupIds
        : [])
        .map(Number)
        .filter((processGroupId) => Number.isSafeInteger(processGroupId) && processGroupId > 0))],
      status
    };
  }

  async function inspectLinuxProcessIdentity(metadata = {}) {
    if (!processMetadataIsIdentifiable(metadata)) {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.INVALID
      };
    }
    if (metadata.processState === PROCESS_STATE.STOPPED) {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.ABSENT
      };
    }
    if (process.platform !== "linux") {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
    const identity = metadata.processIdentity;
    const records = await linuxProcessRecords();
    const rootProcessGroupId = Number(metadata.pid);
    const rootGroupMembers = records.filter(({ processGroupId }) => processGroupId === rootProcessGroupId);
    const exactRecords = [];
    const rootUnreadable = rootGroupMembers.some(({ environmentReadable }) => !environmentReadable);
    for (const record of records) {
      if (!record.environmentReadable) {
        continue;
      }
      const runtimeToken = linuxProcessEnvironmentValue(
        record.environment,
        runtimeTokenEnvironmentName
      );
      const commandHash = linuxProcessEnvironmentValue(
        record.environment,
        commandHashEnvironmentName
      );
      if (runtimeToken === identity.runtimeToken && commandHash === identity.commandHash) {
        exactRecords.push(record);
      }
    }
    const exactLeader = exactRecords.find(({ pid }) => pid === rootProcessGroupId);
    if (exactLeader && exactLeader.startTimeTicks !== identity.startTimeTicks) {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
    if (exactRecords.length === 0) {
      if (rootUnreadable) {
        return {
          processGroupIds: [],
          status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
        };
      }
      return {
        processGroupIds: [],
        status: rootGroupMembers.length > 0 || processGroupIsAlive(rootProcessGroupId)
          ? PROCESS_IDENTITY_STATUS.MISMATCH
          : PROCESS_IDENTITY_STATUS.ABSENT
      };
    }
    const processGroupIds = [...new Set(exactRecords.map(({ processGroupId }) => processGroupId))];
    for (const processGroupId of processGroupIds) {
      const groupMembers = records.filter((record) => record.processGroupId === processGroupId);
      if (groupMembers.some((record) => (
        !record.environmentReadable || !exactRecords.some(({ pid }) => pid === record.pid)
      ))) {
        return {
          processGroupIds: [],
          status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
        };
      }
    }
    if (
      rootGroupMembers.some((record) => !exactRecords.some(({ pid }) => pid === record.pid))
    ) {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
    return {
      processGroupIds,
      status: PROCESS_IDENTITY_STATUS.EXACT
    };
  }

  async function inspectProcessIdentity(metadata = {}, options = {}) {
    const inspector = typeof options.processIdentityInspector === "function"
      ? options.processIdentityInspector
      : inspectLinuxProcessIdentity;
    return normalizeProcessIdentityInspection(await inspector(metadata));
  }

  async function waitForProcessIdentityExit(metadata = {}, options = {}, timeoutMs = 0) {
    const deadline = Date.now() + timeoutMs;
    let inspection = await inspectProcessIdentity(metadata, options);
    while (
      Date.now() < deadline &&
      inspection.status === PROCESS_IDENTITY_STATUS.EXACT
    ) {
      await delay(100);
      inspection = await inspectProcessIdentity(metadata, options);
    }
    return inspection;
  }

  async function waitForProcessIdentityToSettle(metadata = {}, options = {}) {
    const timeoutMs = normalizePositiveInteger(
      options.processIdentitySettleTimeoutMs,
      PROCESS_IDENTITY_SETTLE_TIMEOUT_MS
    );
    const pollMs = normalizePositiveInteger(
      options.processIdentitySettlePollMs,
      PROCESS_IDENTITY_SETTLE_POLL_MS
    );
    const deadline = Date.now() + timeoutMs;
    let inspection = await inspectProcessIdentity(metadata, options);
    while (
      inspection.status === PROCESS_IDENTITY_STATUS.AMBIGUOUS &&
      Date.now() < deadline
    ) {
      await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      inspection = await inspectProcessIdentity(metadata, options);
    }
    return inspection;
  }

  async function signalVerifiedProcessGroups(metadata = {}, signal = "SIGTERM", options = {}) {
    const signalProcessGroupImpl = typeof options.signalProcessGroup === "function"
      ? options.signalProcessGroup
      : signalProcessGroup;
    const initial = await waitForProcessIdentityToSettle(metadata, options);
    if (initial.status !== PROCESS_IDENTITY_STATUS.EXACT) {
      return {
        inspection: initial,
        signaledProcessGroups: []
      };
    }
    const rootProcessGroupId = Number(metadata.pid);
    const orderedProcessGroupIds = [
      ...initial.processGroupIds.filter((processGroupId) => processGroupId !== rootProcessGroupId),
      ...initial.processGroupIds.filter((processGroupId) => processGroupId === rootProcessGroupId)
    ];
    const signaledProcessGroups = [];
    for (const processGroupId of orderedProcessGroupIds) {
      const current = await waitForProcessIdentityToSettle(metadata, options);
      if (
        current.status === PROCESS_IDENTITY_STATUS.ABSENT ||
        current.status === PROCESS_IDENTITY_STATUS.MISMATCH
      ) {
        return {
          inspection: current,
          signaledProcessGroups
        };
      }
      if (current.status !== PROCESS_IDENTITY_STATUS.EXACT) {
        return {
          inspection: current,
          signaledProcessGroups
        };
      }
      if (!current.processGroupIds.includes(processGroupId)) {
        continue;
      }
      signalProcessGroupImpl(processGroupId, signal);
      signaledProcessGroups.push(processGroupId);
    }
    return {
      inspection: await waitForProcessIdentityToSettle(metadata, options),
      signaledProcessGroups
    };
  }

  async function stopProcessGroup(metadata = {}, options = {}) {
    if (!processMetadataIsIdentifiable(metadata)) {
      return {
        identityStatus: PROCESS_IDENTITY_STATUS.INVALID,
        processExitVerified: false,
        stopped: false
      };
    }
    if (
      metadata.processState === PROCESS_STATE.STOPPED &&
      metadata.processExitVerifiedAt
    ) {
      return {
        alreadyStopped: true,
        identityStatus: PROCESS_IDENTITY_STATUS.ABSENT,
        processExitVerified: true,
        stopped: false
      };
    }
    const before = await waitForProcessIdentityToSettle(metadata, options);
    if (
      before.status === PROCESS_IDENTITY_STATUS.ABSENT ||
      before.status === PROCESS_IDENTITY_STATUS.MISMATCH
    ) {
      return {
        identityStatus: before.status,
        processExitVerified: true,
        stopped: false
      };
    }
    if (before.status !== PROCESS_IDENTITY_STATUS.EXACT) {
      return {
        identityStatus: before.status,
        processExitVerified: false,
        stopped: false
      };
    }
    const term = await signalVerifiedProcessGroups(metadata, "SIGTERM", options);
    if (term.inspection.status === PROCESS_IDENTITY_STATUS.AMBIGUOUS) {
      return {
        identityStatus: term.inspection.status,
        processExitVerified: false,
        signaledProcessGroups: term.signaledProcessGroups,
        stopped: false
      };
    }
    let after = await waitForProcessIdentityExit(
      metadata,
      options,
      normalizePositiveInteger(options.termTimeoutMs, 3000)
    );
    let signaledProcessGroups = [...term.signaledProcessGroups];
    if (after.status === PROCESS_IDENTITY_STATUS.EXACT) {
      const kill = await signalVerifiedProcessGroups(metadata, "SIGKILL", options);
      signaledProcessGroups = [...new Set([
        ...signaledProcessGroups,
        ...kill.signaledProcessGroups
      ])];
      if (kill.inspection.status === PROCESS_IDENTITY_STATUS.AMBIGUOUS) {
        return {
          identityStatus: kill.inspection.status,
          processExitVerified: false,
          signaledProcessGroups,
          stopped: false
        };
      }
      after = await waitForProcessIdentityExit(
        metadata,
        options,
        normalizePositiveInteger(options.killTimeoutMs, 1000)
      );
    }
    const processExitVerified = [
      PROCESS_IDENTITY_STATUS.ABSENT,
      PROCESS_IDENTITY_STATUS.MISMATCH
    ].includes(after.status);
    return {
      descendantProcessGroups: signaledProcessGroups.filter((processGroupId) => (
        processGroupId !== Number(metadata.pid)
      )),
      identityStatus: after.status,
      pid: Number(metadata.pid),
      processExitVerified,
      signaledProcessGroups,
      stopped: processExitVerified && signaledProcessGroups.length > 0
    };
  }

  async function captureProcessIdentity({
    commandHash = "",
    pid = null,
    reportedIdentity = null,
    runtimeToken = ""
  } = {}) {
    const expectedCommandHash = normalizeText(commandHash);
    const expectedRuntimeToken = normalizeText(runtimeToken);
    const reported = normalizeProcessIdentity(reportedIdentity);
    if (
      processIdentityIsWellFormed(reported) &&
      reported.commandHash === expectedCommandHash &&
      reported.runtimeToken === expectedRuntimeToken
    ) {
      return reported;
    }
    const normalizedPid = Number(pid);
    if (
      process.platform !== "linux" ||
      !Number.isSafeInteger(normalizedPid) ||
      normalizedPid <= 0
    ) {
      const error = new Error(`${label} process identity could not be captured.`);
      error.code = unavailableCode;
      throw error;
    }
    const processStat = linuxProcessStat(
      await readFile(`/proc/${normalizedPid}/stat`, "utf8").catch(() => "")
    );
    if (!processStat || processStat.processGroupId !== normalizedPid) {
      const error = new Error(`${label} process identity could not be captured.`);
      error.code = unavailableCode;
      throw error;
    }
    return {
      commandHash: expectedCommandHash,
      platform: PROCESS_IDENTITY_PLATFORM,
      runtimeToken: expectedRuntimeToken,
      startTimeTicks: processStat.startTimeTicks,
      version: PROCESS_IDENTITY_VERSION
    };
  }

  return Object.freeze({
    normalize: normalizeProcessIdentity,
    isValid: processIdentityIsWellFormed,
    normalizeInspection: normalizeProcessIdentityInspection,
    capture: captureProcessIdentity,
    inspect: inspectProcessIdentity,
    stop: stopProcessGroup,
    isProcessAlive: processIsAlive
  });
}
