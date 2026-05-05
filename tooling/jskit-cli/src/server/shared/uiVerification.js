import { spawnSync } from "node:child_process";
import path from "node:path";

const UI_VERIFICATION_RECEIPT_VERSION = 1;
const UI_VERIFICATION_RECEIPT_RELATIVE_PATH = ".jskit/verification/ui.json";
const UI_VERIFICATION_RUNNER = "playwright";
const UI_VERIFICATION_AUTH_MODES = new Set([
  "none",
  "dev-auth-login-as",
  "session-bootstrap",
  "custom-local"
]);

const UI_EXTENSION_SET = new Set([
  ".vue"
]);

const UI_SCRIPT_PATH_PATTERNS = Object.freeze([
  /^src\/components\//u,
  /^src\/composables\//u,
  /^src\/layouts\//u,
  /^src\/pages\//u,
  /^src\/stores\//u,
  /^src\/placement\.[A-Za-z0-9]+$/u,
  /^packages\/[^/]+(?:-web)?\/src\/client\//u
]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function sortUniqueStrings(values = []) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function isUiVerificationAuthMode(value = "") {
  return UI_VERIFICATION_AUTH_MODES.has(normalizeText(value));
}

function isUiVerificationPath(relativePath = "") {
  const normalizedPath = normalizeText(relativePath).replace(/\\/g, "/");
  if (!normalizedPath) {
    return false;
  }

  if (UI_EXTENSION_SET.has(path.extname(normalizedPath).toLowerCase())) {
    return normalizedPath.startsWith("src/") || normalizedPath.startsWith("packages/");
  }

  return UI_SCRIPT_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function readGitPathList(appRoot = "", args = []) {
  const result = spawnSync("git", Array.isArray(args) ? args : [], {
    cwd: appRoot || process.cwd(),
    encoding: "utf8"
  });

  if (result?.error || result?.status !== 0) {
    return {
      ok: false,
      paths: [],
      error: normalizeText(result?.stderr) || normalizeText(result?.error?.message)
    };
  }

  return {
    ok: true,
    paths: sortUniqueStrings(String(result.stdout || "").split(/\r?\n/u)),
    error: ""
  };
}

function resolveChangedPathsFromGit(
  appRoot = "",
  {
    against = "",
    pathspecs = ["src", "packages"]
  } = {}
) {
  const normalizedAgainst = normalizeText(against);
  const gitRepoCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: appRoot || process.cwd(),
    encoding: "utf8"
  });

  if (
    gitRepoCheck?.error ||
    gitRepoCheck?.status !== 0 ||
    normalizeText(gitRepoCheck.stdout).toLowerCase() !== "true"
  ) {
    return {
      available: false,
      paths: [],
      against: normalizedAgainst,
      mode: normalizedAgainst ? "against-base-ref" : "dirty-worktree",
      error: "Current directory is not inside a git work tree."
    };
  }

  const normalizedPathspecs = sortUniqueStrings(pathspecs);
  const pathspecArgs = normalizedPathspecs.length > 0 ? ["--", ...normalizedPathspecs] : [];
  const changedPathSets = [];

  if (normalizedAgainst) {
    const baseDiff = readGitPathList(appRoot, [
      "diff",
      "--name-only",
      "--relative",
      `${normalizedAgainst}...HEAD`,
      ...pathspecArgs
    ]);
    if (!baseDiff.ok) {
      return {
        available: false,
        paths: [],
        against: normalizedAgainst,
        mode: "against-base-ref",
        error:
          baseDiff.error ||
          `Could not resolve git diff against ${JSON.stringify(normalizedAgainst)}.`
      };
    }
    changedPathSets.push(baseDiff);
  }

  changedPathSets.push(
    readGitPathList(appRoot, ["diff", "--name-only", "--relative", "--cached", ...pathspecArgs]),
    readGitPathList(appRoot, ["diff", "--name-only", "--relative", ...pathspecArgs]),
    readGitPathList(appRoot, ["ls-files", "--others", "--exclude-standard", ...pathspecArgs])
  );

  const changedPaths = sortUniqueStrings(
    changedPathSets
      .filter((entry) => entry.ok)
      .flatMap((entry) => entry.paths)
  );

  return {
    available: true,
    paths: changedPaths,
    against: normalizedAgainst,
    mode: normalizedAgainst ? "against-base-ref" : "dirty-worktree",
    error: ""
  };
}

function resolveChangedUiFilesFromGit(appRoot = "", { against = "" } = {}) {
  const changedPathState = resolveChangedPathsFromGit(appRoot, {
    against,
    pathspecs: ["src", "packages"]
  });
  if (!changedPathState.available) {
    return changedPathState;
  }

  return {
    ...changedPathState,
    paths: changedPathState.paths.filter((relativePath) => isUiVerificationPath(relativePath))
  };
}

function normalizeUiVerificationReceipt(rawReceipt = {}) {
  const receipt = rawReceipt && typeof rawReceipt === "object" && !Array.isArray(rawReceipt) ? rawReceipt : {};

  return Object.freeze({
    version: Number.isInteger(receipt.version) ? receipt.version : null,
    runner: normalizeText(receipt.runner),
    recordedAt: normalizeText(receipt.recordedAt),
    feature: normalizeText(receipt.feature),
    command: normalizeText(receipt.command),
    authMode: normalizeText(receipt.authMode),
    against: normalizeText(receipt.against),
    changedUiFiles: sortUniqueStrings(receipt.changedUiFiles)
  });
}

function isValidUiVerificationReceipt(receipt) {
  const normalizedReceipt = normalizeUiVerificationReceipt(receipt);

  return (
    normalizedReceipt.version === UI_VERIFICATION_RECEIPT_VERSION &&
    normalizedReceipt.runner === UI_VERIFICATION_RUNNER &&
    Boolean(normalizedReceipt.recordedAt) &&
    Boolean(normalizedReceipt.feature) &&
    Boolean(normalizedReceipt.command) &&
    isUiVerificationAuthMode(normalizedReceipt.authMode)
  );
}

export {
  UI_VERIFICATION_AUTH_MODES,
  UI_VERIFICATION_RECEIPT_RELATIVE_PATH,
  UI_VERIFICATION_RECEIPT_VERSION,
  UI_VERIFICATION_RUNNER,
  isUiVerificationAuthMode,
  isUiVerificationPath,
  isValidUiVerificationReceipt,
  normalizeUiVerificationReceipt,
  resolveChangedPathsFromGit,
  resolveChangedUiFilesFromGit,
  sortUniqueStrings
};
