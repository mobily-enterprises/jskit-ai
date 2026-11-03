import { createCodexAccountReader } from "./codexAccountReader.js";
import { codexAppServerIsHelper } from "./codexProcess.js";
import { codexAppServerModelCatalogError } from "./codexModelCatalog.js";
import { createCodexConversationAdapter } from "./providers/codex.js";
import { codexAppServerThreadRequestParams } from "./codexProviderThreads.js";
import * as providerAuth from "./codexProviderAuth.js";
import * as providerConnection from "./codexProviderConnection.js";
import * as providerThreads from "./codexProviderThreads.js";
import * as providerInventories from "./codexProviderInventories.js";
import * as providerTurns from "./codexProviderTurns.js";

export class CodexAppServerAgentProvider {
  // readable-check: allow dependency-default - input validation: a provider built without a native host description has an empty one
  constructor(options = {}, host = {}) {
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
    this.planUsage = null;
    this.planUsagePending = null;
    this.planUsageAuthGeneration = 0;
    this.availabilityPromise = null;
    this.stale = false;
    this.options = options;
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.notificationSubscribers = new Set();
    this.settingsWaiters = new Set();
    this.helperAuth = null;
    this.helperAuthBlocked = false;
    this.initializeResult = null;
    this.runtime = null;
    this.runtimeStopOwner = null;
    this.runtimePromise = null;
    this.serverRequestHandler = null;
    this.threadRequestHandlers = new Map();
    this.conversationRuntime = createCodexConversationAdapter({
      // readable-check: allow optional-call - optional operation: only a driver conversation's provider supplies developer instructions
      readInstructions: (params, threadId) => this.options.readInstructions?.(params, threadId),
      client: () => this.activeClient(),
      runtime: () => this.runtime,
      runRequest: (run, reason) => this.runRequest(run, reason),
      timeoutMs: options.threadControlTimeoutMs,
      environment: options.threadEnv,
      // readable-check: allow optional-call - optional operation: only a driver conversation's provider prepares its thread environment
      prepareEnvironment: (environment) => this.options.prepareThreadEnvironment?.(environment) || environment,
      // readable-check: allow optional-call - optional operation: an application may adjust new thread parameters through its provider options
      prepareParameters: (params) => this.options.prepareThreadParams?.(params),
      // readable-check: allow optional-call - optional operation: only owner and driver providers prepare a thread resume
      prepareResume: (id, params, context) => this.options.prepareThreadResumeParams?.(id, params, context),
      // readable-check: allow optional-call - optional operation: only owner and driver providers check a thread before resuming it
      beforeResume: (id) => this.options.beforeResumeThread?.(id),
      prepareHistory: (params, client, context) => this.withHistoryAdapter(params, client, context),
      threadParameters: codexAppServerThreadRequestParams,
      verifyEnvironment: (...args) => providerThreads.verifyThreadEnvironment(this, ...args),
      recordInterruption: (threadId, turnId) => {
        const key = JSON.stringify([threadId, turnId]);
        this.interruptedTurns.set(key, this.interruptedTurns.get(key) || "control_reconfiguration");
      },
      onRecoveryFailure: (id) => {
        const probe = this.threadControlProbes.get(id);
        if (probe && !probe.verified) {
          this.threadControlProbes.delete(id);
          for (const pending of probe.pending) this.publishNotification(pending);
        }
      },
      publishGoal: (threadId, goal) => this.publishNotification({ method: "thread/goal/updated", params: { threadId, goal } }),
      // readable-check: allow optional-call - optional operation: a native host may supply a log, and the driver's host has none
      log: (event, fields, context) => host.log?.(event, fields, {
        ...context, connectionGeneration: this.connectionGeneration
      })
    });
    this.threadControlProbes = new Map();
    this.commandExecutions = new Map();
    this.interruptedTurns = new Map();
    this.commandStopFailure = null;
  }

  get threadEnvironments() { return this.conversationRuntime.threadEnvironments; }

  get threadEnvironmentTasks() { return this.conversationRuntime.threadEnvironmentTasks; }

  isHelperProvider() {
    return codexAppServerIsHelper(this.options);
  }

  selectedHelperAuth() {
    return providerAuth.selectedHelperAuth(this);
  }

  assertHelperAccountIdentityCurrent() {
    return providerAuth.assertHelperAccountIdentityCurrent(this);
  }

  authenticateHelperClient(client, runtime) {
    return providerAuth.authenticateHelperClient(this, client, runtime);
  }

  refreshHelperChatgptAuth(params) {
    return providerAuth.refreshHelperChatgptAuth(this, params);
  }

  handleServerRequest(request, sourceClient) {
    return providerAuth.handleServerRequest(this, request, sourceClient);
  }

  ensureRuntime() {
    return providerConnection.ensureRuntime(this);
  }

  markStale() {
    return providerConnection.markStale(this);
  }

  staleRuntimeError() {
    return providerConnection.staleRuntimeError(this);
  }

  prepareRuntime() {
    return providerConnection.prepareRuntime(this);
  }

  preflightAuth(reason, modelProviderId) {
    return providerAuth.preflightAuth(this, reason, modelProviderId);
  }

  assertRuntimeAuthReady(reason) {
    return providerAuth.assertRuntimeAuthReady(this, reason);
  }

  markReconnectRequired(options) {
    return providerAuth.markReconnectRequired(this, options);
  }

  runRequest(operation, reason) {
    return providerConnection.runRequest(this, operation, reason);
  }

  stopRuntimeAndRequireDrain(reason) {
    return providerConnection.stopRuntimeAndRequireDrain(this, reason);
  }

  connect() {
    return providerConnection.connect(this);
  }

  openConnection() {
    return providerConnection.openConnection(this);
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  publishNotification(notification) {
    return providerConnection.publishNotification(this, notification);
  }

  currentServerInfo() {
    return this.initializeResult;
  }

  isControlProbeTurn(threadId, turnId) {
    const probe = this.threadControlProbes.get(threadId);
    return Boolean(turnId && probe?.verified && probe.turnId === turnId);
  }

  currentRuntimeInfo() {
    return providerConnection.currentRuntimeInfo(this);
  }

  currentHelperExecutionContext() {
    return providerConnection.currentHelperExecutionContext(this);
  }

  isAvailable() {
    return Boolean(this.client?.isOpen() && this.runtime);
  }

  activeClient() {
    return providerConnection.activeClient(this);
  }

  ensureAvailable(options) {
    return providerConnection.ensureAvailable(this, options);
  }

  readPlanUsage() {
    return providerConnection.readPlanUsage(this);
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Codex app-server observer must be a function.");
    }
    // Observation belongs to this provider, not one replaceable socket.
    this.notificationSubscribers.add(callback);
    return () => this.notificationSubscribers.delete(callback);
  }

  failObservation(cause) {
    return providerConnection.failObservation(this, cause);
  }

  stopThreadForObservationLoss(threadId, turnId) {
    return providerConnection.stopThreadForObservationLoss(this, threadId, turnId);
  }

  setServerRequestHandler(callback) {
    return providerConnection.setServerRequestHandler(this, callback);
  }

  registerThreadRequestHandler(threadId, handler) {
    return providerConnection.registerThreadRequestHandler(this, threadId, handler);
  }

  startThread(options) {
    return providerThreads.startThread(this, options);
  }

  resumeThread(threadId, options) {
    return providerThreads.resumeThread(this, threadId, options);
  }

  withHistoryAdapter(params, client, options) {
    return providerThreads.withHistoryAdapter(this, params, client, options);
  }

  withThreadEnvironment(threadId, params, operation) {
    return providerThreads.withThreadEnvironment(this, threadId, params, operation);
  }

  ensureThreadControls(threadId) {
    return providerThreads.ensureThreadControls(this, threadId);
  }

  readGoal(threadId, options) {
    return providerThreads.readGoal(this, threadId, options);
  }

  updateThreadSettings(threadId, options, options2) {
    return providerThreads.updateThreadSettings(this, threadId, options, options2);
  }

  setGoal(threadId, options, options2) {
    return providerThreads.setGoal(this, threadId, options, options2);
  }

  setGoalStatus(threadId, status, options) {
    return providerThreads.setGoalStatus(this, threadId, status, options);
  }

  clearGoal(threadId, options) {
    return providerThreads.clearGoal(this, threadId, options);
  }

  readThread(threadId) {
    return providerThreads.readThread(this, threadId);
  }

  readThreadStatus(threadId) {
    return providerThreads.readThreadStatus(this, threadId);
  }

  listThreadTurns(threadId, params) {
    return providerThreads.listThreadTurns(this, threadId, params);
  }

  exportThreadHistory(threadId, onRecord, options) {
    return providerThreads.exportThreadHistory(this, threadId, onRecord, options);
  }

  listLoadedThreads(params) {
    return providerInventories.listLoadedThreads(this, params);
  }

  listAppServerThreadsForCwd(options) {
    return providerInventories.listAppServerThreadsForCwd(this, options);
  }

  listThreadDescendants(threadId) {
    return providerInventories.listThreadDescendants(this, threadId);
  }

  listNativeThreadsForCwd(cwd) {
    return providerInventories.listNativeThreadsForCwd(this, cwd);
  }

  nativeThreadExists(threadId, options) {
    return providerInventories.nativeThreadExists(this, threadId, options);
  }

  listHelperThreads(options) {
    return providerInventories.listHelperThreads(this, options);
  }

  listModels(params, options) {
    return providerInventories.listModels(this, params, options);
  }

  readConfig(params) {
    return providerInventories.readConfig(this, params);
  }

  trustProject(cwd) {
    return providerInventories.trustProject(this, cwd);
  }

  listHooks(cwds) {
    return providerInventories.listHooks(this, cwds);
  }

  writeHookTrustState(state) {
    return providerInventories.writeHookTrustState(this, state);
  }

  unsubscribeThread(threadId) {
    return providerThreads.unsubscribeThread(this, threadId);
  }

  deleteThread(threadId) {
    return providerThreads.deleteThread(this, threadId);
  }

  sendTurn(threadId, input, params, options) {
    return providerTurns.sendTurn(this, threadId, input, params, options);
  }

  steerTurn(threadId, turnId, input, params, options) {
    return providerTurns.steerTurn(this, threadId, turnId, input, params, options);
  }

  interruptionOutcome(threadId, turnId) {
    return providerTurns.interruptionOutcome(this, threadId, turnId);
  }

  interruptTurn(threadId, turnId, options) {
    return providerTurns.interruptTurn(this, threadId, turnId, options);
  }

  nativeCliResumeCommand(threadId) {
    return providerTurns.nativeCliResumeCommand(this, threadId);
  }

  close() {
    return providerConnection.close(this);
  }

  stopRuntime(options) {
    return providerConnection.stopRuntime(this, options);
  }
}

