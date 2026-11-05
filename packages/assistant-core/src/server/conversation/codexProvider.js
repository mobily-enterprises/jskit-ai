import { CODEX_APP_SERVER_EXECUTION_MODES, CODEX_APP_SERVER_PROCESS_STATE, CODEX_APP_SERVER_PROVIDER_ID, CODEX_APP_SERVER_TRANSPORT, codexAppServerExecutionMode, codexAppServerHelperWorkspaceDir, codexAppServerIsHelper, codexAppServerRuntimeIdentity, codexAppServerTerminalEnvHash, ensureWritablePrivateDirectory, tailTextFile } from "./codexProcess.js";
import { CodexAppServerJsonRpcClient } from "./codexClient.js";
import { codexAppServerTextHasControlCharacters } from "./codexConfiguration.js";
import { codexAuthOutputRequiresReconnect, createCodexAccountReader } from "./codexAccountReader.js";
import { codexAppServerModelCatalogError } from "./codexModelCatalog.js";
import { createCodexConversationAdapter } from "./providers/codex.js";
import { codexAppServerHelperRequestError, createCodexProviderAuth } from "./codexProviderAuth.js";
import { codexAppServerThreadRequestParams, createCodexProviderThreads, keepCodexThreadParams, resumeCodexThreadAsIs } from "./codexProviderThreads.js";
import { createCodexProviderInventories } from "./codexProviderInventories.js";
import { createCodexProviderTurns } from "./codexProviderTurns.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import path from "node:path";

const CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

const CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH = 512;

function normalizeCodexAppServerInfo(initializeResult = null) {
  if (!isRecord(initializeResult)) {
    return null;
  }
  const rawUserAgent = initializeResult.userAgent;
  if (
    typeof rawUserAgent !== "string" ||
    rawUserAgent.length === 0 ||
    rawUserAgent.length > CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH ||
    codexAppServerTextHasControlCharacters(rawUserAgent)
  ) {
    return Object.freeze({ userAgent: "" });
  }
  return Object.freeze({
    userAgent: rawUserAgent.trim()
  });
}

const CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD = "account/chatgptAuthTokens/refresh";

// Option callbacks an application leaves out.
function readNoInstructions() {}

function keepThreadEnvironment(environment) {
  return environment;
}

function prepareNoThreadResume() {}

function logNothing() {}

function reportNoObservationLoss() {}

function closeNothing() {}

function runDirectly(operation) {
  return operation();
}

/**
 * One account's connection to its native Codex app-server: the runtime it ensures, the client it opens, the
 * notifications it publishes and the server requests it routes. Its auth, turns, threads and inventories are
 * composed from their own modules; their operations are this provider's members.
 */
export class CodexAppServerAgentProvider {
  /**
   * @param {object} options The provider options: execution mode, account selection and the application's
   *   thread callbacks.
   * @param {object} host The native host: credentials, runtime, launch parameters, execution and configuration.
   */
  constructor(options, host) {
    this.host = host;
    this.credentials = host.credentials;
    this.configuration = {
      errorPrefix: "",
      clientInfo: { name: "jskit", title: "JSKIT", version: "0.1.0" },
      historyClientInfo: { name: "jskit-history-export", title: "JSKIT", version: "0.1.0" },
      controlEnvironmentPrefix: "JSKIT_",
      controlProbePrefix: "JSKIT_CONTROL_CHECK_",
      ...host.configuration
    };
    this.errorPrefix = this.configuration.errorPrefix;
    this.accountReader = createCodexAccountReader({ errorPrefix: this.errorPrefix, ...this.configuration.accountReader });
    this.modelCatalogError = (message) => codexAppServerModelCatalogError(message, this.errorPrefix);
    this.availabilityPromise = null;
    this.stale = false;
    this.options = options;
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.notificationSubscribers = new Set();
    this.settingsWaiters = new Set();
    this.initializeResult = null;
    this.runtime = null;
    this.runtimeStopOwner = null;
    this.runtimePromise = null;
    this.serverRequestHandler = null;
    this.threadRequestHandlers = new Map();

    const auth = createCodexProviderAuth({ provider: this });
    const turns = createCodexProviderTurns({ provider: this });
    const threads = createCodexProviderThreads({ provider: this });
    const inventories = createCodexProviderInventories({ provider: this });
    this.auth = auth;
    this.turns = turns;

    const {
      readInstructions = readNoInstructions,
      prepareThreadEnvironment = keepThreadEnvironment,
      prepareThreadParams = keepCodexThreadParams,
      prepareThreadResumeParams = prepareNoThreadResume,
      beforeResumeThread = resumeCodexThreadAsIs
    } = options;
    const { log = logNothing } = host;
    this.conversationRuntime = createCodexConversationAdapter({
      readInstructions: (params, threadId) => readInstructions(params, threadId),
      client: () => this.activeClient(),
      runtime: () => this.runtime,
      runRequest: (run, reason) => this.runRequest(run, reason),
      timeoutMs: options.threadControlTimeoutMs,
      environment: options.threadEnv,
      prepareEnvironment: (environment) => prepareThreadEnvironment(environment) || environment,
      prepareParameters: (params) => prepareThreadParams(params),
      prepareResume: (id, params, context) => prepareThreadResumeParams(id, params, context),
      beforeResume: (id) => beforeResumeThread(id),
      prepareHistory: (params, client, context) => this.withHistoryAdapter(params, client, context),
      threadParameters: codexAppServerThreadRequestParams,
      verifyEnvironment: turns.verifyThreadEnvironment,
      recordInterruption: turns.recordInterruption,
      onRecoveryFailure: turns.abandonControlProbe,
      publishGoal: (threadId, goal) => this.publishNotification({ method: "thread/goal/updated", params: { threadId, goal } }),
      log: (event, fields, context) => log(event, fields, { ...context, connectionGeneration: this.connectionGeneration })
    });

    this.selectedHelperAuth = auth.selectedHelperAuth;
    this.assertHelperAccountIdentityCurrent = auth.assertHelperAccountIdentityCurrent;
    this.authenticateHelperClient = auth.authenticateHelperClient;
    this.refreshHelperChatgptAuth = auth.refreshHelperChatgptAuth;
    this.preflightAuth = auth.preflightAuth;
    this.assertRuntimeAuthReady = auth.assertRuntimeAuthReady;
    this.markReconnectRequired = auth.markReconnectRequired;
    this.readPlanUsage = auth.readPlanUsage;

    this.sendTurn = turns.sendTurn;
    this.steerTurn = turns.steerTurn;
    this.interruptionOutcome = turns.interruptionOutcome;
    this.interruptTurn = turns.interruptTurn;
    this.nativeCliResumeCommand = turns.nativeCliResumeCommand;
    this.isControlProbeTurn = turns.isControlProbeTurn;
    this.stopThreadForObservationLoss = turns.stopThreadForObservationLoss;

    this.startThread = threads.startThread;
    this.resumeThread = threads.resumeThread;
    this.withHistoryAdapter = threads.withHistoryAdapter;
    this.withThreadEnvironment = threads.withThreadEnvironment;
    this.ensureThreadControls = threads.ensureThreadControls;
    this.readGoal = threads.readGoal;
    this.updateThreadSettings = threads.updateThreadSettings;
    this.setGoal = threads.setGoal;
    this.setGoalStatus = threads.setGoalStatus;
    this.clearGoal = threads.clearGoal;
    this.readThread = threads.readThread;
    this.readThreadStatus = threads.readThreadStatus;
    this.listThreadTurns = threads.listThreadTurns;
    this.exportThreadHistory = threads.exportThreadHistory;
    this.unsubscribeThread = threads.unsubscribeThread;
    this.deleteThread = threads.deleteThread;

    this.listLoadedThreads = inventories.listLoadedThreads;
    this.listAppServerThreadsForCwd = inventories.listAppServerThreadsForCwd;
    this.listThreadDescendants = inventories.listThreadDescendants;
    this.listNativeThreadsForCwd = inventories.listNativeThreadsForCwd;
    this.nativeThreadExists = inventories.nativeThreadExists;
    this.listHelperThreads = inventories.listHelperThreads;
    this.listModels = inventories.listModels;
    this.readConfig = inventories.readConfig;
    this.trustProject = inventories.trustProject;
    this.listHooks = inventories.listHooks;
    this.writeHookTrustState = inventories.writeHookTrustState;
  }

  get threadEnvironments() { return this.conversationRuntime.threadEnvironments; }

  get threadEnvironmentTasks() { return this.conversationRuntime.threadEnvironmentTasks; }

  isHelperProvider() {
    return codexAppServerIsHelper(this.options);
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  currentServerInfo() {
    return this.initializeResult;
  }

  isAvailable() {
    return Boolean(this.client?.isOpen() && this.runtime);
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Codex app-server observer must be a function.");
    }
    // Observation belongs to this provider, not one replaceable socket.
    this.notificationSubscribers.add(callback);
    return () => this.notificationSubscribers.delete(callback);
  }

  async handleServerRequest(request = {}, sourceClient = this.client) {
    if (
      this.isHelperProvider() &&
      request.method === CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD
    ) {
      return this.refreshHelperChatgptAuth(request.params);
    }
    if (this.isHelperProvider()) {
      const error = new Error("Codex isolated helper execution does not accept server requests.");
      error.code = -32601;
      throw error;
    }
    const threadHandler = request.method === "item/tool/call" && this.threadRequestHandlers.get(request.params?.threadId);
    if (threadHandler) {
      if (sourceClient !== this.client) {
        const error = new Error("This retired Codex connection does not authorize that native tool request.");
        error.code = -32601;
        throw error;
      }
      return threadHandler.handler(request);
    }
    if (this.serverRequestHandler) {
      return this.serverRequestHandler(request);
    }
    const error = new Error("Codex app-server request is not supported by this client.");
    error.code = -32601;
    throw error;
  }

  async ensureRuntime() {
    if (this.runtimePromise) {
      return this.runtimePromise;
    }
    const operation = this.prepareRuntime();
    this.runtimePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.runtimePromise === operation) {
        this.runtimePromise = null;
      }
    }
  }

  /**
   * An account change leaves a runtime that is still working on the
   * credentials it started with. Codex reads them once, so this provider
   * finishes its running turn on them and then stops; it never re-checks,
   * replaces or restarts its runtime, and never marks the new account invalid.
   */
  markStale() {
    this.stale = true;
  }

  staleRuntimeError() {
    return Object.assign(new Error("Codex (OpenAI) changed account. Send your message again."), {
      code: `${this.errorPrefix}codex_account_changed`, retryable: true, messageCode: "assistant.codex.accountChangedSendAgain", messageParams: {}
    });
  }

  async prepareRuntime() {
    if (this.stale) throw this.staleRuntimeError();
    const previousRuntime = this.runtime;
    const nextRuntime = await this.host.runtime.ensure(this.host.parameters);
    if (this.options.modelProviderId) nextRuntime.modelProviderId = this.options.modelProviderId;
    if (
      this.client &&
      previousRuntime &&
      codexAppServerRuntimeIdentity(previousRuntime) !== codexAppServerRuntimeIdentity(nextRuntime)
    ) {
      this.client.close();
      this.client = null;
      this.initializeResult = null;
    }
    this.runtime = nextRuntime;
    this.runtimeStopOwner = nextRuntime;
    await this.assertRuntimeAuthReady("codex-app-server-runtime");
    return this.runtime;
  }

  async runRequest(operation, reason = "codex-app-server-request") {
    try {
      await this.assertHelperAccountIdentityCurrent();
      const result = await operation();
      await this.assertHelperAccountIdentityCurrent();
      await this.assertRuntimeAuthReady(reason);
      return result;
    } catch (error) {
      if (this.isHelperProvider()) {
        throw codexAppServerHelperRequestError(error, reason, this.errorPrefix);
      }
      const observed = [
        error?.message || "",
        error?.observed || "",
        await tailTextFile(this.runtime?.logPath || "")
      ].filter(Boolean).join("\n");
      if (!this.stale && codexAuthOutputRequiresReconnect(observed)) {
        const runtime = this.runtime || {};
        if (runtime.runtimeDir) {
          await this.stopRuntimeAndRequireDrain(reason);
        }
        await this.markReconnectRequired({
          toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource,
          observed,
          reason
        });
      }
      throw error;
    }
  }

  async stopRuntimeAndRequireDrain(reason = "codex-app-server-stop") {
    const result = await this.stopRuntime({
      preserveProcessExitProof: !this.isHelperProvider()
    });
    if (
      result?.processExitVerified === true ||
      result?.runtimeDirRemoved === true ||
      result?.stopped === true
    ) {
      return result;
    }
    const error = new Error("Codex app-server execution could not be proven empty.");
    error.code = this.isHelperProvider()
      ? `${this.errorPrefix}codex_helper_runtime_cleanup_required`
      : `${this.errorPrefix}codex_app_server_cleanup_required`;
    error.cleanupRequired = true;
    error.reason = normalizeAgentText(reason);
    error.retryable = false;
    throw error;
  }

  async connect() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const operation = this.openConnection();
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) {
        this.connectPromise = null;
      }
    }
  }

  async openConnection() {
    if (this.client?.isOpen() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    const runtime = await this.ensureRuntime();
    if (this.client?.isOpen()) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime
      };
    }
    this.client?.close();
    this.client = null;
    this.initializeResult = null;
    const client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      onDisconnect: (error) => {
        if (this.client === client) {
          for (const reject of this.settingsWaiters) reject(error);
          this.failObservation(error);
        }
      },
      ...(this.isHelperProvider()
        ? { maxMessageBytes: CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES }
        : {}),
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    client.setRequestHandler((request) => this.handleServerRequest(request, client));
    let initializeResult = null;
    try {
      await client.connect();
      initializeResult = await this.runRequest(
        () => client.initialize({ clientInfo: this.configuration.clientInfo, ...this.options.initialize }),
        "codex-app-server-initialize"
      );
      await this.authenticateHelperClient(client, runtime);
    } catch (error) {
      client.close();
      if (!runtime.runtimeDir) {
        throw error;
      }
      const helper = this.isHelperProvider();
      const cleanup = await this.host.runtime.cleanupFailedStart(runtime.runtimeDir, {
        helper,
        executionId: runtime.executionId,
        pid: runtime.pid,
        processIdentity: runtime.processIdentity
      }, this.host.parameters);
      this.runtimeStopOwner = cleanup.processExitVerified === true
        ? {
          ...runtime,
          processExitVerifiedAt: new Date().toISOString(),
          processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
        }
        : runtime;
      this.runtime = null;
      if (helper) this.auth.blockHelper();
      if (cleanup.cleanupFailed) {
        const failure = new Error(
          helper
            ? "Codex isolated helper runtime could not be retired after startup failed."
            : "Codex app-server runtime could not be retired after initialization failed.",
          { cause: error }
        );
        failure.code = helper
          ? `${this.errorPrefix}codex_helper_runtime_cleanup_required`
          : `${this.errorPrefix}codex_app_server_cleanup_required`;
        failure.cleanupRequired = true;
        failure.retryable = false;
        throw failure;
      }
      throw error;
    }
    this.client = client;
    this.auth.resetPlanUsage();
    client.subscribe((notification = {}) => {
      if (this.client !== client || this.observationFailure) return;
      this.auth.observeAccountNotification(notification);
      this.publishNotification(notification);
    });
    this.initializeResult = normalizeCodexAppServerInfo(initializeResult);
    this.connectionGeneration += 1;
    return {
      initializeResult: this.isHelperProvider() ? this.initializeResult : initializeResult,
      runtime
    };
  }

  publishNotification(notification) {
    if (notification.method === "thread/goal/updated") {
      notification = { ...notification, params: { ...notification.params,
        goal: this.conversationRuntime.projectGoal(notification.params?.threadId, notification.params.goal) } };
    }
    if (!this.turns.observeNotification(notification)) return;
    for (const subscriber of this.notificationSubscribers) {
      try {
        subscriber(notification);
      } catch (error) {
        this.failObservation(error);
      }
    }
  }

  async currentRuntimeInfo() {
    const runtime = this.runtime || {};
    const executionMode = codexAppServerExecutionMode(this.options);
    const parameters = this.host.parameters;
    return Object.freeze({
      accountIdentitySignature: await this.credentials.identity(this.host.parameters, {
        includeInteractive: true
      }),
      authStateSignature: await this.credentials.generation(parameters),
      endpoint: normalizeAgentText(runtime.endpoint),
      executionMode,
      executionContextHash: normalizeAgentText(runtime.executionContextHash) ||
        normalizeAgentText(parameters.compatibility?.executionContextHash),
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      runtimeDir: normalizeAgentText(
        runtime.runtimeDir || parameters.runtimeDir
      ),
      runtimesHash: normalizeAgentText(runtime.runtimesHash) ||
        normalizeAgentText(parameters.compatibility?.runtimesHash),
      terminalEnvHash: normalizeAgentText(runtime.terminalEnvHash) ||
        codexAppServerTerminalEnvHash(this.isHelperProvider() ? {} : this.options.terminalEnv),
      toolHomeSource: executionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
        ? ""
        : normalizeAgentText(this.options.toolHomeSource),
      transport: normalizeAgentText(runtime.transport) || CODEX_APP_SERVER_TRANSPORT.UNIX
    });
  }

  async currentHelperExecutionContext() {
    const runtime = await this.ensureRuntime();
    const cwd = normalizeAgentText(this.options.helperWorkdir)
      ? path.resolve(this.options.helperWorkdir)
      : codexAppServerHelperWorkspaceDir(runtime.runtimeDir);
    if (!runtime.runtimeDir) {
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_runtime_invalid`,
        "Codex helper runtime isolation could not be verified."
      );
    }
    await ensureWritablePrivateDirectory(cwd);
    return Object.freeze({
      accountIdentitySignature: await this.credentials.identity(this.host.parameters, {
        includeInteractive: true
      }),
      cwd,
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    });
  }

  async activeClient() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen()) {
      return this.client;
    }
    await this.connect();
    return this.client;
  }

  async ensureAvailable({ modelProviderId = "" } = {}) {
    if (this.observationFailure) throw this.observationFailure;
    if (this.stale && !this.isAvailable()) throw this.staleRuntimeError();
    if (this.isAvailable()) {
      return {
        client: this.client,
        ok: true,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }
    const operation = (async () => {
      if (!this.isHelperProvider()) {
        await this.preflightAuth("codex-app-server-ensure-available", modelProviderId);
      }
      const client = await this.activeClient();
      return {
        client,
        ok: true,
        runtime: this.runtime
      };
    })();
    this.availabilityPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.availabilityPromise === operation) {
        this.availabilityPromise = null;
      }
    }
  }

  failObservation(cause) {
    const message = cause?.code === `${this.errorPrefix}agent_control_recovery_failed`
      ? cause.message
      : "Codex observation failed. Work must be stopped before it can continue.";
    this.observationFailure ||= Object.assign(
      new Error(message, { cause }),
      { code: `${this.errorPrefix}codex_observation_lost` }
    );
    const { onObservationLost = reportNoObservationLoss } = this.options;
    return onObservationLost(this.observationFailure);
  }

  setServerRequestHandler(callback) {
    const handler = typeof callback === "function" ? callback : null;
    this.serverRequestHandler = handler;
    const client = this.client;
    client?.setRequestHandler((request) => this.handleServerRequest(request, client));
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
        const client = this.client;
        client?.setRequestHandler((request) => this.handleServerRequest(request, client));
      }
    };
  }

  registerThreadRequestHandler(threadId, handler) {
    if (typeof threadId !== "string" || !threadId.trim() || typeof handler !== "function") {
      throw new TypeError("Codex tool dispatch requires its exact thread and handler.");
    }
    if (this.threadRequestHandlers.has(threadId)) throw new Error("This Codex thread already has an application tool owner.");
    const { runInContext = runDirectly } = this.options;
    const registration = { handler: request => runInContext(() => handler(request)) };
    this.threadRequestHandlers.set(threadId, registration);
    const client = this.client;
    client?.setRequestHandler(request => this.handleServerRequest(request, client));
    return Object.freeze({
      isCurrent: () => this.threadRequestHandlers.get(threadId) === registration,
      release: () => {
        if (this.threadRequestHandlers.get(threadId) === registration) this.threadRequestHandlers.delete(threadId);
      }
    });
  }

  close() {
    const { onClose = closeNothing } = this.options;
    onClose();
    for (const reject of this.settingsWaiters) reject(Object.assign(new Error("The assistant connection closed before confirming its settings."), {
      messageCode: "assistant.codex.connectionClosedBeforeSettings", messageParams: {}
    }));
    this.settingsWaiters.clear();
    this.conversationRuntime.close();
    this.turns.clear();
    this.auth.resetPlanUsage();
    this.notificationSubscribers.clear();
    this.threadRequestHandlers.clear();
    this.client?.close();
    this.client = null;
    this.initializeResult = null;
    this.auth.forgetHelper();
  }

  async stopRuntime({
      expectedAccountIdentitySignature = "",
      preserveProcessExitProof = false
    } = {}) {
    this.close();
    this.runtimeStopOwner = this.runtime || this.runtimeStopOwner;
    const runtime = this.runtimeStopOwner || {};
    const result = await this.host.runtime.stop({
      ...this.host.parameters,
      expectedAccountIdentitySignature,
      ownedRuntime: runtime,
      preserveProcessExitProof,
      runtimeDir: runtime.runtimeDir || this.options.runtimeDir
    });
    if (result.processExitVerified === true && this.runtimeStopOwner === runtime) {
      this.runtimeStopOwner = {
        ...runtime,
        processExitVerifiedAt: runtime.processExitVerifiedAt || new Date().toISOString(),
        processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      };
    }
    if (this.runtime === runtime) {
      this.runtime = null;
    }
    return result;
  }
}
