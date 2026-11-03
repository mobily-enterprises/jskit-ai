import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { isRecord, normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Fixed locale and zone make `lstart` parseable and stable across restarts.
async function runPs(args) {
  const { stdout } = await execFileAsync("ps", args, {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout;
}

/**
 * Process-group ownership proof used by execution hosts; callers retain their metadata contract.
 * @param {object} [options]
 * @param {string} [options.runtimeTokenEnvironmentName]
 * @param {string} [options.commandHashEnvironmentName]
 * @param {string} [options.label]
 * @param {string} [options.unavailableCode]
 * @param {NodeJS.Platform} [options.platform]
 * @param {(args: string[]) => Promise<string>} [options.ps] Runs ps; the system's own by default.
 */
export function createConversationProcessIdentity({
  runtimeTokenEnvironmentName = "JSKIT_EXECUTION_RUNTIME_TOKEN",
  commandHashEnvironmentName = "JSKIT_EXECUTION_COMMAND_HASH",
  label = "Native",
  unavailableCode = "native_process_identity_unavailable",
  platform = process.platform,
  ps = runPs
} = {}) {
  const PROCESS_IDENTITY_SETTLE_TIMEOUT_MS = 1000;
  // Darwin inspection spawns ps instead of reading /proc, so it polls less often.
  const PROCESS_IDENTITY_SETTLE_POLL_MS = platform === "darwin" ? 100 : 25;
  const PROCESS_IDENTITY_VERSION = 1;
  const PROCESS_IDENTITY_PLATFORMS = Object.freeze({ linux: "linux-proc", darwin: "darwin" });
  const hostIdentityPlatform = PROCESS_IDENTITY_PLATFORMS[platform] || "";
  const PROCESS_STATE = Object.freeze({ RUNNING: "running", STOPPED: "stopped" });
  const PROCESS_IDENTITY_STATUS = Object.freeze({
    ABSENT: "absent", AMBIGUOUS: "ambiguous", EXACT: "exact", INVALID: "invalid", MISMATCH: "mismatch"
  });

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
    const normalized = isRecord(value) ? value : {};
    return {
      commandHash: normalizeNullableText(normalized.commandHash),
      platform: normalizeNullableText(normalized.platform),
      runtimeToken: normalizeNullableText(normalized.runtimeToken),
      startTimeTicks: normalizeNullableText(normalized.startTimeTicks),
      version: Number(normalized.version || 0)
    };
  }

  function processIdentityIsWellFormed(value = {}) {
    const identity = normalizeProcessIdentity(value);
    return Boolean(
      identity.version === PROCESS_IDENTITY_VERSION &&
      Object.values(PROCESS_IDENTITY_PLATFORMS).includes(identity.platform) &&
      /^[a-f0-9]{12}$/u.test(identity.commandHash) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identity.runtimeToken) &&
      /^\d+$/u.test(identity.startTimeTicks)
    );
  }

  /** The value of `name` in a list of NAME=value environment entries. */
  function environmentValue(entries = [], name = "") {
    const entry = entries.find((assignment) => assignment.startsWith(`${name}=`));
    return entry ? entry.slice(name.length + 1) : "";
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
      const entries = environmentReadable ? environment.toString("utf8").split("\0") : [];
      records.push({
        ...processStat,
        commandHash: environmentValue(entries, commandHashEnvironmentName),
        environmentReadable,
        pid,
        runtimeToken: environmentValue(entries, runtimeTokenEnvironmentName)
      });
    }
    return records;
  }

  const DARWIN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** `ps -o lstart=` in the C locale and UTC, as whole epoch seconds. */
  function darwinStartTime(value = "") {
    const match = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/u.exec(String(value).trim());
    const month = match ? DARWIN_MONTHS.indexOf(match[1]) : -1;
    if (month < 0) {
      return "";
    }
    const [, , day, hours, minutes, seconds, year] = match.map(Number);
    return String(Date.UTC(year, month, day, hours, minutes, seconds) / 1000);
  }

  function darwinCommandsByPid(output = "") {
    const commands = new Map();
    for (const line of String(output).split("\n")) {
      const match = /^\s*(\d+) (.*)$/u.exec(line);
      if (match) {
        commands.set(Number(match[1]), match[2]);
      }
    }
    return commands;
  }

  /** The `ps -E` text after the argument list, as its assignments, or null when no environment is shown. */
  function darwinEnvironment(command, commandWithEnvironment) {
    if (command === undefined || !commandWithEnvironment?.startsWith(command)) {
      return null;
    }
    const assignments = commandWithEnvironment.slice(command.length).split(/\s+/u).filter((entry) => /^[^=\s]+=/u.test(entry));
    return assignments.length ? assignments : null;
  }

  /** The darwin counterpart of the /proc scan. Only the current user's environments are readable;
   * a listing without a separate environment section stays unreadable so inspection degrades to ambiguous. */
  async function darwinProcessRecords() {
    const currentUid = process.getuid();
    const ownProcesses = ["-x", "-U", String(currentUid), "-ww", "-o", "pid=,command="];
    const [table, commandOutput, environmentOutput] = await Promise.all([
      ps(["-ax", "-o", "pid=,pgid=,uid=,stat=,lstart="]),
      ps(ownProcesses),
      ps(["-E", ...ownProcesses])
    ]);
    const commands = darwinCommandsByPid(commandOutput);
    const commandsWithEnvironment = darwinCommandsByPid(environmentOutput);
    const records = [];
    for (const line of String(table).split("\n")) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+[\d:]{8}\s+\d{4})\s*$/u.exec(line);
      if (!match || match[4].startsWith("Z")) {
        continue;
      }
      const pid = Number(match[1]);
      const environment = Number(match[3]) === currentUid
        ? darwinEnvironment(commands.get(pid), commandsWithEnvironment.get(pid))
        : null;
      records.push({
        commandHash: environmentValue(environment || [], commandHashEnvironmentName),
        environmentReadable: Boolean(environment),
        pid,
        processGroupId: Number(match[2]),
        runtimeToken: environmentValue(environment || [], runtimeTokenEnvironmentName),
        startTimeTicks: darwinStartTime(match[5])
      });
    }
    return records;
  }

  /** An inspector's answer, which may be null, as an exact or ambiguous set of process groups. */
  function normalizeProcessIdentityInspection(value) {
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

  async function inspectHostProcessIdentity(metadata = {}) {
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
    const identity = metadata.processIdentity;
    const records = identity.platform !== hostIdentityPlatform
      ? null
      : platform === "darwin"
        ? await darwinProcessRecords().catch(() => null)
        : await linuxProcessRecords();
    if (!records) {
      return {
        processGroupIds: [],
        status: PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
    const rootProcessGroupId = Number(metadata.pid);
    const rootGroupMembers = records.filter(({ processGroupId }) => processGroupId === rootProcessGroupId);
    const exactRecords = [];
    const rootUnreadable = rootGroupMembers.some(({ environmentReadable }) => !environmentReadable);
    for (const record of records) {
      if (!record.environmentReadable) {
        continue;
      }
      if (record.runtimeToken === identity.runtimeToken && record.commandHash === identity.commandHash) {
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
    const inspector = options.processIdentityInspector ?? inspectHostProcessIdentity;
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
      { fallback: PROCESS_IDENTITY_SETTLE_TIMEOUT_MS }
    );
    const pollMs = normalizePositiveInteger(
      options.processIdentitySettlePollMs,
      { fallback: PROCESS_IDENTITY_SETTLE_POLL_MS }
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
    const signalProcessGroupImpl = options.signalProcessGroup ?? signalProcessGroup;
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
      normalizePositiveInteger(options.termTimeoutMs, { fallback: 3000 })
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
        normalizePositiveInteger(options.killTimeoutMs, { fallback: 1000 })
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

  async function captureProcessStart(pid) {
    if (platform !== "darwin") {
      return linuxProcessStat(await readFile(`/proc/${pid}/stat`, "utf8").catch(() => ""));
    }
    const output = String(await ps(["-o", "pgid=,lstart=", "-p", String(pid)]).catch(() => ""));
    const match = /^\s*(\d+)\s+(.+?)\s*$/u.exec(output);
    return match ? { processGroupId: Number(match[1]), startTimeTicks: darwinStartTime(match[2]) } : null;
  }

  async function captureProcessIdentity({
    commandHash = "",
    pid = null,
    reportedIdentity = null,
    runtimeToken = ""
  } = {}) {
    const expectedCommandHash = normalizeNullableText(commandHash);
    const expectedRuntimeToken = normalizeNullableText(runtimeToken);
    const reported = normalizeProcessIdentity(reportedIdentity);
    if (
      processIdentityIsWellFormed(reported) &&
      reported.commandHash === expectedCommandHash &&
      reported.runtimeToken === expectedRuntimeToken
    ) {
      return reported;
    }
    const normalizedPid = Number(pid);
    const processStat = hostIdentityPlatform && Number.isSafeInteger(normalizedPid) && normalizedPid > 0
      ? await captureProcessStart(normalizedPid)
      : null;
    if (!processStat?.startTimeTicks || processStat.processGroupId !== normalizedPid) {
      const error = new Error(`${label} process identity could not be captured.`);
      error.code = unavailableCode;
      throw error;
    }
    return {
      commandHash: expectedCommandHash,
      platform: hostIdentityPlatform,
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
