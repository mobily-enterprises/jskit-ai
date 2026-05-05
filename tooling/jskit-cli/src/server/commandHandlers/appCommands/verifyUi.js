import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExternalShellCommand } from "./shared.js";
import {
  directoryLooksLikeJskitAppRoot
} from "../../cliRuntime/appState.js";
import {
  UI_VERIFICATION_RECEIPT_RELATIVE_PATH,
  UI_VERIFICATION_RECEIPT_VERSION,
  UI_VERIFICATION_RUNNER,
  isUiVerificationAuthMode,
  resolveChangedUiFilesFromGit
} from "../../shared/uiVerification.js";

async function runAppVerifyUiCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const { createCliError } = ctx;

  if (options?.dryRun) {
    throw createCliError("jskit app verify-ui does not support --dry-run.", { exitCode: 1 });
  }

  const inlineOptions =
    options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {};
  const command = String(inlineOptions.command || "").trim();
  const feature = String(inlineOptions.feature || "").trim();
  const authMode = String(inlineOptions["auth-mode"] || "").trim();
  const against = String(inlineOptions.against || "").trim();

  if (!command) {
    throw createCliError("jskit app verify-ui requires --command <shell-command>.", {
      exitCode: 1
    });
  }
  if (!feature) {
    throw createCliError("jskit app verify-ui requires --feature <label>.", {
      exitCode: 1
    });
  }
  if (!isUiVerificationAuthMode(authMode)) {
    throw createCliError(
      "jskit app verify-ui requires --auth-mode <none|dev-auth-login-as|session-bootstrap|custom-local>.",
      {
        exitCode: 1
      }
    );
  }
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    throw createCliError(
      "jskit app verify-ui only works in a JSKIT app root (expected app.json or .jskit/lock.json).",
      {
        exitCode: 1
      }
    );
  }

  const changedUiState = resolveChangedUiFilesFromGit(appRoot, { against });
  if (!changedUiState.available) {
    const message = against
      ? `jskit app verify-ui could not resolve changed UI files against ${JSON.stringify(against)}: ${changedUiState.error || "unknown git error"}.`
      : "jskit app verify-ui requires a git working tree so it can record changed UI files.";
    throw createCliError(message, { exitCode: 1 });
  }
  if (changedUiState.paths.length < 1) {
    const message = against
      ? `jskit app verify-ui found no changed UI files in src/ or packages/ against ${JSON.stringify(against)}.`
      : "jskit app verify-ui found no changed UI files in src/ or packages/.";
    throw createCliError(message, { exitCode: 1 });
  }

  runExternalShellCommand(command, {
    cwd: appRoot,
    stdout,
    stderr,
    createCliError
  });

  const recordedAt = new Date().toISOString();
  const receiptPath = path.join(appRoot, UI_VERIFICATION_RECEIPT_RELATIVE_PATH);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(
    receiptPath,
    `${JSON.stringify(
      {
        version: UI_VERIFICATION_RECEIPT_VERSION,
        runner: UI_VERIFICATION_RUNNER,
        recordedAt,
        feature,
        command,
        authMode,
        ...(against ? { against } : {}),
        changedUiFiles: changedUiState.paths
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  stdout.write(
    `[verify-ui] wrote ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} for ${changedUiState.paths.length} changed UI file(s).\n`
  );

  return 0;
}

export { runAppVerifyUiCommand };
