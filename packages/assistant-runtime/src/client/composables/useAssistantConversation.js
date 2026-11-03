import { computed, effectScope, getCurrentInstance, getCurrentScope, inject, onScopeDispose, proxyRefs, ref, shallowRef, toValue, watch } from "vue";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { retainAssistantConversation } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { createAssistantTextSubmission } from "@jskit-ai/assistant-core/client/conversation";
import { assistantHttpClient, createAssistantApi } from "@jskit-ai/assistant-core/client";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { useSurfaceRouteContext } from "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext";
import { resolveAssistantRuntimeRoute, resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { useWorkspaceWebScopeSupport } from "../support/workspaceScopeSupport.js";
import { failureMessage } from "../support/conversationFailures.js";
import { useJskitText } from "../i18n.js";
import { authoredRequest, createConversationRuntime, isQuestionConfiguration, resolveWorkingPolicy, text } from "./conversationRuntime.js";

/** @typedef {import("@jskit-ai/assistant-core/client/types").AssistantApi} AssistantApi */
/** @typedef {import("vue").MaybeRefOrGetter<string>} TextOption */

/**
 * The application defaults `configureAssistantConversations` provides to every binding.
 * @typedef {object} ConversationDefaults
 * @property {import("vue").MaybeRefOrGetter<string | undefined>} actorKey
 * @property {AssistantApi | null | undefined} api
 * @property {(path: string, options: object) => Promise<any>} request
 * @property {"dispatch" | "accepted"} clearDraftOn
 */

/**
 * An application command whose assistant returns one final result: the bounded task mode of a binding.
 * @typedef {object} BoundedTask
 * @property {{ run: (request: { path: string, payload: object }) => Promise<any>, isRunning: import("vue").MaybeRefOrGetter<boolean> }} command
 * @property {TextOption} endpoint
 * @property {import("vue").MaybeRefOrGetter<unknown>} scope The application scope a result belongs to.
 * @property {(messages: object[]) => object} input
 * @property {(response: any) => object} result
 * @property {(response: any, submitted: { message: object, scope: unknown }) => void} [onResult]
 */

/**
 * What `useAssistantConversation` and `useAssistantConversationFactory` accept; the assistant conversation guide
 * describes each option.
 * @typedef {object} ConversationBindingOptions
 * @property {TextOption} [conversationId]
 * @property {TextOption} [endpoint]
 * @property {TextOption} [surfaceId]
 * @property {TextOption} [hostSurfaceId]
 * @property {import("vue").MaybeRefOrGetter<string | undefined>} [workspaceSlug]
 * @property {import("vue").MaybeRefOrGetter<string | undefined>} [actorKey]
 * @property {AssistantApi | null} [api]
 * @property {import("../types.js").RealtimeSocket} [socket]
 * @property {import("vue").MaybeRefOrGetter<boolean>} [active]
 * @property {(event: object) => unknown} [onEvent]
 * @property {"dispatch" | "accepted"} [clearDraftOn]
 * @property {boolean} [queueWhileSending]
 * @property {boolean | ((snapshot: any) => boolean)} [deferWhileWorking]
 * @property {boolean | ((snapshot: any) => boolean)} [admitWhileWorking]
 * @property {boolean} [draftWhileLoading]
 * @property {import("vue").MaybeRefOrGetter<{ storage: Storage, key: string } | null | undefined>} [draftStorage]
 * @property {((runtime: import("../types.js").ConversationRuntime) => unknown) | null} [application]
 * @property {BoundedTask | null} [boundedTask]
 * @property {import("vue").MaybeRefOrGetter<unknown>} [data]
 * @property {import("vue").MaybeRefOrGetter<import("@jskit-ai/assistant-core/client/types").AssistantAttachments | null | undefined>} [attachments]
 * @property {import("vue").MaybeRefOrGetter<import("@jskit-ai/assistant-core/client/types").AssistantSuggestions | null | undefined>} [suggestions]
 * @property {import("vue").MaybeRefOrGetter<import("@jskit-ai/assistant-core/client/types").AssistantModelChoices | null | undefined>} [models]
 * @property {import("vue").MaybeRefOrGetter<boolean | object | null | undefined>} [questions]
 * @property {import("vue").MaybeRefOrGetter<boolean | object | null | undefined>} [goal]
 * @property {import("vue").MaybeRefOrGetter<Record<string, any> | undefined>} [presentation]
 */

/**
 * What a binding takes from the application's setup. A bounded task takes only the application.
 * @typedef {object} ConversationBindingSetup
 * @property {import("vue").App} app
 * @property {ConversationDefaults} defaults
 * @property {import("../types.js").SurfaceRouteContext} [routeContext]
 * @property {import("../types.js").PlacementRuntime} [placement]
 * @property {import("../types.js").WorkspaceScopeSupport} [workspaceScope]
 * @property {import("../types.js").RealtimeSocket} [socket]
 * @property {Record<string, any>} [config]
 */

const { t } = useJskitText();
/**
 * A conversation snapshot's error, which names its runtime sentence with errorMessageCode.
 * @param {any} state
 */
const stateError = state => failureMessage({ message: state?.error,
  messageCode: state?.errorMessageCode, messageParams: state?.errorMessageParams });
// Keep the injection key stable across optimized package and raw Vue imports.
const conversationDefaultsKey = Symbol.for("jskit.assistant-runtime.conversation.defaults");

/**
 * An application that configures nothing: the placement user, the standard API, and Send clears the draft.
 * @type {ConversationDefaults}
 */
const NO_CONVERSATION_DEFAULTS = Object.freeze({
  actorKey: undefined,
  api: undefined,
  request: assistantHttpClient.request,
  clearDraftOn: "dispatch"
});

/** A submission with no further lifetime guard of its own. */
function alwaysCurrent() {
  return true;
}
/** A submission that shows no pending state of its own. */
function ignoreSubmit() {}
/** A submission whose acceptance needs no further cleanup. */
function ignoreAcceptance() {}
/** A bounded task result the application does not present itself. */
function ignoreResult() {}

/**
 * Configure this Vue application's existing conversation binding before mounting.
 * @param {import("vue").App} app
 * @param {{ actorKey?: import("vue").MaybeRefOrGetter<string | undefined>, api?: AssistantApi,
 *   request?: (path: string, options: object) => Promise<any>, clearDraftOn?: "dispatch" | "accepted" }} [defaults]
 */
function configureAssistantConversations(app, { actorKey, api, request = assistantHttpClient.request, clearDraftOn = "dispatch" } = {}) {
  // readable-check: allow method-probe - input validation: an application hands configureAssistantConversations its Vue application
  if (typeof app?.provide !== "function") throw new TypeError("Conversation defaults require a Vue application.");
  // readable-check: allow method-probe - input validation: an application may hand configureAssistantConversations its own request
  if (typeof request !== "function") throw new TypeError("Conversation request must be a function.");
  if (!["dispatch", "accepted"].includes(clearDraftOn)) throw new TypeError("clearDraftOn must be dispatch or accepted.");
  app.provide(conversationDefaultsKey, Object.freeze({ actorKey, api, request, clearDraftOn }));
}

function questionsAnswered(prompts) {
  return prompts.questions.every(question => String(prompts.answers[question.name] || "").trim());
}

/**
 * Whether a question owner formats the draft as its answers.
 * @param {any} prompts The conversation's own question form, an application's question owner, or none.
 */
function formatsAnswers(prompts) {
  // readable-check: allow method-probe - optional operation: an application's own question owner may have no capture, and then the draft is sent as typed
  return typeof prompts?.capture === "function";
}

/**
 * Original bounded-command history belongs to this mounted view. It has no canonical delivery receipt, retained server
 * conversation or live subscription.
 * @param {BoundedTask} boundedTask
 * @param {{ active: import("vue").MaybeRefOrGetter<boolean>, data: import("vue").MaybeRefOrGetter<unknown>,
 *   presentation: import("vue").MaybeRefOrGetter<Record<string, any> | undefined> }} view
 */
function useBoundedTask({ command, endpoint, scope, input, result, onResult = ignoreResult }, { active, data, presentation }) {
  // readable-check: allow method-probe - input validation: an application hands the binding its bounded task
  if (typeof command?.run !== "function" || !("isRunning" in command) ||
      typeof input !== "function" || typeof result !== "function") {
    throw new TypeError("boundedTask requires its command and input/result mappings.");
  }
  if (endpoint === undefined || scope === undefined) throw new TypeError("boundedTask requires its endpoint and application scope.");
  // readable-check: allow method-probe - input validation: an application hands the binding its bounded task
  if (typeof onResult !== "function") throw new TypeError("boundedTask.onResult must be a function.");
  const draft = ref("");
  const messages = ref([]);
  const busy = computed(() => toValue(command.isRunning) === true);
  let disposed = false;
  onScopeDispose(() => { disposed = true; });

  async function submit() {
    const content = draft.value.trim();
    if (!content || busy.value || toValue(active) === false) return;
    const capturedScope = toValue(scope);
    const message = { ...toValue(data), content, role: "user" };
    messages.value.push(message);
    draft.value = "";
    const response = await command.run({ path: toValue(endpoint), payload: input(messages.value) });
    if (!response || disposed || toValue(scope) !== capturedScope) return;
    messages.value.push(result(response));
    onResult(response, { message, scope: capturedScope });
  }

  const runtime = shallowRef({
    draft,
    messages,
    submit,
    clearHistory() { messages.value = []; }
  });
  const adapter = computed(() => {
    const display = toValue(presentation) || {};
    return {
      conversation: {
        turns: conversationTurnsFromMessages(messages.value.map(message => ({ ...message, text: message.content }))),
        assistantLabel: display.assistantLabel || t("jskit.assistant.runtime.conversation.assistantLabel"), welcomeMessage: display.welcomeMessage,
        visible: display.visible, retainWhenHidden: display.retainWhenHidden, variant: display.variant, scrollKey: toValue(scope)
      },
      composer: {
        draft: draft.value, disabled: busy.value, pending: busy.value,
        canSend: toValue(active) !== false && !busy.value && Boolean(draft.value.trim()),
        submitOnEnter: display.submitOnEnter ?? false, submitOnModifierEnter: display.submitOnModifierEnter ?? true,
        placeholder: display.placeholder, ariaLabel: display.ariaLabel, submitAriaLabel: display.submitAriaLabel
      },
      actions: { setDraft(value) { draft.value = value; }, submit }
    };
  });
  return { runtime, adapter, error: computed(() => "") };
}

/**
 * What a binding takes from the application's setup: the shell's route, placement and socket, and the application's
 * conversation defaults.
 * @param {{ socket?: import("../types.js").RealtimeSocket, boundedTask?: BoundedTask | null }} options
 * @returns {ConversationBindingSetup}
 */
function conversationBindingSetup({ socket, boundedTask }) {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) throw new Error("Conversation binding must be acquired from the application setup.");
  if (boundedTask != null) return { app, defaults: NO_CONVERSATION_DEFAULTS };
  const routeContext = useSurfaceRouteContext();
  /** @type {import("../types.js").PlacementRuntime} */
  const placement = inject(SHELL_WEB_PLACEMENT_RUNTIME_KEY);
  // readable-check: allow required-collaborators - safety invariant: a binding outside the shell would otherwise fail only once a conversation is targeted
  if (!placement) throw new Error("Conversation binding requires the application's placement runtime.");
  return {
    app,
    defaults: inject(conversationDefaultsKey, NO_CONVERSATION_DEFAULTS),
    routeContext,
    placement,
    workspaceScope: useWorkspaceWebScopeSupport(),
    socket: socket || useRealtimeSocket({ required: true }),
    config: getClientAppConfig()
  };
}

/**
 * One view's binding to a retained conversation, or to a bounded task.
 * @param {ConversationBindingOptions} options
 * @param {ConversationBindingSetup} [setup] The factory's setup, captured once in the application's setup.
 */
function createConversationBinding({ conversationId, endpoint = "", surfaceId = "", hostSurfaceId = "", workspaceSlug,
  actorKey: suppliedActorKey, api: suppliedApi, socket: suppliedSocket, active = true, onEvent,
  clearDraftOn: suppliedClearDraftOn, queueWhileSending, deferWhileWorking = false, admitWhileWorking = false, draftWhileLoading = false,
  draftStorage, application, boundedTask,
  data, attachments, suggestions, models, questions, goal, presentation }, setup) {
  const { app, routeContext, placement, workspaceScope, socket: setupSocket, config, defaults } = setup ||
    conversationBindingSetup({ socket: suppliedSocket, boundedTask });
  const clearDraftOn = suppliedClearDraftOn ?? defaults.clearDraftOn;
  const actorKey = computed(() => {
    const actor = toValue(suppliedActorKey);
    return actor === undefined ? toValue(defaults.actorKey) : actor;
  });
  if (!["dispatch", "accepted"].includes(clearDraftOn)) throw new TypeError("clearDraftOn must be dispatch or accepted.");
  if (queueWhileSending !== undefined && typeof queueWhileSending !== "boolean") throw new TypeError("queueWhileSending must be a boolean.");
  if (!["boolean", "function"].includes(typeof deferWhileWorking)) throw new TypeError("deferWhileWorking must be a boolean.");
  if (!["boolean", "function"].includes(typeof admitWhileWorking)) throw new TypeError("admitWhileWorking must be a boolean.");
  resolveWorkingPolicy(null, { deferWhileWorking, admitWhileWorking });
  if (typeof draftWhileLoading !== "boolean") throw new TypeError("draftWhileLoading must be a boolean.");
  // readable-check: allow method-probe - input validation: an application may hand the binding a factory for its own runtime extension
  if (application != null && typeof application !== "function") throw new TypeError("application must be a factory.");
  if (boundedTask != null) return useBoundedTask(boundedTask, { active, data, presentation });
  const socket = suppliedSocket || setupSocket;
  const runtime = shallowRef(null);
  const initialDraft = ref("");
  const attachmentOwner = computed(() => {
    const owner = toValue(attachments);
    return owner ? proxyRefs(owner) : null;
  });
  const suggestionOwner = computed(() => {
    const owner = toValue(suggestions);
    return owner ? proxyRefs(owner) : null;
  });
  const modelOwner = computed(() => {
    const owner = toValue(models);
    return owner ? proxyRefs(owner) : null;
  });
  const questionOwner = computed(() => {
    const option = toValue(questions);
    const owner = isQuestionConfiguration(option) ? runtime.value?.questions : option;
    return owner ? proxyRefs(owner) : null;
  });
  const identity = computed(() => {
    const host = (text(hostSurfaceId) || text(routeContext.currentSurfaceId)).toLowerCase();
    const target = (text(surfaceId) || host).toLowerCase();
    const surface = resolveAssistantSurfaceConfig(config, target);
    const route = resolveAssistantRuntimeRoute(surface, toValue(workspaceSlug) === undefined
      ? workspaceScope.readRouteScope(routeContext).workspaceSlug : text(workspaceSlug));
    const actor = toValue(actorKey);
    return Object.freeze({ conversationId: text(conversationId), targetSurfaceId: target, hostSurfaceId: host || target,
      workspaceSlug: route.workspaceSlug, configured: route.configured,
      actorKey: actor === undefined ? String(routeContext.placementContext.value?.user?.id || "") : text(actor),
      endpoint: text(endpoint) || route.endpoint });
  });
  // The original composer owns input before a conversation ID is available.
  // It is scoped to the real actor/surface/workspace, never a placeholder ID.
  const draftScope = computed(() => {
    const scope = identity.value;
    return JSON.stringify([scope.actorKey, scope.endpoint, scope.targetSurfaceId,
      scope.hostSurfaceId, scope.workspaceSlug, scope.configured]);
  });
  const canDraftWhileLoading = computed(() => draftWhileLoading && identity.value.configured &&
    Boolean(identity.value.actorKey && identity.value.targetSurfaceId) && toValue(active) !== false);
  watch(draftScope, () => { initialDraft.value = ""; }, { flush: "sync" });
  let retained;
  watch(() => JSON.stringify(identity.value), () => {
    retained?.release();
    retained = null;
    runtime.value = null;
    const target = identity.value;
    if (!target.configured || !target.conversationId || !target.actorKey || !target.targetSurfaceId) return;
    const key = JSON.stringify(["assistant", target.actorKey, target.endpoint, target.targetSurfaceId,
      target.hostSurfaceId, target.workspaceSlug, target.conversationId]);
    retained = retainAssistantConversation(app, key, (readers, retain) => createConversationRuntime({
      identity: target, readers, retain, socket, actorKey, placement, queueWhileSending, deferWhileWorking, admitWhileWorking,
      draftStorage, application, goalReadEnabled: toValue(goal) === true,
      api: suppliedApi ?? defaults.api ?? createAssistantApi({ request: defaults.request,
        resolveBasePath: () => target.endpoint, resolveSurfaceId: () => target.hostSurfaceId })
    }), { active, questions, goal, onEvent });
    runtime.value = retained.runtime;
  }, { immediate: true, flush: "sync" });
  watch(() => runtime.value?.editable.value && runtime.value, current => {
    if (!draftWhileLoading || !current || !initialDraft.value) return;
    const value = initialDraft.value;
    if (!current.draft.value.trim()) current.draft.value = value;
    else if (value.trim() && text(current.draft) !== value.trim()) {
      // Both inputs are already editable and the helper writes synchronously.
      // Reuse its existing append rule without invoking Send.
      void createAssistantTextSubmission({
        getState: () => ({ active: current.editable.value, draft: current.draft.value }),
        setDraft: value => { current.draft.value = value; },
        submit: () => false
      })(value, { sendImmediately: false });
    }
    initialDraft.value = "";
  }, { flush: "sync" });
  onScopeDispose(() => { initialDraft.value = ""; retained?.release(); });

  function submit({ attachments: files = [], retryMessageId = "" } = {}) {
    const current = runtime.value;
    if (!current?.canSubmit.value) return false;
    const owner = attachmentOwner.value;
    const waitForAcceptance = clearDraftOn === "accepted";
    const pending = waitForAcceptance ? current.delivery.find(current.draftMessageId.value) : null;
    const previousId = retryMessageId || (pending && text(pending.payload.draft) === text(current.draft) ? pending.id : "");
    const retry = previousId ? current.delivery.find(previousId) : null;
    if (retry && retry.status !== "failed") return false;
    if (!retry && owner?.canSubmit === false) return false;
    const prompts = questionOwner.value;
    const formatsQuestions = formatsAnswers(prompts);
    if (!retry && formatsQuestions && prompts.questions?.length &&
        !questionsAnswered(prompts)) return false;
    const answer = !retry && formatsQuestions ? prompts.capture(current.draft.value) : null;
    const captured = retry?.payload || { message: answer?.message ?? current.draft.value, displayAttachments: files,
      ...(waitForAcceptance ? { draft: current.draft.value } : {}),
      ...(data === undefined ? {} : { data: toValue(data) }) };
    if (!String(captured.message || "").trim() && !captured.displayAttachments?.length) return false;
    if (captured.displayAttachments?.length && current.snapshot.value?.capabilities?.attachments !== true) return false;
    const messageId = previousId || crypto.randomUUID();
    if (!retry && answer) prompts.markSubmitted(answer.questionText);
    return submitCaptured(current, captured, { messageId, retry, attachments: owner });
  }

  // Prepared application tasks use the same composer/receipt handling as the
  // standard element. Creation, routing and access policy remain preparation.
  function submitPrepared(payload, { messageId = crypto.randomUUID(), retryMessageId = "", retry,
    working = false, clearDraft = true, attachments = attachmentOwner.value,
    isCurrent = alwaysCurrent, onSubmit, onAccepted, prepare } = {}) {
    const current = runtime.value;
    // readable-check: allow method-probe - input validation: an application hands a prepared submission its own preparation
    if (typeof prepare !== "function") throw new TypeError("Prepared submission requires application preparation.");
    if (!current?.current.value || !isCurrent()) return false;
    const id = retryMessageId || messageId;
    const previous = retry || current.delivery.find(id);
    if ((retryMessageId && !previous) || (previous && (!["failed", "uncertain"].includes(previous.status) || previous.checking))) {
      return false;
    }
    const captured = previous?.payload?.request ? previous.payload : payload;
    const authored = captured.request ? captured : { ...captured, request: authoredRequest(captured, {
      attachmentIds: captured.attachmentIds?.length ? captured.attachmentIds
        : captured.displayAttachments?.map(file => file.attachmentId),
      steer: previous ? captured.submissionKind === "steer" : working
    }) };
    return submitCaptured(current, authored, { messageId: id, retry: previous, clearDraft,
      attachments, isCurrent, onSubmit, onAccepted, prepare });
  }

  function submitCaptured(current, captured, { messageId, retry, clearDraft = true, attachments,
    isCurrent = alwaysCurrent, onSubmit = ignoreSubmit, onAccepted = ignoreAcceptance, prepare }) {
    const waitForAcceptance = clearDraftOn === "accepted";
    const attachmentIds = [...(captured.request?.attachmentIds || captured.attachmentIds ||
      (captured.displayAttachments || []).map(file => file.attachmentId))];
    let accepted = false;
    function acknowledge() {
      if (accepted || !current.current.value || !isCurrent()) return;
      accepted = true;
      if (waitForAcceptance && current.draftMessageId.value === messageId) {
        const receipt = current.delivery.find(messageId);
        current.draftMessageId.value = "";
        if (receipt && text(current.draft) === text(receipt.payload.draft)) current.draft.value = "";
      }
      if (attachmentIds.length) {
        current.draftAttachments.value = current.draftAttachments.value.filter(file => !attachmentIds.includes(file.attachmentId));
        if (runtime.value === current) {
          try { attachments?.clearAttachments({ accepted: true, attachmentIds }); }
          catch (failure) { current.error.value = failureMessage(failure, t("jskit.assistant.runtime.attachments.clearFailed")); }
        }
      }
      onAccepted();
    }
    if (!retry && clearDraft) {
      if (waitForAcceptance) {
        current.draftMessageId.value = messageId;
        captured = { ...captured, draft: current.draft.value };
      } else current.draft.value = "";
    }
    onSubmit();
    const dispatch = () => prepare ? current.submitPrepared(captured, { messageId, onAccepted: acknowledge, prepare })
      : current.send(captured, { messageId, onAccepted: acknowledge });
    // A restored uncertain receipt may have no retained acceptance callback.
    // Inspection can acknowledge it. Only the server's proof that the message
    // never reached the AI (which marks it failed) lets Retry send it again.
    if (retry?.status === "uncertain") return current.inspectDelivery(messageId).then(receipt => {
      if (!current.current.value || !isCurrent()) return false;
      if (receipt?.status === "not-sent" && receipt.messageId === messageId &&
          current.delivery.find(messageId)?.status === "failed") return dispatch();
      if (receipt?.status !== "accepted") {
        const error = current.error.value || t("jskit.assistant.runtime.delivery.notConfirmed");
        const pending = current.delivery.find(messageId);
        if (pending) pending.error = error;
        return { ok: false, status: "uncertain", error };
      }
      acknowledge();
      return { ...receipt, ok: true };
    });
    return dispatch();
  }
  const adapter = computed(() => {
    const current = runtime.value;
    const display = toValue(presentation) || {};
    const state = current?.snapshot.value;
    const files = state?.capabilities?.attachments ? attachmentOwner.value : null;
    const prompts = current?.available.value ? questionOwner.value : null;
    const formatsQuestions = formatsAnswers(prompts);
    const draft = current?.draft.value ?? initialDraft.value;
    const editable = canDraftWhileLoading.value ? !current || current.editable.value : current?.available.value;
    const message = formatsQuestions ? prompts.capture(draft).message : draft;
    const answered = !formatsQuestions || !prompts.questions?.length ||
      questionsAnswered(prompts);
    const canSend = current?.canSubmit.value || false;
    return {
      delivery: current?.delivery,
      attachments: files,
      suggestions: current?.available.value ? suggestionOwner.value : null,
      models: current?.available.value ? modelOwner.value : null, questions: prompts,
      goal: (toValue(goal) === true ? null : toValue(goal)) || current?.goalState.value || null,
      conversation: { turns: current?.turns.value || [], interimReply: state?.interimReply || null,
        error: current?.error.value || stateError(state), errorReloadable: Boolean(current) && !current.accessDenied.value,
        scrollKey: JSON.stringify(identity.value),
        hasMoreBefore: current?.hasMoreBefore.value || false,
        loadingMore: current?.loadingMore.value || false, loadMoreError: current?.loadMoreError.value || "",
        loading: current?.loading.value || false, working: !current?.error.value && state?.status === "working" && !current.delivery.state.sending,
        // The server cancels any unconfirmed message, so its Cancel is offered.
        cancellableDelivery: true,
        assistantLabel: display.assistantLabel || t("jskit.assistant.runtime.conversation.assistantLabel"),
        welcomeMessage: display.welcomeMessage ?? t("jskit.assistant.runtime.conversation.welcomeMessage"),
        systemLabel: display.systemLabel, variant: display.variant, visible: display.visible, retainWhenHidden: display.retainWhenHidden,
        userMessageFormat: display.userMessageFormat, progressPreviewLimit: display.progressPreviewLimit,
        previewMessage: current?.available.value ? display.previewMessage : null },
      composer: { draft, disabled: !editable ||
        (queueWhileSending === false && current?.delivery.state.sending),
        canSend: canSend && answered && Boolean(message.trim() || files?.attachments?.length),
        canStop: state?.status === "working" || state?.status === "unavailable", stopPending: current?.stopping.value || false,
        queueWhileSending: current?.queueWhileSending.value || false,
        ariaLabel: display.ariaLabel, submitAriaLabel: display.submitAriaLabel, submitLabel: display.submitLabel,
        placeholder: formatsQuestions && prompts.questions?.length ? t("jskit.assistant.runtime.composer.questionsPlaceholder")
          : formatsQuestions && prompts.choices?.length ? t("jskit.assistant.runtime.composer.choicesPlaceholder")
            : display.placeholder || t("jskit.assistant.runtime.conversation.placeholder"),
        hint: formatsQuestions && prompts.active ? t("jskit.assistant.runtime.composer.questionsHint") : "",
        rows: display.rows ?? 2, density: display.layout === "compact" ? "compact" : "default", submitOnEnter: true, submitOnModifierEnter: true },
      actions: { setDraft(value) {
        if (current) current.draft.value = value;
        else if (canDraftWhileLoading.value) initialDraft.value = value;
      }, submit,
        resend: messageId => submit({ retryMessageId: messageId }), stop: () => current?.cancel(),
        cancel: messageId => current?.cancelMessage(messageId),
        checkDelivery: messageId => current?.inspectDelivery(messageId), loadMore: input => current?.loadMore(input), reload: () => current?.reload() }
    };
  });
  return { runtime, adapter, submitPrepared, error: computed(() => runtime.value?.error.value || stateError(runtime.value?.snapshot.value)) };
}

/**
 * The standard element and custom text/voice presentation share the supplied binding.
 * @param {ConversationBindingOptions} options
 */
function useAssistantConversation(options) {
  return createConversationBinding(options);
}

/**
 * Dynamic application tasks acquire the same binding without mounting a hidden view.
 * @param {ConversationBindingOptions} [options] Shared by every binding the factory acquires.
 */
function useAssistantConversationFactory(options = {}) {
  const setup = conversationBindingSetup(options);
  const owner = getCurrentScope();
  if (!owner) throw new Error("Conversation factories require an application setup scope.");
  return (input = {}) => {
    if (!owner.active) throw new Error("The conversation factory's application scope has ended.");
    const scope = owner.run(() => effectScope());
    try {
      const binding = scope.run(() => createConversationBinding({ ...options, ...input }, setup));
      return {
        runtime: binding.runtime,
        adapter: binding.adapter,
        submitPrepared: binding.submitPrepared,
        error: binding.error,
        release: () => scope.stop()
      };
    } catch (failure) {
      scope.stop();
      throw failure;
    }
  };
}

export { configureAssistantConversations, useAssistantConversation, useAssistantConversationFactory };
