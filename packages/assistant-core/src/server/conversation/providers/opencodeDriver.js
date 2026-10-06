import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createLocalConversationExecution } from "../localExecution.js";
import { createOpenCodeConversationServer, openCodeConversationAgent } from "../openCodeProcess.js";
import { createOpenCodeSharedRuntime, ensureOpenCodeSession, openCodeServerForDirectory } from "../openCodeRuntime.js";
import { openCodeAssistantMessageText, retireOpenCodeConversationHistory } from "../openCodeClient.js";
import { inspectOpenCodeMessageAdmission, observeOpenCodeEvents, openCodeRowsForInput,
  openCodeDetachedPrompt, openCodeStructuredOutput } from "../openCodeTurn.js";
import { createOpenCodeToolBridge } from "../openCodeTools.js";
import { validateConversationConfiguration, validateConnectionModel } from "../configuration.js";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nativeMessageId = id => `msg_jskit_${hash(id).slice(0, 40)}`;

/** Uses the application's authorized API connection; native state stays server-side. */
export function createOpenCodeConversationDriver({ connections, host = {}, limits = {} } = {}) {
  if (!host.conversation && typeof connections?.resolve !== "function") throw new TypeError("OpenCode conversations require an authorized AI connection resolver.");
  const workdir = path.resolve(host.workdir || process.cwd());
  const stateDirectory = path.resolve(host.stateDirectory || path.join(workdir, ".assistant", "native", "opencode"));
  const execution = host.execution || createLocalConversationExecution();
  const nativeTools = host.nativeTools === true;
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  if (!Number.isSafeInteger(maximumOutput) || maximumOutput < 1) throw new TypeError("Invalid OpenCode output limit.");
  if (limits.maxOutputTokens !== undefined && (!Number.isSafeInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 1)) {
    throw new TypeError("Invalid OpenCode token limit.");
  }
  function prompt(input, configuration) {
    const text = `${input.text || ""}${input.attachmentManifest || ""}`;
    if (!configuration.outputSchema) return { text, content: input.content };
    const prepared = openCodeDetachedPrompt({ prompt: text, outputSchema: configuration.outputSchema });
    if (prepared.length > (limits.maxInputCharacters ?? 32_000)) throw new Error("OpenCode structured input exceeded the configured limit.");
    return { text: prepared, content: input.content };
  }

  async function nativeStorageTarget({ native, context }) {
    const prepared = native.preparation.storage(context);
    return native.owner.ensure(null, async () =>
      native.owner.startPreparedProcess(await prepared.process())).catch(prepared.failure);
  }

  async function disposeNative({ native, options }) {
    const prepared = native.preparation.cleanup(options);
    return native.owner.closeSession(prepared.sessionId, prepared.options, prepared.application);
  }

  return Object.freeze({
    toolDiscovery: true,
    attachmentTypes: ["text", "image", "localFile"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, history: true,
      instructions: true, configuration: true, steering: true, goals: false, attachments: true, tools: true, nativeTools, structuredOutput: true }),
    validateConfiguration(configuration) {
      validateConversationConfiguration(configuration, { engine: "OpenCode", connections, connectionRequired: true,
        structuredOutput: true, maxOutputCharacters: maximumOutput });
    },
    async readState({ conversation, context, representation }) {
      const { owner, preparation } = conversation.native;
      const nativeResult = await owner.readSessionState(context, preparation.state);
      return conversation.read(context, representation, nativeResult);
    },
    inspectTemporaryActivity({ native }) {
      return native.owner.hasActiveTemporaryConversation(native.sessionId);
    },
    releaseRenewalPredecessorProcessExitProof({ native }) {
      return native.owner.releaseRenewalPredecessorProcessExitProof(native.preparation);
    },
    releaseRenewalSuccessorProcessExitProof({ native }) {
      return native.owner.releaseProcessExitProof(native.preparation.sessionId);
    },
    async generateRenewalHandover({ native, input, context }) {
      return native.owner.runPreparedRenewalTurn(await native.preparation.handover(input, context));
    },
    async seedRenewalHandover({ native, input, context }) {
      return native.owner.runPreparedRenewalTurn(await native.preparation.seed(input, context));
    },
    async ensureConversation({ native, context }) {
      return native.owner.ensurePreparedSessionReadiness(await native.preparation.readiness(context));
    },
    disposeNative,
    async interruptDetachedConversation({ native, input, context }) {
      return native.owner.stopPreparedConversation(await native.preparation.existing(input, context), input);
    },
    async deleteDetachedConversation({ native, input, context }) {
      const prepared = await native.preparation.existing(input, context, { operation: "delete" });
      return native.owner.deletePreparedConversation(prepared, input);
    },
    async listConversationStorage(prepared) {
      const target = await nativeStorageTarget(prepared);
      const { binding, context } = prepared;
      return (await target.server.client.listConversationsForDirectory(binding.workdir, { signal: context.signal }))
        .map((row) => ({ ...binding, conversationId: row.id }));
    },
    async retireConversationHistory(prepared) {
      const target = await nativeStorageTarget(prepared);
      // Native status is scoped to the saved project instance, not the control server.
      const client = openCodeServerForDirectory(target.server, prepared.binding.workdir).client;
      return retireOpenCodeConversationHistory(target.server.client, client, prepared.binding, prepared.context);
    },
    closeProject({ native, input }) {
      return native.owner.closeProject(input, native.preparation.projectCleanup());
    },
    invalidateRuntimes({ native, input }) {
      return native.owner.invalidateRuntimes(input, native.preparation);
    },
    reconcileSessions({ native, sessions, options }) {
      return native.owner.reconcileSessions(sessions, options, native.preparation);
    },
    async createConversation({ native, input, context }) {
      return native.owner.createPreparedConversation(await native.preparation.creation(input, context));
    },
    async createBinding() {
      const directory = path.join(stateDirectory, randomUUID());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return { sessionId: "", workdir: await realpath(workdir), directory, executionId: "", processDirectory: "" };
    },
    async open({ binding, writeBinding, onFailure: reportFailure, conversation }) {
      if (conversation?.native?.scoped) {
        const supplied = conversation.native;
        const { owner, preparation } = supplied;
        const { conversationId, context: openingContext } = supplied.scoped;
        const inputFor = (input = {}) => {
          if (input.conversationId && String(input.conversationId).trim() !== conversationId) {
            throw new TypeError("This operation belongs to a different scoped conversation.");
          }
          return { ...input, conversationId };
        };
        const unsupported = () => { throw Object.assign(new Error("This original scoped conversation has no canonical message or goal receipt."), {
          code: "conversation_unsupported"
        }); };
        return Object.freeze({
          capabilities: Object.freeze({ streaming: false, instructions: false, configuration: false,
            goals: false, goalBudgets: false, goalCommands: Object.freeze({}), attachments: false, tools: false, nativeTools: false }),
          async sendNative({ input, context }) {
            return owner.runPreparedConversationTurn(await preparation.turn(inputFor(input), context));
          },
          async readNative({ input, context }) {
            const request = inputFor(input);
            return owner.readPreparedConversation(await preparation.existing(request, context), request);
          },
          async waitNative({ input, context }) {
            const request = inputFor(input);
            return owner.waitPreparedConversationTurn(await preparation.existing(request, context), request);
          },
          async cancel({ input, context }) {
            const request = inputFor(input);
            return owner.stopPreparedConversation(await preparation.existing(request, context), request);
          },
          readGoal: unsupported, updateGoal: unsupported, inspectAdmission: unsupported,
          async dispose(options) {
            if (options) {
              const request = inputFor(options.input);
              const prepared = await preparation.existing(request, options.context, { operation: "delete" });
              return owner.deletePreparedConversation(prepared, request);
            }
            const result = await disposeNative({ native: supplied, options: openingContext });
            if (result?.ok === false) throw Object.assign(new Error(result.error || "Scoped cleanup could not be confirmed."), result);
            return result;
          }
        });
      }
      if (conversation?.native) {
        const supplied = conversation.native;
        let current;
        let disposed = false;
        let cleanupFailure;
        async function interrupt(context) {
          try {
            const acquired = await supplied.acquire(context || current?.context);
            const value = await supplied.owner.interruptPreparedTurn(await supplied.preparation.interruption(acquired.options));
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
        async function send({ input, context, signal, beforeDispatch, accept }) {
          signal.throwIfAborted();
          const acquired = await supplied.acquire(context);
          const prepared = await supplied.preparation.message({ ...input.nativeMessage, onPromptSending: beforeDispatch }, acquired.options);
          const value = await supplied.owner.sendPreparedMessage(prepared, acquired.options);
          const delivered = { value, completion: value.conversationTurn ? supplied.owner.monitors.get(acquired.key) : null };
          if (value.delivered === true && value.conversationTurn) {
            if (current) current.delivery = delivered;
            await accept({ nativeResult: { value }, conversationTurn: value.conversationTurn, nativeTurnId: value.turn?.id });
          }
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
            const active = { context: command.context, failure: Promise.withResolvers() };
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
      if (!binding || typeof binding.sessionId !== "string" || binding.workdir !== await realpath(workdir) ||
          path.dirname(binding.directory || "") !== stateDirectory) {
        throw new Error("This OpenCode conversation belongs to another working directory or native state directory. Restore its original host configuration.");
      }
      let native;
      let toolBridge;
      let facilities;
      let processVariants = {};
      let current;
      let stopping;
      let disposed = false;
      async function updateBinding(patch) {
        const next = { ...binding, ...patch };
        await writeBinding(next);
        binding = next;
      }
      async function stopRecordedExecution() {
        const proof = await execution.stop(binding.executionId);
        if (!proof?.scopeEmpty) throw new Error("OpenCode process cleanup could not be confirmed. Restore its execution host before continuing.");
        if (binding.processDirectory) {
          if (path.dirname(binding.processDirectory) !== (binding.runtimeDirectory || stateDirectory) || !path.basename(binding.processDirectory).startsWith("process-")) {
            throw new Error("OpenCode's private process directory does not belong to this host.");
          }
          await rm(binding.processDirectory, { recursive: true, force: true });
        }
        await updateBinding({ executionId: "", processDirectory: "" });
      }
      async function stop() {
        if (stopping) return stopping;
        stopping = (async () => {
          await toolBridge?.close();
          toolBridge = null;
          if (facilities?.runtime.cleanupPending) {
            await facilities.runtime.stop("opencode-startup-cleanup");
            await updateBinding({ executionId: "", processDirectory: "" });
          }
          if (native) {
            await facilities.runtime.releaseTarget(native, {
              onRemoved: () => facilities.runtime.writeBindings(facilities.registryPath, binding.directory, [])
            });
            facilities.runtime.turns.delete(binding.directory);
            await updateBinding({ executionId: "", processDirectory: "" });
            native = null;
          } else if (binding.executionId && facilities && !host.opencode &&
              !facilities.runtime.current && !facilities.runtime.processStarts.size) {
            // Only our unfinished standalone startup belongs to this handle.
            // A saved shared-server reference is not authority to stop a peer's
            // service before this conversation has acquired its owner.
            await stopRecordedExecution();
          }
          if (current?.finished) current = null;
        })().catch(error => {
          error.cleanupFailed = true;
          if (error.code === "assistant_opencode_stop_unverified") {
            error.message = "OpenCode process cleanup could not be confirmed. Restore its execution host before continuing.";
          }
          throw error;
        }).finally(() => { stopping = null; });
        return stopping;
      }
      async function resolvePreparation(configuration, context, signal) {
        const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
        signal.throwIfAborted();
        validateConnectionModel(configuration, connection);
        const identity = hash([connection.providerId, connection.baseURL || "", connection.apiKey]);
        if (binding.accountIdentity && identity !== binding.accountIdentity) {
          throw new Error("This conversation belongs to another OpenCode account. Restore that connection or start a new conversation.");
        }
        if (!binding.accountIdentity) await updateBinding({ accountIdentity: identity });
        const model = { providerID: connection.providerId, id: connection.model };
        const agent = openCodeConversationAgent({ nativeTools, tools: Boolean(current?.tools) });
        if (current) current.agent = agent;
        if (binding.sessionId && !binding.databasePath) {
          throw new Error("This OpenCode conversation uses the earlier private native history layout. Run the offline native-history upgrade before continuing; no history was changed.");
        }
        if (!facilities) {
          if (host.opencode) facilities = await host.opencode({ connection, context });
          else {
            const runtimeDirectory = path.join(stateDirectory, "shared", hash([identity, host.commands?.opencode || "opencode"]));
            const selected = { modelProviderId: connection.providerId, canonicalUrl: connection.baseURL || "",
              endpointCode: connection.sdkPackage || "", fingerprint: identity };
            facilities = { runtime: createOpenCodeSharedRuntime({ scope: runtimeDirectory }), runtimeDirectory,
              registryPath: path.join(runtimeDirectory, "session-environments.json"),
              databasePath: path.join(runtimeDirectory, "opencode.db"), selected,
              async start({ signal, connection }) {
                if (binding.executionId && !facilities.runtime.processes.has(binding.directory)) await stopRecordedExecution();
                const starting = new AbortController();
                const abortUnusedStartup = () => {
                  if (facilities.runtime.processStarts.size === 1 && facilities.runtime.processes.size === 0) starting.abort(signal.reason);
                };
                signal.addEventListener("abort", abortUnusedStartup, { once: true });
                if (signal.aborted) abortUnusedStartup();
                try {
                  const server = await createOpenCodeConversationServer({ command: host.commands?.opencode || "opencode",
                    execution, env: host.env || process.env, workdir: binding.workdir, stateDirectory: runtimeDirectory,
                    databasePath: facilities.databasePath, sessionEnvironmentRegistry: facilities.registryPath, connection,
                    maxOutputTokens: limits.maxOutputTokens, executionLimits: host.limits, signal: starting.signal,
                    onStarted: (executionId, processDirectory) => updateBinding({ executionId, processDirectory }),
                    async onFailure(error) {
                      for (const target of facilities.runtime.processes.values()) target.abortController.abort(error);
                      try { await facilities.runtime.stop("opencode-process-exited"); }
                      catch (cleanupError) { await reportFailure(cleanupError); }
                    }
                  });
                  return { server, connections: [selected] };
                } finally { signal.removeEventListener("abort", abortUnusedStartup); }
              }
            };
          }
          if (binding.databasePath && binding.databasePath !== facilities.databasePath) {
            throw new Error("This OpenCode conversation belongs to another native history store. Restore its original host configuration.");
          }
          await updateBinding({ databasePath: facilities.databasePath, runtimeDirectory: facilities.runtimeDirectory });
        }
        if (!toolBridge && current?.tools) {
          toolBridge = await createOpenCodeToolBridge({
            schemas: current.tools.schemas, maxArgumentBytes: current.tools.maximumArgumentBytes,
            async execute(input, signal) {
              const active = current;
              if (!active?.tools || input.sessionId !== binding.sessionId ||
                  [input.id, input.name, input.messageId].some(value => typeof value !== "string" || !value || value.length > 256)) {
                throw new Error("This OpenCode tool call does not belong to the active conversation.");
              }
              const turn = facilities.runtime.turns.get(binding.directory);
              if (!turn?.abortController) {
                throw new Error("This OpenCode tool call does not belong to an admitted conversation.");
              }
              const observed = AbortSignal.any([signal, turn.abortController.signal]);
              await turn.admission?.promise;
              observed.throwIfAborted();
              const messages = await native.server.client.messages(binding.sessionId, { limit: 100 }, { signal: observed });
              let message;
              let owner;
              for (const [nativeId, authored] of active.messageIds) {
                message = openCodeRowsForInput(messages, nativeId).find(message => message.id === input.messageId && message.type === "assistant");
                if (message) { owner = authored; break; }
              }
              const tool = message?.content.find(part => part.type === "tool" && part.callID === input.id);
              if (!tool || tool.tool !== input.name || !isDeepStrictEqual(tool.state?.input, input.input)) {
                throw new Error("OpenCode's application call does not match an admitted native tool use.");
              }
              if (!owner.committed) throw new Error("This OpenCode tool call has no durable authored admission.");
              await owner.committed;
              observed.throwIfAborted();
              try {
                return await active.tools.execute({ id: input.id, name: input.name, arguments: JSON.stringify(input.input) }, { signal: observed, messageId: owner.messageId });
              } catch (error) {
                turn.abortController.abort(error);
                throw error;
              }
            }
          });
        }
        return { configuration, signal, model, agent, connection };
      }

      async function prepare({ configuration, signal, model, agent, connection }) {
        try {
          const start = host.opencode
            ? async () => facilities.runtime.startPreparedProcess(await facilities.prepareServer())
            : () => facilities.start({ signal, connection });
          if (!native) {
            native = await facilities.runtime.acquire(binding.directory, async () => {
              const shared = await facilities.runtime.ensure(facilities.selected, start);
              return { key: binding.directory, workdir: binding.workdir, upstreamSessionId: binding.sessionId,
                abortController: new AbortController(), server: openCodeServerForDirectory(shared.server, binding.workdir) };
            });
          } else await facilities.runtime.ensure(facilities.selected, start);
          signal.throwIfAborted();
          await updateBinding({ executionId: native.server.executionId, processDirectory: native.server.privateRoot || "" });
          const catalogue = await native.server.client.providers({ signal });
          const selected = catalogue.all.find(provider => provider.id === connection.providerId)?.models?.[connection.model];
          if (selected?.id !== connection.model) throw new Error("OpenCode could not load the configured model definition. Check the selected integration before sending.");
          processVariants = selected.variants || {};
        } catch (error) {
          if (error.stopProof?.scopeEmpty) await updateBinding({ executionId: "", processDirectory: "" });
          throw error;
        }
        if (configuration.effort) {
          if (!Object.hasOwn(processVariants, configuration.effort)) throw new Error("The selected OpenCode model does not support this reasoning effort.");
          model.variant = configuration.effort;
        }
        const retainedId = binding.sessionId;
        if (retainedId && (await native.server.client.sessionStatus(retainedId, { signal })).type !== "idle") {
          throw new Error("The native OpenCode conversation is still working. Stop or inspect it before sending another message.");
        }
        const session = {
          selection: { agentId: agent, modelId: model.id, modelProviderId: model.providerID, variantId: model.variant || "" },
          model, workdir: binding.workdir, signal,
          invalidIdentity: () => new Error("OpenCode did not acknowledge a native conversation."),
          identity: {
            async write(nativeId) {
              if (retainedId && nativeId !== retainedId) throw new Error("The saved OpenCode conversation is unavailable. Restore its native history before continuing.");
              if (binding.sessionId !== nativeId) await updateBinding({ sessionId: nativeId });
            },
            publish(nativeId) {
              return facilities.runtime.writeBindings(facilities.registryPath, binding.directory, [{
                upstreamSessionId: nativeId, workdir: binding.workdir, modelProviderId: connection.providerId,
                ...(nativeTools ? { env: host.env || process.env } : {}),
                conversation: { systemPrompt: configuration.systemPrompt, nativeTools,
                  commandWrapper: host.commandWrapper, tools: current?.tools ? toolBridge?.configuration : undefined }
              }]);
            }
          }
        };
        return { target: native, session, model };
      }

      function messageMonitor(active, command) {
        return {
          prepare() { return { fields: {} }; },
          create(target, turn, _metadata, options) {
            const abort = () => turn.abortController.abort(command.signal.reason);
            command.signal.addEventListener("abort", abort, { once: true });
            if (command.signal.aborted) abort();
            const recoveryMessageId = nativeMessageId(`${command.input.messageId}:final-response`);
            return {
              observe(_turn, signal) {
                return observeOpenCodeEvents(target.server.client, target.upstreamSessionId, {
                  abortController: turn.abortController, signal, eventStartedAt: turn.eventStartedAt,
                  async onEvent(summary, event) {
                    if (summary.type === "session.status") {
                      const status = event.data.properties?.status?.type;
                      if (status === "retry" || status === "busy") {
                        await turn.admission?.promise;
                        await active.deliveryCommitted;
                        signal.throwIfAborted();
                        await active.onEvent({ type: "phase", phase: status === "retry" ? "retrying" : "working" });
                      }
                    }
                  }
                });
              },
              eventReady: options.eventReady,
              readiness: { timeoutMs: limits.admissionTimeoutMs || 120_000,
                timeoutError: new Error("OpenCode's event connection was not ready before the admission deadline.") },
              finalResponse: {
                agent: active.agent, model: active.prepared.model, recoveryMessageId,
                beforeRecovery() {
                  active.messageIds.set(recoveryMessageId, active.messageIds.get(turn.inputMessageId));
                }
              },
              async writeRun(observed, state) {
                if (state === "active") await active.onEvent({ type: "phase", phase: observed.phase || "working" });
              },
              async projectMessages(messages, { inputMessageId }) {
                await active.deliveryCommitted;
                if (inputMessageId !== turn.inputMessageId) return { failure: "", providerApiFailure: false };
                return facilities.runtime.projectConversationMessages(messages, inputMessageId, {
                  maximumOutput, outputSchema: active.configuration.outputSchema,
                  previous: active.previous, onMessage: active.onMessage
                });
              },
              completeResult(_turn, { failure }) { return failure; },
              onRetired() { command.signal.removeEventListener("abort", abort); }
            };
          },
          onError(error) { active.failure ||= error; }
        };
      }

      async function send(command) {
        const active = current;
        const id = nativeMessageId(command.input.messageId);
        const previousOwner = active.messageIds.get(id);
        let accepted = false;
        let value;
        try {
          value = await facilities.runtime.sendMessage(binding.directory, {
            id, threadId: binding.sessionId, workdir: binding.workdir
          }, { promptTimeoutMs: limits.admissionTimeoutMs || 30_000 }, {
            async writeRun() {},
            async prepare({ overwrite }) {
              const signal = active.prepared
                ? AbortSignal.any([command.signal, AbortSignal.timeout(120_000)])
                : active.resolved.signal;
              if (overwrite || !active.prepared) active.prepared = await prepare({ ...active.resolved, signal });
              return { ...active.prepared, session: { ...active.prepared.session, signal } };
            },
            prompt() {
              native.abortController.signal.throwIfAborted();
              return {
                agent: active.agent, model: active.prepared.model,
                prompt: prompt(command.input, active.configuration), attachments: command.input.localFiles,
                authorizeAttachments: true,
                async beforeDispatch(threadId) {
                  await command.beforeDispatch({ threadId });
                  command.signal.throwIfAborted();
                  active.messageIds.set(id, {
                    messageId: command.input.messageId, committed: command.deliveryCommitted
                  });
                }
              };
            },
            async commit() {
              await command.accept();
              active.deliveryCommitted = command.deliveryCommitted;
              accepted = true;
            },
            monitor: messageMonitor(active, command)
          });
          if (value.failure) throw value.failure.error;
          if (!value.delivered) throw new Error("OpenCode did not acknowledge the message.");
        } catch (error) {
          const turn = facilities.runtime.turns.get(binding.directory);
          const attempted = value?.failure ? value.failure.attempted : turn?.promptAttempted === true;
          if (attempted && !accepted && !(error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408)) {
            error.delivery = "uncertain";
            turn?.abortController?.abort(error);
            // Join the same owner's recovery before releasing its process target.
            await facilities.runtime.monitors.get(binding.directory);
          } else if (previousOwner) active.messageIds.set(id, previousOwner);
          else active.messageIds.delete(id);
          if (turn?.active && turn.observationError) error.cleanupFailed = true;
          throw error;
        }
        active.delivery = { turn: facilities.runtime.turns.get(binding.directory),
          completion: facilities.runtime.monitors.get(binding.directory) };
        return value;
      }

      return Object.freeze({
        async inspectAdmission({ messageId, configuration, context }) {
          if (!binding.sessionId) return { accepted: false, messages: [] };
          const prepared = await prepare(await resolvePreparation(configuration, context, AbortSignal.timeout(120_000)));
          await ensureOpenCodeSession(prepared.target, prepared.session);
          const id = nativeMessageId(messageId);
          const { accepted = false, messages = [] } = await inspectOpenCodeMessageAdmission(native.server.client, binding.sessionId, id) || {};
          return { accepted,
            messages: openCodeRowsForInput(messages, id).filter(message => message.type === "assistant" && !message.summary)
              .map(message => ({ id: message.id, outputId: `${message.id}:assistant`, role: "assistant",
                text: configuration.outputSchema ? openCodeStructuredOutput(openCodeAssistantMessageText(message)) : openCodeAssistantMessageText(message) })) };
        },
        steer(command) {
          if (!current || current.finished) throw new Error("OpenCode has no active turn to steer.");
          return send(command);
        },
        async run(command) {
          if (disposed || current) throw new Error("This OpenCode conversation is closed or already working.");
          const active = current = { tools: command.tools, configuration: command.configuration,
            onMessage: command.onMessage, onEvent: command.onEvent, messageIds: new Map(), previous: new Map() };
          let problem;
          try {
            active.resolved = await resolvePreparation(command.configuration, command.context,
              AbortSignal.any([command.signal, AbortSignal.timeout(120_000)]));
            let dispatchFailure;
            try { await send(command); }
            catch (error) { dispatchFailure = error; }
            for (;;) {
              const settling = active.delivery;
              let result;
              let failure = dispatchFailure || active.failure;
              if (!failure && settling?.completion) {
                try { result = await settling.completion; }
                catch (error) { failure = error; }
              } else if (!failure && settling) result = facilities.runtime.turnSnapshot(settling.turn, binding.sessionId);
              if (command.finishIfCurrent && !await command.finishIfCurrent(() => active.delivery === settling)) continue;
              failure = dispatchFailure || active.failure || failure;
              if (!failure && result?.error) {
                failure = Object.assign(new Error(result.error), { status: result.status });
                if (result.active && result.status === "observation_lost") failure.cleanupFailed = true;
              }
              if (failure) throw failure;
              break;
            }
          } catch (error) {
            problem = error.cleanupFailed ? error : command.signal.aborted ? command.signal.reason : error;
            if (problem.cleanupFailed) problem.message = "OpenCode process cleanup could not be confirmed. Restore its execution host before continuing.";
          }
          active.finished = true;
          try { if (!problem?.cleanupFailed && (problem || command.signal.aborted)) await stop(); }
          catch (error) { problem = error; }
          finally { await toolBridge?.whenIdle(); if (!problem?.cleanupFailed) current = null; }
          if (problem) throw problem;
        },
        cancel: stop,
        async dispose() { await stop(); disposed = true; }
      });
    }
  });
}
