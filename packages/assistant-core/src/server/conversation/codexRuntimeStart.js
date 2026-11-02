import WebSocket from "ws";
import { readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { copyCodexProviderHome } from "./codexConfiguration.js";
import { codexDisabledProcessFeatureArguments } from "./codexHomeStorage.js";
import {
  CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES, CODEX_APP_SERVER_ENDPOINT_STATUS, CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS, CODEX_APP_SERVER_METADATA_SCHEMA_VERSION, CODEX_APP_SERVER_PROCESS_STATE,
  CODEX_APP_SERVER_PROVIDER_ID, CODEX_APP_SERVER_READY_TIMEOUT_MS, CODEX_APP_SERVER_TRANSPORT,
  CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES, assertExistingDirectory, codexAppServerCommandBaseEnv,
  codexAppServerCredentialHome, codexAppServerExecutionMode, codexAppServerHelperCommandBaseEnv,
  codexAppServerHelperHomeDir, codexAppServerHelperWorkspaceDir, codexAppServerLogPath, codexAppServerProcessCommandHash,
  codexAppServerProcessCwd, codexAppServerProjectTrustOverride, codexAppServerSocketPath, codexAppServerSocketPathBytes,
  codexAppServerSocketPathTooLong, codexAppServerTerminalEnvHash, codexAppServerUnixEndpoint, codexCommandHookDefinition,
  codexHistoryAdapterUrlIsValid, ensureWritablePrivateDirectory, fileExists, normalizeCodexAppServerTerminalEnv,
  stableHash, tailTextFile
} from "./codexProcess.js";

// Inline TOML for `-c` overrides: bare keys, JSON-quoted strings.
function tomlInlineValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(tomlInlineValue).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value).map(([key, item]) => `${key}=${tomlInlineValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Starts the native app-server process under the host's execution facility.
 * @param {object} dependencies
 * @param {import("./codexRuntime.js").CodexRuntimeExecution} dependencies.execution
 * @param {import("./codexRuntime.js").CodexRuntimeCredentials} dependencies.credentials
 * @param {import("./codexRuntime.js").CodexProcessIdentity} dependencies.processIdentity
 * @param {import("./codexRuntimeStop.js").CodexRuntimeStop} dependencies.stop
 * @param {(endpoint: string, options: object) => Promise<{ status: string }>} dependencies.endpointStatus
 * @param {(endpoint: string, options: object) => Promise<boolean>} dependencies.waitForServer
 * @param {import("./codexRuntime.js").CodexRuntimeSettings} dependencies.settings
 */
export function createCodexAppServerProcessStart({
  execution,
  credentials,
  processIdentity,
  stop,
  endpointStatus: codexAppServerEndpointStatus,
  waitForServer: waitForCodexAppServer,
  settings
}) {
  const {
    commandHookCommand,
    errorPrefix,
    modelCatalogEnvironmentName,
    processLabel,
    processPath,
    runtimeTokenEnvironmentName,
    commandHashEnvironmentName,
    socketPathHelp,
    umask
  } = settings;
  const CODEX_APP_SERVER_PROCESS_PATH = processPath;
  const CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV = runtimeTokenEnvironmentName;
  const CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV = commandHashEnvironmentName;
  const captureCodexAppServerProcessIdentity = processIdentity.capture;
  const currentCodexAuthStateSignature = credentials.generation;
  const assertCodexAuthGenerationCurrent = credentials.assertCurrent;
  const cleanupFailedCodexAppServerStart = stop.cleanupFailedStart;

  function codexAppServerSessionCommandHookConfig() {
    return `hooks.PreToolUse=${tomlInlineValue(codexCommandHookDefinition(commandHookCommand))}`;
  }

  // An empty or null umask inherits the host's own; hosts that share files set one.
  const startupUmask = normalizeNullableText(umask);
  if (startupUmask && !/^[0-7]{3,4}$/u.test(startupUmask)) {
    throw new TypeError(`Codex app-server umask must be octal, not ${JSON.stringify(startupUmask)}.`);
  }
  const CODEX_APP_SERVER_UMASK_LINES = startupUmask ? [`umask ${startupUmask}`] : [];

  const CODEX_APP_SERVER_MANAGED_SHELL = "/bin/sh";

  const CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT = [
    ...CODEX_APP_SERVER_UMASK_LINES,
    `unset ${[...CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES].join(" ")}`,
    'exec "$@"'
  ].join("\n");

  const CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT = [
    ...CODEX_APP_SERVER_UMASK_LINES,
    "exec /usr/bin/env -i \\",
    '  HOME="$HOME" LOGNAME="$LOGNAME" USER="$USER" PATH="$PATH" \\',
    '  CODEX_HOME="$CODEX_HOME" LANG="$LANG" LC_ALL="$LC_ALL" LC_CTYPE="$LC_CTYPE" \\',
    `  ${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}="$${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}" ${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}="$${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}" \\`,
    '  SSL_CERT_DIR="$SSL_CERT_DIR" SSL_CERT_FILE="$SSL_CERT_FILE" TERM="$TERM" TMPDIR="$TMPDIR" TZ="$TZ" \\',
    '  "$@"'
  ].join("\n");

  function assertCodexAppServerSocketPathSupported(socketPath = "") {
    if (!codexAppServerSocketPathTooLong(socketPath)) {
      return;
    }
    throw new Error(
      `Codex app-server Unix socket path is too long for this OS: ${socketPath} ` +
      `(${codexAppServerSocketPathBytes(socketPath)} bytes, max ${CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES}). ` +
      socketPathHelp
    );
  }

  async function startCodexAppServerProcess({
    providerHome = false,
    accountIdentitySignature = "",
    authStateSignature = "",
    codexCommand = "codex",
    env = process.env,
    executionRoot = "",
    executionMode = CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    killTimeoutMs = 0,
    processIdentityInspector = null,
    readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
    signalProcessGroup: signalProcessGroupOverride = null,
    stopExecution = null,
    terminalEnv = {},
    termTimeoutMs = 0,
    toolHomeSource = "",
    WebSocketImpl = WebSocket,
    workdir = "",
    socketOwnerDrained = false,
    runtimeDir,
    ownerId = "",
    compatibility
  } = {}) {
    const processLifecycleOptions = {
      killTimeoutMs,
      processIdentityInspector,
      signalProcessGroup: signalProcessGroupOverride,
      stopExecution,
      termTimeoutMs
    };
    await ensureWritablePrivateDirectory(runtimeDir);
    const helper = codexAppServerExecutionMode({ executionMode }) ===
      CODEX_APP_SERVER_EXECUTION_MODES.HELPER;
    const normalizedToolHomeSource = normalizeNullableText(toolHomeSource);
    if (normalizedToolHomeSource) {
      await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
    }
    const resolvedAuthStateSignature = await currentCodexAuthStateSignature({ authStateSignature });
    await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature);
    const socketPath = codexAppServerSocketPath(runtimeDir);
    assertCodexAppServerSocketPathSupported(socketPath);
    const endpoint = codexAppServerUnixEndpoint(socketPath);
    const logPath = codexAppServerLogPath(runtimeDir);
    const helperHome = helper ? codexAppServerHelperHomeDir(runtimeDir) : "";
    const helperWorkspace = helper ? codexAppServerHelperWorkspaceDir(runtimeDir) : "";
    if (helper) {
      await Promise.all([
        rm(helperHome, { force: true, recursive: true }),
        rm(helperWorkspace, { force: true, recursive: true })
      ]);
      await Promise.all([
        ensureWritablePrivateDirectory(helperHome),
        ensureWritablePrivateDirectory(helperWorkspace)
      ]);
      if (providerHome) {
        // The canonical home contains only our curated provider projection. Copy
        // it into the existing isolated helper home; never load OpenAI auth here.
        try {
          await copyCodexProviderHome(path.join(normalizedToolHomeSource, ".codex"), helperHome);
        } catch (cause) {
          const error = new Error("Codex isolated helper runtime could not copy the provider home.", { cause });
          error.code = `${errorPrefix}codex_helper_runtime_start_failed`;
          throw error;
        }
      }
    }
    const processCwd = helper
      ? helperWorkspace
      : codexAppServerProcessCwd({
          executionRoot,
          runtimeDir,
          workdir
        });
    const projectTrustOverride = helper ? "" : codexAppServerProjectTrustOverride(workdir);
    const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(helper ? {} : terminalEnv);
    const commandBaseEnv = helper
      ? codexAppServerHelperCommandBaseEnv(env, helperHome)
      : codexAppServerCommandBaseEnv({
          env,
          terminalEnv: normalizedTerminalEnv
        });
    if (await fileExists(socketPath) && !socketOwnerDrained) {
      const endpointStatus = await codexAppServerEndpointStatus(endpoint, {
        timeoutMs: CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
        WebSocketImpl
      });
      if (![CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING, CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE]
        .includes(endpointStatus.status)) {
        const error = new Error("The existing Codex app-server socket still has an unretired owner.");
        error.code = `${errorPrefix}codex_app_server_socket_owner_unverified`;
        error.retryable = false;
        throw error;
      }
    }
    await rm(socketPath, {
      force: true
    });
    const codexArgs = [
      // Keep every override after app-server: a trailing -c (including the model
      // catalogue) otherwise drops the earlier ones. See openai/codex#39012.
      "app-server",
      "--listen",
      endpoint,
      // App-server uses config overrides, not the top-level sandbox bypass flag.
      ...(helper ? [] : [
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="danger-full-access"',
        "-c",
        `features.hooks=${Boolean(commandHookCommand)}`,
        ...(commandHookCommand ? ["-c", codexAppServerSessionCommandHookConfig()] : [])
      ]),
      "-c",
      "check_for_update_on_startup=false",
      // Plugin and app startup syncs fill the home with unused catalogues.
      ...codexDisabledProcessFeatureArguments(),
      ...(projectTrustOverride
        ? [
            "-c",
            projectTrustOverride
          ]
        : [])
    ];
    const runtimeToken = randomUUID();
    const commandHash = codexAppServerProcessCommandHash({
      codexArgs,
      codexCommand,
      executionMode,
      processCwd,
      runtimeDir
    });
    const baseEnv = {
      ...commandBaseEnv,
      // A curated provider home contains a provider-only static catalogue. Use
      // the binary's native definitions as the base for its shared runtime.
      [modelCatalogEnvironmentName]: providerHome ? "bundled" : "native",
      [CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV]: commandHash,
      [CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV]: runtimeToken
    };
    const profileBinary = path.isAbsolute(codexCommand) ? await stat(codexCommand).catch(() => null) : null;
    const startResult = await execution.run({
      args: [
        "-c",
        helper ? CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT,
        processLabel,
        ...(helper ? [] : [process.execPath, CODEX_APP_SERVER_PROCESS_PATH, runtimeDir]),
        codexCommand,
        ...codexArgs
      ],
      baseEnv,
      command: CODEX_APP_SERVER_MANAGED_SHELL,
      credentialHome: codexAppServerCredentialHome(
        helper ? helperHome : normalizedToolHomeSource,
        baseEnv
      ),
      cwd: processCwd || process.cwd(),
      execution: {
        kind: "assistant",
        label: "Codex assistant",
        lifecycle: "service",
        operationId: "codex-app-server",
        ownerId: normalizeNullableText(ownerId) || stableHash(runtimeDir)
      },
      processProfile: profileBinary?.isFile() ? {
        command: codexCommand, helper, executionMode,
        binary: [profileBinary.dev, profileBinary.ino, profileBinary.size, profileBinary.mtimeMs, profileBinary.ctimeMs],
        platform: process.platform, architecture: process.arch,
        startup: helper ? CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT,
        historyAdapter: !helper
      } : null,
      logPath,
      inheritProcessEnv: false,
      mode: "detached",
      timeout: readyTimeoutMs
    });
    if (!startResult.ok) {
      const failedProcessIdentity = await captureCodexAppServerProcessIdentity({
        commandHash,
        pid: startResult.pid,
        reportedIdentity: startResult.processIdentity,
        runtimeToken
      }).catch(() => null);
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        neverStarted: !Number.isSafeInteger(Number(startResult.pid)),
        pid: startResult.pid,
        processIdentity: failedProcessIdentity
      }, processLifecycleOptions);
      const error = new Error(
        startResult.output || startResult.error ||
        (helper ? "Codex isolated helper runtime failed to start." : "Codex app-server failed to start.")
      );
      error.code = cleanup.cleanupFailed
        ? (helper
            ? `${errorPrefix}codex_helper_runtime_cleanup_required`
            : `${errorPrefix}codex_app_server_cleanup_required`)
        : (startResult.code || (helper
            ? `${errorPrefix}codex_helper_runtime_start_failed`
            : `${errorPrefix}codex_app_server_start_failed`));
      error.cleanupRequired = cleanup.cleanupFailed;
      error.execution = startResult.execution;
      error.retryable = cleanup.cleanupFailed ? false : startResult.retryable === true;
      throw error;
    }

    let processIdentity;
    try {
      processIdentity = await captureCodexAppServerProcessIdentity({
        commandHash,
        pid: startResult.pid,
        reportedIdentity: startResult.processIdentity,
        runtimeToken
      });
    } catch (cause) {
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity: startResult.processIdentity
      }, processLifecycleOptions);
      const error = new Error("Codex app-server process ownership could not be recorded.", {
        cause
      });
      error.code = cleanup.cleanupFailed
        ? `${errorPrefix}codex_app_server_cleanup_required`
        : `${errorPrefix}codex_app_server_process_identity_unavailable`;
      error.cleanupRequired = cleanup.cleanupFailed;
      throw error;
    }

    const ready = await waitForCodexAppServer(endpoint, {
      timeoutMs: readyTimeoutMs,
      WebSocketImpl
    });
    if (!ready) {
      const logTail = await tailTextFile(logPath);
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity
      }, processLifecycleOptions);
      if (!cleanup.cleanupFailed && !helper) {
        await credentials.observeFailure(logTail);
      }
      const error = new Error([
        helper
          ? "Codex isolated helper runtime did not become ready."
          : `Codex app-server did not become ready at ${endpoint}.`,
        logTail ? `Recent log output:\n${logTail}` : ""
      ].filter(Boolean).join("\n"));
      error.code = cleanup.cleanupFailed
        ? (helper
            ? `${errorPrefix}codex_helper_runtime_cleanup_required`
            : `${errorPrefix}codex_app_server_cleanup_required`)
        : (helper
            ? `${errorPrefix}codex_helper_runtime_start_failed`
            : `${errorPrefix}codex_app_server_ready_timeout`);
      error.cleanupRequired = cleanup.cleanupFailed;
      error.retryable = false;
      throw error;
    }

    let historyAdapterBaseUrl = "";
    try {
      if (!helper) {
        const descriptor = JSON.parse(await readFile(path.join(runtimeDir, "history-adapter.json"), "utf8"));
        if (descriptor.runtimeToken !== runtimeToken || !codexHistoryAdapterUrlIsValid(descriptor.baseUrl, runtimeToken)) {
          throw new Error("Codex history adapter did not confirm the current runtime.");
        }
        historyAdapterBaseUrl = descriptor.baseUrl;
      }
      await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature);
    } catch (cause) {
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity
      }, processLifecycleOptions);
      if (cleanup.cleanupFailed) {
        const error = new Error("Codex app-server authentication changed and its execution could not be drained.", {
          cause
        });
        error.code = `${errorPrefix}codex_app_server_cleanup_required`;
        error.cleanupRequired = true;
        error.retryable = false;
        throw error;
      }
      throw cause;
    }

    return {
      accountIdentitySignature: normalizeNullableText(accountIdentitySignature),
      attachmentHostRoot: compatibility.attachmentHostRoot,
      authStateSignature: resolvedAuthStateSignature,
      endpoint,
      executionId: normalizeNullableText(startResult.execution?.id),
      executionMode: helper
        ? CODEX_APP_SERVER_EXECUTION_MODES.HELPER
        : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
      executionContextHash: compatibility.executionContextHash,
      healthz: "",
      historyAdapterBaseUrl,
      logPath,
      pid: Number.isSafeInteger(Number(startResult.pid)) ? Number(startResult.pid) : null,
      processCwd,
      processIdentity,
      processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      readyz: "",
      runtimeDir,
      runtimesHash: compatibility.runtimesHash,
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
      socketPath,
      startedAt: new Date().toISOString(),
      terminalEnvHash: codexAppServerTerminalEnvHash(normalizedTerminalEnv),
      toolHomeSource: helper ? "" : normalizedToolHomeSource,
      transport: CODEX_APP_SERVER_TRANSPORT.UNIX
    };
  }

  return Object.freeze({ start: startCodexAppServerProcess });
}
