import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import {
  SESSION_ID_PATTERN,
  SESSION_STATE_RELATIVE_PATH
} from "./constants.js";
import {
  fileExists,
  normalizeText
} from "./io.js";

function formatDatePart(value) {
  return String(value).padStart(2, "0");
}

function createSessionId(now = new Date()) {
  const year = now.getFullYear();
  const month = formatDatePart(now.getMonth() + 1);
  const day = formatDatePart(now.getDate());
  const hour = formatDatePart(now.getHours());
  const minute = formatDatePart(now.getMinutes());
  const second = formatDatePart(now.getSeconds());
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
}

async function createAvailableSessionId(targetRoot, now = new Date()) {
  const baseSessionId = createSessionId(now);
  const basePaths = resolveSessionPaths({ targetRoot, sessionId: baseSessionId });
  if (
    !(await fileExists(basePaths.sessionRoot)) &&
    !(await fileExists(basePaths.completedSessionRoot)) &&
    !(await fileExists(basePaths.abandonedSessionRoot))
  ) {
    return baseSessionId;
  }

  for (let index = 1; index <= 36 ** 4 - 1; index += 1) {
    const suffix = index.toString(36).padStart(4, "0");
    const candidate = `${baseSessionId}-${suffix}`;
    const candidatePaths = resolveSessionPaths({ targetRoot, sessionId: candidate });
    if (
      !(await fileExists(candidatePaths.sessionRoot)) &&
      !(await fileExists(candidatePaths.completedSessionRoot)) &&
      !(await fileExists(candidatePaths.abandonedSessionRoot))
    ) {
      return candidate;
    }
  }

  throw new Error(`No available session id found for timestamp ${baseSessionId}.`);
}

function isValidSessionId(sessionId = "") {
  return SESSION_ID_PATTERN.test(normalizeText(sessionId));
}

function normalizeSessionId(sessionId = "") {
  const normalized = normalizeText(sessionId);
  if (!isValidSessionId(normalized)) {
    throw new Error(`Invalid session id "${sessionId}". Expected YYYY-MM-DD_HH-MM-SS.`);
  }
  return normalized;
}

function resolveSessionPaths({ targetRoot, sessionId = "" } = {}) {
  const normalizedTargetRoot = path.resolve(normalizeText(targetRoot) || process.cwd());
  const sessionStateRoot = path.join(normalizedTargetRoot, SESSION_STATE_RELATIVE_PATH);
  const sessionsRoot = path.join(sessionStateRoot, "active");
  const completedSessionsRoot = path.join(sessionStateRoot, "completed");
  const abandonedSessionsRoot = path.join(sessionStateRoot, "abandoned");
  const normalizedSessionId = sessionId ? normalizeSessionId(sessionId) : "";
  const sessionRoot = normalizedSessionId ? path.join(sessionsRoot, normalizedSessionId) : "";
  const worktree = normalizedSessionId ? path.join(sessionRoot, "worktree") : "";
  const branch = normalizedSessionId ? `jskit-studio/${normalizedSessionId}` : "";

  return Object.freeze({
    abandonedSessionRoot: normalizedSessionId ? path.join(abandonedSessionsRoot, normalizedSessionId) : "",
    abandonedSessionsRoot,
    branch,
    completedSessionRoot: normalizedSessionId ? path.join(completedSessionsRoot, normalizedSessionId) : "",
    completedSessionsRoot,
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    sessionStateRoot,
    targetRoot: normalizedTargetRoot,
    worktree
  });
}

async function resolveExistingSessionRoot(paths) {
  if (paths.archive && await fileExists(paths.sessionRoot)) {
    return {
      archive: paths.archive,
      root: paths.sessionRoot
    };
  }
  if (await fileExists(paths.sessionRoot)) {
    return {
      archive: "active",
      root: paths.sessionRoot
    };
  }
  if (await fileExists(paths.completedSessionRoot)) {
    return {
      archive: "completed",
      root: paths.completedSessionRoot
    };
  }
  if (await fileExists(paths.abandonedSessionRoot)) {
    return {
      archive: "abandoned",
      root: paths.abandonedSessionRoot
    };
  }
  return {
    archive: "",
    root: ""
  };
}

async function pathsForExistingSession(paths) {
  const existing = await resolveExistingSessionRoot(paths);
  if (!existing.root || existing.root === paths.sessionRoot) {
    return paths;
  }
  return Object.freeze({
    ...paths,
    archive: existing.archive,
    sessionRoot: existing.root
  });
}

async function archiveSession(paths, archive) {
  const archiveRoot = archive === "completed" ? paths.completedSessionRoot : paths.abandonedSessionRoot;
  if (!archiveRoot || paths.sessionRoot === archiveRoot) {
    return paths;
  }
  if (!(await fileExists(paths.sessionRoot))) {
    return pathsForExistingSession(paths);
  }
  if (await fileExists(archiveRoot)) {
    throw new Error(`Cannot archive session ${paths.sessionId}; target already exists: ${archiveRoot}`);
  }
  await mkdir(path.dirname(archiveRoot), { recursive: true });
  await rename(paths.sessionRoot, archiveRoot);
  return Object.freeze({
    ...paths,
    archive,
    sessionRoot: archiveRoot
  });
}

export {
  archiveSession,
  createAvailableSessionId,
  createSessionId,
  isValidSessionId,
  normalizeSessionId,
  resolveExistingSessionRoot,
  resolveSessionPaths,
  pathsForExistingSession
};
