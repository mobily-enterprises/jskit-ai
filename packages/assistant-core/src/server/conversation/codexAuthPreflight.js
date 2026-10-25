import path from "node:path";
import { codexAuthOutputRequiresReconnect } from "./codexConfiguration.js";
import {
  assertExistingDirectory, codexAppServerCommandBaseEnv, codexAppServerCredentialHome,
  codexAppServerProcessCwd, ensureWritablePrivateDirectory, normalizePositiveInteger
} from "./codexProcess.js";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";

// Codex auth preflight: one bounded `codex debug models` run whose
// reconnect-required output marks the stored credentials invalid.
const CODEX_AUTH_PREFLIGHT_TIMEOUT_MS = 15000;
const CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES = 4096;

function tailAppend(text = "", chunk = "", maxBytes = CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES) {
  const next = `${String(text || "")}${String(chunk || "")}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function codexAuthPreflightArgs() {
  return [
    "-c",
    "check_for_update_on_startup=false",
    "debug",
    "models"
  ];
}

async function runCodexAuthPreflight({
  codexCommand = "codex",
  env = process.env,
  executionRoot = "",
  runtimeDir = "",
  terminalEnv = {},
  timeoutMs = CODEX_AUTH_PREFLIGHT_TIMEOUT_MS,
  toolHomeSource = "",
  workdir = ""
} = {}, execution) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (normalizedRuntimeDir) {
    await ensureWritablePrivateDirectory(path.resolve(normalizedRuntimeDir));
  }
  const baseEnv = codexAppServerCommandBaseEnv({
    env,
    terminalEnv
  });
  const processCwd = codexAppServerProcessCwd({
    executionRoot,
    runtimeDir,
    workdir
  });
  try {
    const result = await execution.run({
      args: codexAuthPreflightArgs(),
      baseEnv,
      command: codexCommand,
      credentialHome: codexAppServerCredentialHome(normalizedToolHomeSource, baseEnv),
      cwd: processCwd,
      inheritProcessEnv: false,
      mode: "capture",
      timeout: normalizePositiveInteger(timeoutMs, CODEX_AUTH_PREFLIGHT_TIMEOUT_MS)
    });
    return {
      code: result.exitCode,
      ok: result.ok === true,
      output: tailAppend("", result.output || [
        result.stderr,
        result.stdout
      ].filter(Boolean).join("\n")),
      signal: result.signal,
      timedOut: result.timedOut === true
    };
  } catch (error) {
    return {
      error,
      ok: false,
      output: normalizeAgentText(error?.message || error)
    };
  }
}

export async function assertCodexAuthPreflightReady(options = {}, {
  reason = "codex-auth-preflight", execution, credentials
} = {}) {
  const result = await runCodexAuthPreflight(options, execution);
  if (result.ok && !codexAuthOutputRequiresReconnect(result.output)) {
    return result;
  }
  const observed = normalizeAgentText(result.output || result.error?.message || "Codex auth preflight failed.");
  if (codexAuthOutputRequiresReconnect(observed)) {
    await credentials.markInvalid( {
      reason
    });
    throw credentials.reconnectError({
      modelProviderId: "",
      observed
    });
  }
  throw new Error(observed || "Codex auth preflight failed.");
}
