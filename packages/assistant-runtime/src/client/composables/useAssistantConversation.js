import { computed, effectScope, getCurrentInstance, getCurrentScope, inject, onScopeDispose, proxyRefs, ref, shallowRef, toValue, watch } from "vue";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { createAssistantMessageDelivery, retainAssistantConversation, unmatchedOptimisticMessages } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { createAssistantTextSubmission } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantQuestions } from "@jskit-ai/assistant-core/client/conversation-questions";
import { assistantHttpClient, createAssistantApi } from "@jskit-ai/assistant-core/client";
import { buildAssistantApiPath } from "@jskit-ai/assistant-core/shared";
import {
  conversationTurnsFromMessages, latestAssistantMessageAwaitingUserReply, mergeConversationLogPages,
  normalizeConversationLogPage, normalizeConversationLogPagination
} from "@jskit-ai/assistant-core/shared/conversation";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useSurfaceRouteContext } from "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { useWorkspaceWebScopeSupport } from "../support/workspaceScopeSupport.js";
import { subscribeAssistantConversation } from "../support/subscribeAssistantConversation.js";

const text = value => String(toValue(value) ?? "").trim();
// Keep the injection key stable across optimized package and raw Vue imports.
const conversationDefaultsKey = Symbol.for("jskit.assistant-runtime.conversation.defaults");

/** Configure this Vue application's existing conversation binding before mounting. */
function configureAssistantConversations(app, { actorKey, api = null, request, clearDraftOn = "dispatch" } = {}) {
  if (typeof app?.provide !== "function") throw new TypeError("Conversation defaults require a Vue application.");
  if (request !== undefined && typeof request !== "function") throw new TypeError("Conversation request must be a function.");
  if (!["dispatch", "accepted"].includes(clearDraftOn)) throw new TypeError("clearDraftOn must be dispatch or accepted.");
  app.provide(conversationDefaultsKey, Object.freeze({ actorKey, api, request, clearDraftOn }));
}
// These errors are raised before send admission by the action pipeline or
// admitSend. Provider, storage, attachment-resolution and transport errors can
// occur after dispatch and must retain an uncertain receipt.
const SEND_REJECTIONS = new Set([
  "ACTION_VALIDATION_FAILED", "ACTION_PERMISSION_DENIED", "ACTION_SURFACE_FORBIDDEN",
  "conversation_invalid_message", "conversation_busy", "conversation_not_steerable", "conversation_invalid_goal", "conversation_goal_changed"
]);

function isQuestionConfiguration(value) {
  return value === true || Boolean(value && typeof value === "object" &&
    !["questions", "choices", "capture"].some(key => key in value));
}

function draftAfterAcceptedSubmission(currentDraft = "", submittedDraft = "") {
  const current = String(currentDraft || "");
  const submitted = String(submittedDraft || "");
  if (current === submitted) return "";
  return submitted && current.startsWith(submitted) ? current.slice(submitted.length) : current;
}

function createConversation(identity, { api, socket, actorKey, placement, readers, queueWhileSending, deferWhileWorking, draftStorage, application, goalReadEnabled }) {
  const disposed = ref(false);
  const placementRevision = ref(0);
  const stopPlacement = placement.subscribe(() => { placementRevision.value += 1; });
  const current = computed(() => {
    placementRevision.value;
    const actor = toValue(actorKey);
    return !disposed.value && (actor === undefined ? String(placement.getContext()?.user?.id || "") : text(actor)) === identity.actorKey;
  });
  const active = computed(() => current.value && [...readers.values()].some(reader => toValue(reader.active) !== false));
  const snapshot = shallowRef(null);
  const draft = ref("");
  const draftMessageId = ref("");
  const draftAttachments = ref([]);
  const draftRetry = ref(null);
  const draftRetryMatches = computed(() => {
    const retry = draftRetry.value;
    const current = String(draft.value || "");
    const submitted = String(retry?.draftSnapshot || "");
    return Boolean(retry && submitted && (current === submitted || current.startsWith(submitted)));
  });
  let draftSubmissionSequence = 0;
  const error = ref("");
  const loading = ref(true);
  const stopping = ref(false);
  const goalPending = ref(false);
  const goalLoading = ref(false);
  const goalError = ref("");
  const goalView = shallowRef(null);
  const goalLoadError = ref("");
  const accessDenied = ref(false);
  const delivery = createAssistantMessageDelivery();
  const pendingMessages = new Map();
  const olderPages = ref([]);
  const loadingMore = ref(false);
  const loadMoreError = ref("");
  const turns = computed(() => mergeConversationLogPages([
    ...olderPages.value, { conversationLog: snapshot.value?.turns || [] }
  ]).conversationLog);
  const oldestLoadedPage = computed(() => olderPages.value[0] || snapshot.value);
  const hasMoreBefore = computed(() => normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).hasMoreBefore);
  const editable = computed(() => active.value && !accessDenied.value);
  const available = computed(() => active.value && !loading.value && !accessDenied.value && Boolean(snapshot.value));
  const steerable = computed(() => snapshot.value?.status === "working" && snapshot.value?.capabilities?.steering === true);
  const queueing = computed(() => queueWhileSending !== false && (steerable.value || deferWhileWorking));
  const canSubmit = computed(() => available.value && (snapshot.value.status === "ready" || steerable.value || deferWhileWorking && snapshot.value.status === "working") &&
    (queueWhileSending !== false || !delivery.state.sending) &&
    !delivery.state.messages.some(message => message.status === "uncertain"));
  const savedDraft = toValue(draftStorage);
  if (savedDraft && (typeof savedDraft.key !== "string" || !savedDraft.key ||
      !["getItem", "setItem", "removeItem"].every(name => typeof savedDraft.storage?.[name] === "function"))) {
    throw new TypeError("draftStorage requires an explicit key and storage with getItem, setItem and removeItem.");
  }
  // Original composer state is restored verbatim. A read never reconstructs or
  // sends an old request; the explicit retry keeps its original payload and ID.
  try {
    const saved = savedDraft ? JSON.parse(savedDraft.storage.getItem(savedDraft.key) || "null") : null;
    draft.value = typeof saved?.draft === "string" ? saved.draft : "";
    draftAttachments.value = Array.isArray(saved?.attachments)
      ? saved.attachments.filter(attachment => typeof attachment?.attachmentId === "string") : [];
    const messages = Array.isArray(saved?.messages) ? saved.messages.filter(message =>
      typeof message?.id === "string" && typeof message.text === "string" &&
      typeof message.payload?.message === "string") : [];
    const restoredMessages = messages.filter(message => !delivery.find(message.id)).map(message => {
      const status = ["failed", "accepted"].includes(message.status) ? message.status : "uncertain";
      return { ...message, status, checking: false, error: message.error || (status === "accepted" ? "" :
        "Delivery was not confirmed before this page closed. Check the conversation before retrying.") };
    });
    delivery.state.messages = unmatchedOptimisticMessages(turns.value, [...delivery.state.messages, ...restoredMessages], { receiptsOnly: true });
  } catch {
    draft.value = "";
    draftAttachments.value = [];
  }
  function persistDraft() {
    if (!savedDraft || !current.value || accessDenied.value) return;
    try {
      const saved = { draft: draft.value,
        attachments: draftAttachments.value.filter(attachment => attachment?.attachmentId),
        messages: delivery.state.messages };
      if (saved.draft || saved.attachments.length || saved.messages.length) {
        savedDraft.storage.setItem(savedDraft.key, JSON.stringify(saved));
      } else savedDraft.storage.removeItem(savedDraft.key);
    } catch {
      // The in-memory delivery UI remains usable if storage is full or blocked.
    }
  }
  persistDraft();
  watch([draft, draftAttachments, () => delivery.state.messages], persistDraft, { deep: true, flush: "sync" });
  function settleDraftRetry(retry = draftRetry.value) {
    if (!retry || retry.messageId !== draftRetry.value?.messageId) return false;
    draft.value = draftAfterAcceptedSubmission(draft.value, retry.draftSnapshot);
    draftRetry.value = null;
    return true;
  }
  watch(turns, value => {
    const retry = draftRetry.value;
    if (retry && !unmatchedOptimisticMessages(value, [retry.optimistic], { receiptsOnly: true }).length) settleDraftRetry(retry);
  });
  const questionConfiguration = computed(() => {
    for (const reader of readers.values()) {
      const option = toValue(reader.questions);
      if (toValue(reader.active) !== false && isQuestionConfiguration(option)) return option;
    }
    return null;
  });
  // The form belongs to the conversation, including while only voice retains it.
  // Reader options control presentation; they do not retire its answer state.
  const questions = useAssistantQuestions({
    message: () => available.value ? latestAssistantMessageAwaitingUserReply(turns.value) : "",
    extraChoice: () => questionConfiguration.value?.extraChoice || null
  });
  let subscription;
  let goalRead = null;
  let goalSegment = null;
  let goalReadController = null;
  let goalReadQueued = false;
  const readsGoals = computed(() => goalReadEnabled || snapshot.value?.capabilities?.goals === true ||
    [...readers.values()].some(reader => toValue(reader.goal) === true));
  watch(readsGoals, enabled => { if (enabled) void refreshGoal(); });

  function receiveState(state, { initial = false, canonical = false } = {}) {
    if (!current.value) return;
    const previous = snapshot.value;
    const goalChanged = JSON.stringify([previous?.goal, previous?.capabilities?.goals,
      previous?.capabilities?.goalCommands, previous?.capabilities?.goalBudgets]) !==
      JSON.stringify([state.goal, state.capabilities?.goals, state.capabilities?.goalCommands, state.capabilities?.goalBudgets]);
    if (canonical) {
      olderPages.value = [];
      loadMoreError.value = "";
    }
    snapshot.value = state;
    loading.value = false;
    error.value = "";
    accessDenied.value = false;
    delivery.reconcile(state.turns);
    if (state.status === "unconfirmed" && state.pendingRequest) delivery.restoreUncertain(state.pendingRequest, state.turns);
    if (state.segmentId !== goalSegment) {
      // Keep the open goal menu while its first native identity arrives. The
      // pending read disables commands until it supplies the new exact target.
      goalReadController?.abort();
    }
    if (readsGoals.value && (initial || goalChanged || state.segmentId !== goalSegment)) void refreshGoal();
    goalSegment = state.segmentId;
  }
  function receiveError(failure) {
    if (!current.value) return;
    loading.value = false;
    error.value = failure.message;
    accessDenied.value = [401, 403].includes(Number(failure.status || failure.statusCode));
    if (accessDenied.value) {
      snapshot.value = null;
      olderPages.value = [];
      draft.value = "";
      draftMessageId.value = "";
      draftAttachments.value = [];
      draftRetry.value = null;
      delivery.reset();
      goalError.value = "";
      goalView.value = null;
      goalLoadError.value = "";
      goalReadController?.abort();
    }
  }
  function receiveEvent(event) {
    if (event.type === "goal") void refreshGoal();
    for (const [token, reader] of [...readers]) {
      if (!current.value) return;
      if (!readers.has(token) || toValue(reader.active) === false || typeof reader.onEvent !== "function") continue;
      // Presentation hooks own their errors; one reader must not interrupt
      // another reader or the subscription's canonical state and delivery.
      try { void Promise.resolve(reader.onEvent(event)).catch(() => {}); }
      catch {}
    }
  }
  watch(active, enabled => {
    subscription?.();
    subscription = null;
    if (!enabled) return;
    loading.value = true;
    subscription = subscribeAssistantConversation({ socket, conversationId: identity.conversationId,
      targetSurfaceId: identity.targetSurfaceId, hostSurfaceId: identity.hostSurfaceId,
      ...(identity.workspaceSlug ? { workspaceSlug: identity.workspaceSlug } : {}),
      read: () => api.readConversation(identity.conversationId), onState: receiveState,
      onError: receiveError, onEvent: receiveEvent
    });
  }, { immediate: true, flush: "sync" });
  watch(current, value => {
    if (value) return;
    for (const pending of pendingMessages.values()) if (!pending.dispatched) pending.controller.abort();
    delivery.reset();
    snapshot.value = null;
    olderPages.value = [];
    draft.value = "";
    draftMessageId.value = "";
    draftAttachments.value = [];
    draftRetry.value = null;
    goalError.value = "";
    goalPending.value = false;
    goalView.value = null;
    goalLoadError.value = "";
    goalReadQueued = false;
    goalReadController?.abort();
    questions.reset();
  }, { flush: "sync" });
  onScopeDispose(() => {
    disposed.value = true;
    subscription?.();
    stopPlacement();
    for (const pending of pendingMessages.values()) pending.controller.abort();
    pendingMessages.clear();
    goalReadController?.abort();
    globalThis.removeEventListener?.("focus", refreshVisibleGoal);
    globalThis.document?.removeEventListener("visibilitychange", refreshVisibleGoal);
    delivery.reset();
  });

  async function send(payload, { messageId = crypto.randomUUID(), onAccepted } = {}) {
    const retry = delivery.find(messageId);
    if (retry?.status === "failed" && retry.payload.goalRequest) return changeGoal(retry.payload.goalRequest.action, {}, { messageId });
    if (!canSubmit.value) return false;
    if (retry && retry.status !== "failed") return false;
    const request = retry?.payload?.request || payload.request;
    const requestedSteering = request?.steer === true;
    if (requestedSteering && snapshot.value.capabilities?.steering !== true) return false;
    const steering = requestedSteering || steerable.value;
    const deferred = deferWhileWorking && !retry && !steering;
    if ((snapshot.value.status === "working" || delivery.state.sending) && !steering && !deferred) return false;
    if ((retry?.payload || payload).displayAttachments?.length && snapshot.value.capabilities?.attachments !== true) return false;
    const captured = retry?.payload?.request ? retry.payload : { ...(retry?.payload || payload), request: payload.request || {
      text: String(payload.message || ""),
      ...(payload.data !== undefined ? { data: payload.data } : {}),
      ...(payload.displayAttachments?.length ? { attachmentIds: payload.displayAttachments.map(file => file.attachmentId) } : {}),
      ...(steerable.value ? { steer: true } : {})
    } };
    return submitRequest(captured, { messageId, onAccepted, queue: queueWhileSending !== false && (steering || deferred), deferred });
  }
  function submitPrepared(payload, { messageId = crypto.randomUUID(), onAccepted, prepare } = {}) {
    if (typeof prepare !== "function") throw new TypeError("Prepared submission requires application preparation.");
    const retry = delivery.find(messageId);
    const captured = retry?.payload || payload;
    if (!captured?.request || typeof captured.request !== "object" || Array.isArray(captured.request) || captured.goalRequest) {
      throw new TypeError("Prepared submission requires an authored conversation request.");
    }
    if (!current.value || accessDenied.value || retry && retry.status !== "failed") return Promise.resolve(false);
    return submitRequest(captured, { messageId, onAccepted, prepare });
  }
  async function submitDraft(payload, { messageId = crypto.randomUUID(), submissionKind = steerable.value ? "steer" : "send",
    questionText = "", onAccepted } = {}) {
    if (!canSubmit.value) return false;
    const retry = draftRetryMatches.value ? draftRetry.value : null;
    if (!retry) draftRetry.value = null;
    const draftSnapshot = retry?.draftSnapshot || draft.value;
    const captured = retry?.payload?.request ? retry.payload : payload;
    const kind = retry?.submissionKind || submissionKind;
    const questionTextSnapshot = retry?.questionTextSnapshot || questionText;
    const id = retry?.messageId || messageId;
    const sequence = ++draftSubmissionSequence;
    draftRetry.value = null;
    draft.value = retry ? draftAfterAcceptedSubmission(draft.value, draftSnapshot) : "";
    const result = await send(captured, { messageId: id, onAccepted });
    if (!current.value) return false;
    const accepted = result !== false && result?.ok !== false;
    if (!accepted && kind === "steer" && sequence === draftSubmissionSequence && !draft.value) {
      draft.value = draftSnapshot;
      const optimistic = delivery.find(id) || {
        createdAtMs: Date.now(), id, text: String(captured.displayMessage || captured.message || "").trim()
      };
      draftRetry.value = { draftSnapshot, messageId: id, optimistic, payload: optimistic.payload || captured,
        questionTextSnapshot, submissionKind: kind };
      if (!unmatchedOptimisticMessages(turns.value, [optimistic], { receiptsOnly: true }).length) settleDraftRetry(draftRetry.value);
    }
    return result;
  }
  function waitUntilReady({ controller }) {
    return new Promise(resolve => {
      let stop;
      const finish = ready => {
        stop?.();
        controller.signal.removeEventListener("abort", check);
        resolve(ready);
      };
      const check = () => {
        if (controller.signal.aborted || !available.value) finish(false);
        else if (snapshot.value.status === "ready") finish(true);
        else if (snapshot.value.status !== "working") finish(false);
      };
      stop = watch([available, snapshot], check, { flush: "sync" });
      controller.signal.addEventListener("abort", check, { once: true });
      check();
    });
  }

  async function submitRequest(payload, { messageId, onAccepted, queue = false, prepare, deferred = false }) {
    if (pendingMessages.has(messageId)) return false;
    // Register before the original serial tail so Stop/retirement also reaches
    // a local follower whose deliver callback has not started yet.
    const pending = { controller: new AbortController(), started: false, dispatched: false, deferred };
    const { controller } = pending;
    pendingMessages.set(messageId, pending);
    try {
      const result = await delivery.send(payload, {
        messageId, queue, isCurrent: () => current.value, onAccepted,
        receiptTurns: turns, uncertainOnError: true,
        async deliver(submission) {
          pending.started = true;
          try {
            if (controller.signal.aborted) return false;
            if (deferred) {
              // Refresh through the same subscription after a queued predecessor;
              // its receipt may have arrived before the working snapshot.
              await subscription?.reload();
              if (error.value || !await waitUntilReady(pending)) return false;
              if (controller.signal.aborted || !available.value || snapshot.value.status !== "ready") return false;
              if (submission.displayAttachments?.length && snapshot.value.capabilities?.attachments !== true) {
                return { ok: false, error: "This conversation no longer accepts attachments." };
              }
            }
            const request = prepare ? await prepare(submission, { signal: controller.signal }) : submission.request;
            if (prepare) {
              if (!current.value || accessDenied.value || controller.signal.aborted || request === false) return false;
              if (!request || typeof request !== "object" || Array.isArray(request)) {
                throw new TypeError("Application preparation must return its conversation request or false.");
              }
            }
            pending.dispatched = true;
            return await (submission.goalRequest
              ? api.updateConversationGoal(identity.conversationId, { ...submission.goalRequest, messageId }, { signal: controller.signal })
              : api.sendConversationMessage(identity.conversationId, { ...request, messageId }, { signal: controller.signal }));
          }
          catch (failure) {
            if (controller.signal.aborted) return false;
            if (prepare && !pending.dispatched) return { ok: false, error: failure.message,
              ...(failure.code ? { code: failure.code } : {}) };
            if (SEND_REJECTIONS.has(failure.code)) return { ok: false, error: failure.message,
              ...(prepare && failure.code ? { code: failure.code } : {}) };
            throw failure;
          } finally {
            if (pendingMessages.get(messageId) === pending) pendingMessages.delete(messageId);
          }
        }
      });
      return result;
    } catch (failure) {
      // Delivery keeps its exact authored payload until an explicit receipt check.
      if (prepare) return { ok: false, status: "uncertain", error: failure.message,
        ...(failure.code ? { code: failure.code } : {}) };
      return false;
    } finally {
      if (!pending.started && pendingMessages.get(messageId) === pending) pendingMessages.delete(messageId);
      if (current.value) subscription?.reload();
    }
  }
  function cancelMessage(messageId) {
    const pending = pendingMessages.get(messageId);
    if (!pending) return false;
    pending.controller.abort();
    return true;
  }

  // The original history control keeps older pages separate from the live page.
  async function loadMore({ complete } = {}) {
    const finish = (result) => {
      if (typeof complete === "function") complete(result);
    };
    const beforeTurnId = normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).oldestTurnId ||
      String(turns.value[0]?.turnId || "").trim();
    if (!available.value || !hasMoreBefore.value || loadingMore.value || !beforeTurnId) {
      finish({ changed: false, loaded: false });
      return false;
    }
    loadingMore.value = true;
    loadMoreError.value = "";
    try {
      const page = await api.readConversation(identity.conversationId, {
        beforeTurnId, limit: snapshot.value.pagination.limit
      });
      if (!available.value) {
        finish({ changed: false, loaded: false });
        return false;
      }
      const previousOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      olderPages.value = [normalizeConversationLogPage(page), ...olderPages.value];
      const nextOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      const changed = Boolean(nextOldestTurnId && nextOldestTurnId !== previousOldestTurnId);
      finish({ changed, loaded: true });
      return true;
    } catch (failure) {
      if (current.value) {
        loadMoreError.value = String(failure?.message || failure || "Older conversation history could not be loaded.");
        if ([401, 403].includes(Number(failure.status || failure.statusCode))) receiveError(failure);
      }
      finish({ changed: false, loaded: false });
      return false;
    } finally { loadingMore.value = false; }
  }

  function refreshGoal() {
    if (!active.value || !snapshot.value || !readsGoals.value || accessDenied.value) return Promise.resolve(false);
    if (goalRead) { goalReadQueued = true; return goalRead; }
    const segment = snapshot.value.segmentId;
    const capabilities = snapshot.value.capabilities;
    const controller = new AbortController();
    goalReadController = controller;
    goalLoading.value = true;
    const job = Promise.resolve().then(() => api.readConversationGoal(identity.conversationId, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    })).then(result => {
      if (!current.value || controller.signal.aborted || snapshot.value?.segmentId !== segment) return false;
      // Hosts may supply a same-read target and product view. Standalone reads
      // retain their existing goal/null contract and captured conversation target.
      goalView.value = result && Object.hasOwn(result, "target") ? result : {
        status: "available", goal: result, target: { segmentId: segment, capabilities }
      };
      goalLoadError.value = "";
      return true;
    }).catch(failure => {
      if (current.value && !controller.signal.aborted && snapshot.value?.segmentId === segment) {
        goalLoadError.value = failure.message || "Goal status is unavailable.";
      }
      return false;
    }).finally(() => {
      if (goalRead !== job) return;
      goalRead = null;
      goalReadController = null;
      goalLoading.value = false;
      if (goalReadQueued) {
        goalReadQueued = false;
        void refreshGoal();
      }
    });
    goalRead = job;
    return job;
  }
  function refreshVisibleGoal() {
    if (!globalThis.document?.hidden) void refreshGoal();
  }
  globalThis.addEventListener?.("focus", refreshVisibleGoal);
  globalThis.document?.addEventListener("visibilitychange", refreshVisibleGoal);
  async function changeGoal(action, input = {}, { messageId = crypto.randomUUID() } = {}) {
    const view = goalView.value;
    const target = view?.target;
    const command = target?.capabilities?.goalCommands?.[action];
    if (!available.value || view?.status !== "available" || goalLoadError.value || goalPending.value || goalLoading.value ||
        !["message", "control"].includes(command?.delivery) ||
        delivery.state.messages.some(message => message.status === "uncertain")) return false;
    if (input.tokenBudget != null && !target.capabilities.goalBudgets) {
      goalError.value = "This conversation does not support goal token budgets.";
      return false;
    }
    const retry = delivery.find(messageId);
    if (retry && retry.status !== "failed") return false;
    const request = retry?.payload.goalRequest || { action, expectedSegmentId: target.segmentId,
      expectedGoalId: view.goal?.id || null,
      ...(action === "set" ? { objective: String(input.objective || "").trim(),
        ...(input.tokenBudget == null ? {} : { tokenBudget: input.tokenBudget }) } : {}) };
    goalPending.value = true;
    goalError.value = "";
    try {
      if (retry || command.delivery === "message") {
        const result = await submitRequest(retry?.payload || {
          message: action === "set" ? request.objective : action === "resume" ? "Resume the goal." : "Cancel the goal.",
          goalRequest: request
        }, { messageId });
        if (result === false || result?.ok === false) {
          if (current.value) goalError.value = result?.error || delivery.find(messageId)?.error || "Could not change the goal.";
          return false;
        }
        return result;
      }
      const result = await api.updateConversationGoal(identity.conversationId, request);
      if (result?.ok === false) throw new Error(result.error || "Could not change the goal.");
      return result;
    } catch (failure) {
      if (current.value) {
        goalError.value = failure.message;
        if ([401, 403].includes(Number(failure.status || failure.statusCode))) receiveError(failure);
      }
      return false;
    } finally {
      if (current.value) {
        goalPending.value = false;
        await goalRead;
        await refreshGoal();
        subscription?.reload();
      }
    }
  }
  const goalState = computed(() => {
    const view = goalView.value;
    if (!readsGoals.value) return null;
    const capabilities = view?.target?.capabilities || {};
    const commands = capabilities.goalCommands || {};
    return {
      enabled: active.value && Boolean((view?.status === "available" && !goalLoadError.value) || goalError.value),
      tokenBudgetSupported: capabilities.goalBudgets === true,
      goal: view?.goal ? { ...view.goal, elapsedSeconds: view.goal.timeUsedSeconds,
        sampledAt: Date.parse(view.goal.updatedAt) } : null,
      pending: goalPending.value || goalLoading.value || !available.value || delivery.state.sending ||
        delivery.state.messages.some(message => message.status === "uncertain"),
      error: goalError.value,
      pauseInterruptsTurn: commands.pause?.interruptsTurn === true,
      cancelInterruptsTurn: commands.cancel?.interruptsTurn === true,
      ...Object.fromEntries(["set", "resume", "pause", "cancel"].filter(action =>
        ["message", "control"].includes(commands[action]?.delivery)).map(action => [action, input => changeGoal(action, input)]))
    };
  });
  async function cancel() {
    if (!editable.value || stopping.value) return false;
    stopping.value = true;
    for (const pending of pendingMessages.values()) {
      if (pending.deferred && !pending.dispatched) pending.controller.abort();
    }
    try { return await api.cancelConversation(identity.conversationId); }
    catch (failure) { receiveError(failure); return false; }
    finally { stopping.value = false; if (current.value) subscription?.reload(); }
  }
  async function inspectDelivery(messageId) {
    if (!available.value) return false;
    const message = delivery.find(messageId);
    if (message?.checking) return false;
    if (message) message.checking = true;
    try {
      const receipt = await api.inspectConversationDelivery(identity.conversationId, messageId);
      if (!current.value) return false;
      if (receipt.status === "accepted") delivery.accept(messageId);
      subscription?.reload();
      return receipt;
    } catch (failure) { receiveError(failure); return false; }
    finally { if (message) message.checking = false; }
  }

  const runtime = { identity, current, active, editable, available, canSubmit, steerable, queueWhileSending: queueing,
    snapshot, draft, draftMessageId, draftAttachments, draftRetry, draftRetryMatches, settleDraftRetry,
    error, accessDenied, loading, stopping, delivery, turns,
    hasMoreBefore, loadingMore, loadMoreError, loadMore,
    send, submitPrepared, submitDraft, cancel, cancelMessage, inspectDelivery, changeGoal, refreshGoal, goalState, goalView, goalLoadError, questions,
    reload() { const job = subscription?.reload(); void refreshGoal(); return job; } };
  runtime.application = application ? application(runtime) : null;
  return runtime;
}

// Original bounded-command history belongs to this mounted view. It has no
// canonical delivery receipt, retained server conversation or live subscription.
function useBoundedTask({ command, endpoint, scope, input, result, onResult }, { active, data, presentation }) {
  if (typeof command?.run !== "function" || !("isRunning" in command) ||
      typeof input !== "function" || typeof result !== "function") {
    throw new TypeError("boundedTask requires its command and input/result mappings.");
  }
  if (endpoint === undefined || scope === undefined) throw new TypeError("boundedTask requires its endpoint and application scope.");
  if (onResult !== undefined && typeof onResult !== "function") throw new TypeError("boundedTask.onResult must be a function.");
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
    onResult?.(response, { message, scope: capturedScope });
  }

  const runtime = shallowRef(Object.freeze({ draft, messages, submit,
    clearHistory() { messages.value = []; }
  }));
  const adapter = computed(() => {
    const display = toValue(presentation) || {};
    return {
      conversation: {
        turns: conversationTurnsFromMessages(messages.value.map(message => ({ ...message, text: message.content }))),
        assistantLabel: display.assistantLabel || "Assistant", welcomeMessage: display.welcomeMessage,
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

function conversationBindingSetup({ socket, boundedTask = null } = {}) {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) throw new Error("Conversation binding must be acquired from the application setup.");
  if (boundedTask !== null) return { app };
  const routeContext = useSurfaceRouteContext();
  const placement = inject("jskit.shell-web.runtime.web-placement.client", null);
  if (typeof placement?.getContext !== "function" || typeof placement?.subscribe !== "function") {
    throw new Error("Conversation binding requires the application's placement runtime.");
  }
  return { app, routeContext, placement, defaults: inject(conversationDefaultsKey, {}), workspaceScope: useWorkspaceWebScopeSupport(),
    socket: socket || useRealtimeSocket({ required: true }), config: getClientAppConfig() };
}

function createConversationBinding({ conversationId, endpoint = "", surfaceId = "", hostSurfaceId = "", workspaceSlug,
  actorKey: suppliedActorKey, api: suppliedApi = null, socket: suppliedSocket = null, active = true, onEvent,
  clearDraftOn: suppliedClearDraftOn, queueWhileSending, deferWhileWorking = false, draftWhileLoading = false,
  draftStorage = null, application = null, boundedTask = null,
  data, attachments = null, suggestions = null, models = null, questions = null, goal = null, presentation = {} } = {}, setup) {
  const { app, routeContext, placement, workspaceScope, socket: setupSocket, config, defaults = {} } = setup ||
    conversationBindingSetup({ socket: suppliedSocket, boundedTask });
  const clearDraftOn = suppliedClearDraftOn ?? defaults.clearDraftOn ?? "dispatch";
  const actorKey = computed(() => {
    const actor = toValue(suppliedActorKey);
    return actor === undefined ? toValue(defaults.actorKey) : actor;
  });
  if (!["dispatch", "accepted"].includes(clearDraftOn)) throw new TypeError("clearDraftOn must be dispatch or accepted.");
  if (queueWhileSending !== undefined && typeof queueWhileSending !== "boolean") throw new TypeError("queueWhileSending must be a boolean.");
  if (typeof deferWhileWorking !== "boolean") throw new TypeError("deferWhileWorking must be a boolean.");
  if (typeof draftWhileLoading !== "boolean") throw new TypeError("draftWhileLoading must be a boolean.");
  if (application !== null && typeof application !== "function") throw new TypeError("application must be a factory.");
  if (boundedTask !== null) return useBoundedTask(boundedTask, { active, data, presentation });
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
    const workspace = toValue(workspaceSlug) === undefined
      ? surface?.runtimeSurfaceRequiresWorkspace ? workspaceScope.readRouteScope(routeContext).workspaceSlug : ""
      : text(workspaceSlug);
    const actor = toValue(actorKey);
    return Object.freeze({ conversationId: text(conversationId), targetSurfaceId: target, hostSurfaceId: host || target,
      workspaceSlug: workspace || "", configured: Boolean(surface) && (!surface.runtimeSurfaceRequiresWorkspace || Boolean(workspace)),
      actorKey: actor === undefined ? String(routeContext.placementContext.value?.user?.id || "") : text(actor),
      endpoint: text(endpoint) || buildAssistantApiPath({ requiresWorkspace: Boolean(workspace), workspaceSlug: workspace,
        suffix: `/${target}` }) });
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
    retained = retainAssistantConversation(app, key, readers => createConversation(target, {
      readers, socket, actorKey, placement, queueWhileSending, deferWhileWorking, draftStorage, application, goalReadEnabled: toValue(goal) === true,
      api: suppliedApi || defaults.api || createAssistantApi({ request: defaults.request || assistantHttpClient.request,
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
    const formatsQuestions = typeof prompts?.capture === "function";
    if (!retry && formatsQuestions && prompts.questions?.length &&
        !prompts.questions.every(question => String(prompts.answers[question.name] || "").trim())) return false;
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
    isCurrent = () => true, onSubmit, onAccepted, prepare } = {}) {
    const current = runtime.value;
    if (typeof prepare !== "function") throw new TypeError("Prepared submission requires application preparation.");
    if (!current?.current.value || !isCurrent()) return false;
    const id = retryMessageId || messageId;
    const previous = retry || current.delivery.find(id);
    if ((retryMessageId && !previous) || (previous && (!["failed", "uncertain"].includes(previous.status) || previous.checking))) {
      return false;
    }
    const captured = previous?.payload?.request ? previous.payload : payload;
    const authored = captured.request ? captured : { ...captured, request: {
      text: String(captured.message || ""),
      ...(captured.data !== undefined ? { data: captured.data } : {}),
      ...(captured.attachmentIds?.length ? { attachmentIds: captured.attachmentIds }
        : captured.displayAttachments?.length ? { attachmentIds: captured.displayAttachments.map(file => file.attachmentId) } : {}),
      ...((previous ? captured.submissionKind === "steer" : working) ? { steer: true } : {})
    } };
    return submitCaptured(current, authored, { messageId: id, retry: previous, clearDraft,
      attachments, isCurrent, onSubmit, onAccepted, prepare });
  }

  function submitCaptured(current, captured, { messageId, retry, clearDraft = true, attachments,
    isCurrent = () => true, onSubmit, onAccepted, prepare } = {}) {
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
          catch (failure) { current.error.value = failure?.message || "Accepted attachments could not be cleared from the composer."; }
        }
      }
      onAccepted?.();
    }
    if (!retry && clearDraft) {
      if (waitForAcceptance) {
        current.draftMessageId.value = messageId;
        captured = { ...captured, draft: current.draft.value };
      } else current.draft.value = "";
    }
    onSubmit?.();
    // A restored uncertain receipt may have no retained acceptance callback.
    // Inspection can acknowledge it, but must never run preparation or Send.
    if (retry?.status === "uncertain") return current.inspectDelivery(messageId).then(receipt => {
      if (!current.current.value || !isCurrent()) return false;
      if (receipt?.status !== "accepted") {
        const error = current.error.value || "Message delivery is not confirmed.";
        const pending = current.delivery.find(messageId);
        if (pending) pending.error = error;
        return { ok: false, status: "uncertain", error };
      }
      acknowledge();
      return { ...receipt, ok: true };
    });
    return prepare ? current.submitPrepared(captured, { messageId, onAccepted: acknowledge, prepare })
      : current.send(captured, { messageId, onAccepted: acknowledge });
  }
  const adapter = computed(() => {
    const current = runtime.value;
    const display = toValue(presentation) || {};
    const state = current?.snapshot.value;
    const files = state?.capabilities?.attachments ? attachmentOwner.value : null;
    const prompts = current?.available.value ? questionOwner.value : null;
    const formatsQuestions = typeof prompts?.capture === "function";
    const draft = current?.draft.value ?? initialDraft.value;
    const editable = canDraftWhileLoading.value ? !current || current.editable.value : current?.available.value;
    const message = formatsQuestions ? prompts.capture(draft).message : draft;
    const answered = !formatsQuestions || !prompts.questions?.length ||
      prompts.questions.every(question => String(prompts.answers[question.name] || "").trim());
    const canSend = current?.canSubmit.value || false;
    return {
      delivery: current?.delivery,
      attachments: files,
      suggestions: current?.available.value ? suggestionOwner.value : null,
      models: current?.available.value ? modelOwner.value : null, questions: prompts,
      goal: (toValue(goal) === true ? null : toValue(goal)) || current?.goalState.value || null,
      conversation: { turns: current?.turns.value || [], interimReply: state?.interimReply || null,
        error: current?.error.value || state?.error || "", errorReloadable: Boolean(current) && !current.accessDenied.value,
        scrollKey: JSON.stringify(identity.value),
        hasMoreBefore: current?.hasMoreBefore.value || false,
        loadingMore: current?.loadingMore.value || false, loadMoreError: current?.loadMoreError.value || "",
        loading: current?.loading.value || false, working: !current?.error.value && state?.status === "working" && !current.delivery.state.sending,
        assistantLabel: display.assistantLabel || "Assistant", welcomeMessage: display.welcomeMessage ?? "What would you like to do?",
        systemLabel: display.systemLabel, variant: display.variant, visible: display.visible, retainWhenHidden: display.retainWhenHidden,
        userMessageFormat: display.userMessageFormat, progressPreviewLimit: display.progressPreviewLimit,
        previewMessage: current?.available.value ? display.previewMessage : null },
      composer: { draft, disabled: !editable ||
        (queueWhileSending === false && current?.delivery.state.sending),
        canSend: canSend && answered && Boolean(message.trim() || files?.attachments?.length),
        canStop: state?.status === "working" || state?.status === "unavailable", stopPending: current?.stopping.value || false,
        queueWhileSending: current?.queueWhileSending.value || false,
        ariaLabel: display.ariaLabel, submitAriaLabel: display.submitAriaLabel, submitLabel: display.submitLabel,
        placeholder: formatsQuestions && prompts.questions?.length ? "Optional additional context…"
          : formatsQuestions && prompts.choices?.length ? "Choose an answer above, or type another answer…"
            : display.placeholder || "Message the assistant…",
        hint: formatsQuestions && prompts.active ? "Answer the assistant, then send one combined reply." : "",
        rows: display.rows ?? 2, density: display.layout === "compact" ? "compact" : "default", submitOnEnter: true, submitOnModifierEnter: true },
      actions: { setDraft(value) {
        if (current) current.draft.value = value;
        else if (canDraftWhileLoading.value) initialDraft.value = value;
      }, submit,
        resend: messageId => submit({ retryMessageId: messageId }), stop: () => current?.cancel(),
        checkDelivery: messageId => current?.inspectDelivery(messageId), loadMore: input => current?.loadMore(input), reload: () => current?.reload() }
    };
  });
  return { runtime, adapter, submitPrepared, error: computed(() => runtime.value?.error.value || runtime.value?.snapshot.value?.error || "") };
}

/** The standard element and custom text/voice presentation share the supplied binding. */
function useAssistantConversation(options) {
  return createConversationBinding(options);
}

/** Dynamic application tasks acquire the same binding without mounting a hidden view. */
function useAssistantConversationFactory(options = {}) {
  const setup = conversationBindingSetup(options);
  const owner = getCurrentScope();
  if (!owner) throw new Error("Conversation factories require an application setup scope.");
  return (input = {}) => {
    if (!owner.active) throw new Error("The conversation factory's application scope has ended.");
    const scope = owner.run(() => effectScope());
    try {
      const binding = scope.run(() => createConversationBinding({ ...options, ...input }, setup));
      return { ...binding, release: () => scope.stop() };
    } catch (failure) {
      scope.stop();
      throw failure;
    }
  };
}

export { configureAssistantConversations, useAssistantConversation, useAssistantConversationFactory };
