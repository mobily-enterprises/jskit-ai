import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createLocalConversationExecution } from "../localExecution.js";
import { openCodeServerForDirectory } from "../openCodeNativeSession.js";
import { retireOpenCodeConversationHistory } from "../openCodeNativeHistory.js";
import { recoverWithoutProjection } from "../openCodeTurn.js";
import { createOpenCodeToolBridge } from "../openCodeTools.js";
import { validateConversationConfiguration } from "../configuration.js";
import { createScopedConversationHandle } from "./scoped.js";
import { executeOpenCodeApplicationTool, openStandaloneOpenCodeConversation } from "./opencodeStandalone.js";

/** A command whose caller records no delivery timing for the native receipt. */
function ignoreNativeReceipt() {}

/** A command whose caller records no delivery timing for the persisted receipt. */
function ignoreReceiptPersisted() {}

/**
 * Uses the application's authorized API connection; native state stays server-side.
 * @param {{
 *   connections?: { resolve(request: { context: object, integrationId: string }): Promise<object> },
 *   host?: {
 *     env?: import("@jskit-ai/kernel/server/types").RuntimeEnv,
 *     workdir?: string,
 *     stateDirectory?: string,
 *     execution?: import("../localExecution.js").ConversationExecution,
 *     nativeTools?: boolean,
 *     conversation?: Function,
 *     opencode?: Function,
 *     commands?: { opencode?: string },
 *     limits?: object,
 *     commandWrapper?: object
 *   },
 *   limits?: Record<string, number>
 * }} options
 */
export function createOpenCodeConversationDriver({
  connections,
  // readable-check: allow dependency-default - data: a runtime without host settings runs OpenCode in its working directory with local execution
  host = {},
  limits = {}
}) {
  // readable-check: allow method-probe - input validation: a host that does not open its own conversations requires the application's AI connection resolver
  if (!host.conversation && typeof connections?.resolve !== "function") throw new TypeError("OpenCode conversations require an authorized AI connection resolver.");
  const workdir = path.resolve(host.workdir || process.cwd());
  const stateDirectory = path.resolve(host.stateDirectory || path.join(workdir, ".assistant", "native", "opencode"));
  const execution = host.execution || createLocalConversationExecution();
  const nativeTools = host.nativeTools === true;
  if (nativeTools && !host.env) {
    throw new TypeError("createOpenCodeConversationDriver requires the application's environment, such as process.env, for native tools.");
  }
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  if (!Number.isSafeInteger(maximumOutput) || maximumOutput < 1) throw new TypeError("Invalid OpenCode output limit.");
  if (limits.maxOutputTokens !== undefined && (!Number.isSafeInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 1)) {
    throw new TypeError("Invalid OpenCode token limit.");
  }
  function withNativeStorageTarget({ native, context }, operation) {
    const prepared = native.preparation.storage(context);
    return native.owner.withStorageProcess(async () =>
      native.owner.startPreparedProcess(await prepared.process()), operation, prepared.failure);
  }

  async function disposeNative({ native, options }) {
    const prepared = native.preparation.cleanup(options);
    return native.owner.closeSession(prepared.sessionId, prepared.options, prepared.application);
  }

  function validateConfiguration(configuration) {
    validateConversationConfiguration(configuration, { engine: "OpenCode", connections, connectionRequired: true,
      structuredOutput: true, maxOutputCharacters: maximumOutput });
  }

  async function readState({ conversation, context, representation }) {
    const { owner, preparation } = conversation.native;
    const nativeResult = await owner.readSessionState(context, preparation.state);
    return conversation.read(context, representation, nativeResult);
  }

  function inspectTemporaryActivity({ native }) {
    return native.owner.hasActiveTemporaryConversation(native.sessionId);
  }

  function releaseRenewalPredecessorProcessExitProof({ native }) {
    return native.owner.releaseRenewalPredecessorProcessExitProof(native.preparation);
  }

  function releaseRenewalSuccessorProcessExitProof({ native }) {
    return native.owner.releaseProcessExitProof(native.preparation.sessionId);
  }

  async function generateRenewalHandover({ native, input, context }) {
    return native.owner.runPreparedRenewalTurn(await native.preparation.handover(input, context));
  }

  async function seedRenewalHandover({ native, input, context }) {
    return native.owner.runPreparedRenewalTurn(await native.preparation.seed(input, context));
  }

  async function ensureConversation({ native, context }) {
    return native.owner.ensurePreparedSessionReadiness(await native.preparation.readiness(context));
  }

  async function interruptDetachedConversation({ native, input, context }) {
    return native.owner.stopPreparedConversation(await native.preparation.existing(input, context), input);
  }

  async function deleteDetachedConversation({ native, input, context }) {
    const prepared = await native.preparation.existing(input, context, { operation: "delete" });
    return native.owner.deletePreparedConversation(prepared, input);
  }

  function listConversationStorage(prepared) {
    const { binding, context } = prepared;
    return withNativeStorageTarget(prepared, async target =>
      (await target.server.client.listConversationsForDirectory(binding.workdir, { signal: context.signal }))
        .map((row) => ({ ...binding, conversationId: row.id })));
  }

  function retireConversationHistory(prepared) {
    return withNativeStorageTarget(prepared, target => {
      // Native status is scoped to the saved project instance, not the control server.
      const client = openCodeServerForDirectory(target.server, prepared.binding.workdir).client;
      return retireOpenCodeConversationHistory(target.server.client, client, prepared.binding, prepared.context);
    });
  }

  function closeProject({ native, input }) {
    return native.owner.closeProject(input, native.preparation.projectCleanup());
  }

  function invalidateRuntimes({ native, input }) {
    return native.owner.invalidateRuntimes(input, native.preparation);
  }

  function reconcileSessions({ native, sessions, options }) {
    return native.owner.reconcileSessions(sessions, options, native.preparation);
  }

  async function createConversation({ native, input, context }) {
    return native.owner.createPreparedConversation(await native.preparation.creation(input, context));
  }

  async function runDetachedConversation({ native, input, options }) {
    return native.owner.runPreparedConversationTurn(await native.preparation.turn(input, options));
  }

  async function createBinding() {
    const directory = path.join(stateDirectory, randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return { sessionId: "", workdir: await realpath(workdir), directory, executionId: "", processDirectory: "" };
  }

  async function open({ binding, writeBinding, onFailure: reportFailure, conversation }) {
    if (conversation?.native?.scoped) {
      const supplied = conversation.native;
      const { owner, preparation } = supplied;
      const { conversationId, context: openingContext } = supplied.scoped;
      return createScopedConversationHandle({ conversationId,
        sendNative: async (input, context) => owner.runPreparedConversationTurn(await preparation.turn(input, context)),
        readNative: async (input, context) => owner.readPreparedConversation(await preparation.existing(input, context), input),
        waitNative: async (input, context) => owner.waitPreparedConversationTurn(await preparation.existing(input, context), input),
        cancel: async (input, context) => owner.stopPreparedConversation(await preparation.existing(input, context), input),
        deleteConversation: async (input, context) => owner.deletePreparedConversation(
          await preparation.existing(input, context, { operation: "delete" }), input),
        disposeOpening: () => disposeNative({ native: supplied, options: openingContext })
      });
    }
    if (conversation?.native) {
      const supplied = conversation.native;
      let current;
      let disposed = false;
      let cleanupFailure;
      let toolBridge;
      async function interrupt(context) {
        try {
          const acquired = await supplied.acquire(context || current?.context);
          const value = await supplied.owner.interruptPreparedTurn(await supplied.preparation.interruption(acquired.options));
          if (toolBridge) { await toolBridge.close(); toolBridge = null; }
          if (cleanupFailure) {
            await reportFailure(cleanupFailure, { recovered: true });
            cleanupFailure = null;
          }
          return value;
        } catch (error) {
          error.cleanupFailed = true;
          cleanupFailure = error;
          current?.failure.reject(error);
          await reportFailure(error);
          throw error;
        }
      }
      async function send(command) {
        const {
          input,
          context,
          signal,
          beforeDispatch,
          accept,
          onNativeReceipt = ignoreNativeReceipt,
          onReceiptPersisted = ignoreReceiptPersisted
        } = command;
        signal.throwIfAborted();
        const acquired = await supplied.acquire(context);
        const active = current;
        if (active?.tools) signal.throwIfAborted();
        if (active?.tools && !toolBridge) {
          toolBridge = await createOpenCodeToolBridge({ schemas: active.tools.schemas,
            maxArgumentBytes: active.tools.maximumArgumentBytes, execute(input, signal) {
              const turn = supplied.owner.turns.get(acquired.key);
              const target = supplied.owner.processes.get(acquired.key);
              const execute = () => executeOpenCodeApplicationTool({ active: current, turn, target,
                sessionId: target?.upstreamSessionId,
                assertCurrent(throwFailure = true, authored) {
                  const owned = !disposed && current === active && active.turn === turn && turn?.active &&
                    (!authored || active.messageIds.get(turn.inputMessageId) === authored) &&
                    supplied.owner.turns.get(acquired.key) === turn && supplied.owner.processes.get(acquired.key) === target;
                  if (!owned && throwFailure) throw new Error("This OpenCode tool call belongs to a retired native turn.");
                  return owned;
                }
              }, input, signal);
              // readable-check: allow method-probe - optional operation: an acquisition that runs inside its request's context supplies runInContext
              return typeof acquired.runInContext === "function" ? acquired.runInContext(execute) : execute();
            }
          });
        }
        const options = active?.tools ? { ...acquired.options, applicationTools: toolBridge.configuration } : acquired.options;
        let prepared;
        const dispatch = active?.tools ? async identity => {
          await beforeDispatch(identity);
          signal.throwIfAborted();
          active.turn = supplied.owner.turns.get(acquired.key);
          active.messageIds.set(prepared.input.id, { messageId: input.messageId, committed: command.deliveryCommitted });
        } : beforeDispatch;
        prepared = await supplied.preparation.message({ ...input.nativeMessage, onPromptSending: dispatch }, options);
        if (prepared.application?.commit) {
          const application = prepared.application;
          prepared.application = { ...application, async commit(admitted) {
            onNativeReceipt();
            const result = await application.commit(admitted);
            onReceiptPersisted();
            return result;
          } };
        }
        if (active?.tools && prepared.application?.monitor) {
          const monitor = prepared.application.monitor;
          const create = monitor.create;
          prepared.application = { ...prepared.application, monitor: { ...monitor,
            create(...args) {
              const projection = create(...args);
              const finalResponse = projection.finalResponse;
              return { ...projection, finalResponse: { ...finalResponse,
                async beforeRecovery(completion) {
                  active.messageIds.set(finalResponse.recoveryMessageId, active.messageIds.get(completion.inputMessageId));
                  const { beforeRecovery = recoverWithoutProjection } = finalResponse;
                  await beforeRecovery(completion);
                }
              } };
            }
          } };
        }
        const value = await supplied.owner.sendPreparedMessage(prepared, options);
        const delivered = { value, completion: value.conversationTurn ? supplied.owner.monitors.get(acquired.key) : null };
        if (value.delivered === true && value.conversationTurn) {
          if (current) current.delivery = delivered;
          await accept({ nativeResult: { value }, conversationTurn: value.conversationTurn, nativeTurnId: value.turn?.id });
        } else if (active?.tools) active.messageIds.delete(prepared.input.id);
        return delivered;
      }
      return Object.freeze({
        publishNative: event => conversation.publish(event),
        async inspectAdmission({ context, representation, ...input }) {
          const acquired = await supplied.acquire(context);
          const result = await supplied.owner.inspectPreparedMessage(await supplied.preparation.inspection(input, acquired.options));
          return representation === "native" ? result : { accepted: result.admission === "accepted" };
        },
        async run(command) {
          if (disposed || current) throw new Error("This OpenCode conversation is closed or already working.");
          const active = { context: command.context, failure: Promise.withResolvers(),
            ...(command.tools ? { tools: command.tools, messageIds: new Map() } : {}) };
          let failure;
          active.failure.promise.catch(error => { failure = error; });
          current = active;
          let cancellation;
          const abort = () => {
            cancellation ||= interrupt(command.context).then(() => { throw command.signal.reason; });
            cancellation.catch(active.failure.reject);
          };
          command.signal.addEventListener("abort", abort, { once: true });
          try {
            let delivered;
            let dispatchFailure;
            try { delivered = await send(command); }
            catch (error) { dispatchFailure = error; }
            for (;;) {
              const settling = active.delivery;
              let result;
              let problem = dispatchFailure || failure;
              if (!problem && settling?.completion) {
                try { result = await Promise.race([settling.completion, active.failure.promise]); }
                catch (error) { problem = error; }
              }
              if (command.finishIfCurrent && !await command.finishIfCurrent(() => active.delivery === settling)) {
                // The original sender admitted another invocation and returned
                // its exact monitor. Keep the same completion and Stop owner.
                continue;
              }
              problem = dispatchFailure || failure || problem;
              if (!problem && result?.error) {
                // readable-check: allow patched-error - data: status is the native turn's state, not an HTTP status
                problem = Object.assign(new Error(result.error), { status: result.status });
                if (result.active && result.status === "observation_lost") {
                  problem.cleanupFailed = true;
                  cleanupFailure = problem;
                  await reportFailure(problem);
                }
              }
              if (problem) throw problem;
              return { value: delivered.value };
            }
          } finally {
            command.signal.removeEventListener("abort", abort);
            await cancellation?.catch(() => {});
            if (toolBridge) { await toolBridge.close(); toolBridge = null; }
            if (current === active) current = null;
          }
        },
        async steer(command) { return { value: (await send(command)).value }; },
        async cancel({ context, representation } = {}) {
          const value = await interrupt(context);
          return representation === "native" ? { value } : value;
        },
        async dispose(options) {
          try {
            const result = await disposeNative({ native: supplied, options });
            if (result?.ok === false) throw Object.assign(new Error(result.error || "OpenCode cleanup could not be confirmed."), result);
            if (toolBridge) { await toolBridge.close(); toolBridge = null; }
            disposed = true;
            return result;
          } catch (error) {
            error.cleanupFailed = true;
            current?.failure.reject(error);
            throw error;
          }
        }
      });
    }
    return openStandaloneOpenCodeConversation({
      connections,
      host,
      limits,
      workdir,
      stateDirectory,
      execution,
      nativeTools,
      maximumOutput
    }, { binding, writeBinding, reportFailure });
  }

  return Object.freeze({
    toolDiscovery: true,
    attachmentTypes: ["text", "image", "localFile"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, history: true,
      instructions: true, configuration: true, steering: true, goals: false, attachments: true, tools: true, nativeTools, structuredOutput: true }),
    validateConfiguration,
    readState,
    inspectTemporaryActivity,
    releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof,
    generateRenewalHandover,
    seedRenewalHandover,
    ensureConversation,
    disposeNative,
    interruptDetachedConversation,
    deleteDetachedConversation,
    listConversationStorage,
    retireConversationHistory,
    closeProject,
    invalidateRuntimes,
    reconcileSessions,
    createConversation,
    runDetachedConversation,
    createBinding,
    open
  });
}
