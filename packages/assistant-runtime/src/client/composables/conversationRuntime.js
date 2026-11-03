import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from "vue";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { createAssistantMessageDelivery, unmatchedOptimisticMessages } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { useAssistantQuestions } from "@jskit-ai/assistant-core/client/conversation-questions";
import { latestAssistantMessageAwaitingUserReply } from "@jskit-ai/assistant-core/shared/conversation";
import { failureMessage, isAccessDenied, resultError } from "../support/conversationFailures.js";
import { subscribeAssistantConversation } from "../support/subscribeAssistantConversation.js";
import { useJskitText } from "../i18n.js";
import { createConversationGoal } from "./conversationGoal.js";
import { createConversationHistory } from "./conversationHistory.js";

const { t } = useJskitText();

/**
 * A maybe-ref value as trimmed text.
 * @param {import("vue").MaybeRefOrGetter<unknown>} value
 */
function text(value) {
  return toText(toValue(value));
}

// These errors are raised before send admission by the action pipeline or
// admitSend. Provider, storage, attachment-resolution and transport errors can
// occur after dispatch and must retain an uncertain receipt.
const SEND_REJECTIONS = new Set([
  "ACTION_VALIDATION_FAILED", "ACTION_PERMISSION_DENIED", "ACTION_SURFACE_FORBIDDEN",
  "conversation_invalid_message", "conversation_busy", "conversation_not_steerable", "conversation_invalid_goal", "conversation_goal_changed",
  "conversation_message_cancelled"
]);

/**
 * Whether a view's questions option configures the conversation's own question form, rather than supplying one.
 * @param {unknown} value
 */
function isQuestionConfiguration(value) {
  return value === true || Boolean(value && typeof value === "object" &&
    !["questions", "choices", "capture"].some(key => key in value));
}

/**
 * The authored conversation request for a composer payload without one.
 * @param {any} payload
 * @param {{ attachmentIds?: string[], steer: boolean }} options
 */
function authoredRequest(payload, { attachmentIds, steer }) {
  return {
    text: String(payload.message || ""),
    ...(payload.data !== undefined ? { data: payload.data } : {}),
    ...(attachmentIds?.length ? { attachmentIds } : {}),
    ...(steer ? { steer: true } : {})
  };
}

/**
 * The draft left once a submitted draft is accepted: text typed after it stays.
 * @param {string} currentDraft
 * @param {string} submittedDraft
 */
function draftAfterAcceptedSubmission(currentDraft, submittedDraft) {
  const current = String(currentDraft || "");
  const submitted = String(submittedDraft || "");
  if (current === submitted) return "";
  return submitted && current.startsWith(submitted) ? current.slice(submitted.length) : current;
}

/**
 * Whether the conversation defers or admits a message while it works, for one state.
 * @param {any} snapshot
 * @param {{ deferWhileWorking: boolean | ((snapshot: any) => boolean), admitWhileWorking: boolean | ((snapshot: any) => boolean) }} policy
 */
function resolveWorkingPolicy(snapshot, { deferWhileWorking, admitWhileWorking }) {
  const resolve = (name, option) => {
    const value = typeof option === "function" ? option(snapshot) : option;
    if (typeof value !== "boolean") throw new TypeError(`${name} must return a boolean.`);
    return value;
  };
  const deferred = resolve("deferWhileWorking", deferWhileWorking);
  const admitted = resolve("admitWhileWorking", admitWhileWorking);
  if (deferred && admitted) throw new TypeError("Choose either admitWhileWorking or deferWhileWorking.");
  return { deferWhileWorking: deferred, admitWhileWorking: admitted };
}

/** The subscription while the conversation is not listening: releasing or reloading it does nothing. */
const NO_SUBSCRIPTION = Object.freeze(Object.assign(function releaseNothing() {}, { reload() {} }));

/**
 * The conversation runtime one or more views retain: its subscription, draft, delivery, history and goal.
 * @param {{
 *   identity: import("../types.js").ConversationIdentity,
 *   api: import("@jskit-ai/assistant-core/client/types").AssistantApi,
 *   socket: import("../types.js").RealtimeSocket,
 *   actorKey: import("vue").ComputedRef<string | undefined>,
 *   placement: import("../types.js").PlacementRuntime,
 *   readers: Map<symbol, import("../types.js").ConversationReader>,
 *   retain: () => { runtime: object, release: () => void },
 *   queueWhileSending: boolean | undefined,
 *   deferWhileWorking: boolean | ((snapshot: any) => boolean),
 *   admitWhileWorking: boolean | ((snapshot: any) => boolean),
 *   draftStorage: import("vue").MaybeRefOrGetter<{ storage: Storage, key: string } | null | undefined>,
 *   application: ((runtime: object) => unknown) | null | undefined,
 *   goalReadEnabled: boolean
 * }} options
 */
function createConversationRuntime({ identity, api, socket, actorKey, placement, readers, retain, queueWhileSending,
  deferWhileWorking, admitWhileWorking, draftStorage, application, goalReadEnabled }) {
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
  const accessDenied = ref(false);
  const delivery = createAssistantMessageDelivery();
  const pendingMessages = new Map();
  const deliveryChecks = new Map();
  const editable = computed(() => active.value && !accessDenied.value);
  const available = computed(() => active.value && !loading.value && !accessDenied.value && Boolean(snapshot.value));
  // A deferred message keeps the subscription while its view is hidden, so it
  // is admitted against live state. A failed read leaves that state stale.
  const deferredWaits = ref(0);
  const listening = computed(() => active.value || current.value && deferredWaits.value > 0);
  const history = createConversationHistory({ api, identity, snapshot, current, listening, available, receiveError });
  const { turns } = history;
  const admissible = computed(() => listening.value && !loading.value && !accessDenied.value && !error.value && Boolean(snapshot.value));
  const steerable = computed(() => snapshot.value?.status === "working" && snapshot.value?.capabilities?.steering === true);
  const workingPolicy = computed(() => resolveWorkingPolicy(snapshot.value, { deferWhileWorking, admitWhileWorking }));
  const queueing = computed(() => queueWhileSending !== false && (steerable.value || workingPolicy.value.deferWhileWorking || workingPolicy.value.admitWhileWorking));
  const canSubmit = computed(() => available.value && !stopping.value && (snapshot.value.status === "ready" || steerable.value || (workingPolicy.value.deferWhileWorking || workingPolicy.value.admitWhileWorking) && snapshot.value.status === "working") &&
    (queueWhileSending !== false || !delivery.state.sending) &&
    !delivery.state.messages.some(message => message.status === "uncertain" &&
      (snapshot.value.status !== "ready" || !message.payload || text(message.payload.draft ?? message.payload.message) === text(draft))));
  const savedDraft = toValue(draftStorage);
  if (savedDraft && (typeof savedDraft.key !== "string" || !savedDraft.key ||
      // readable-check: allow method-probe - input validation: an application hands the binding its own draft storage
      !["getItem", "setItem", "removeItem"].every(name => typeof savedDraft.storage?.[name] === "function"))) {
    throw new TypeError("draftStorage requires an explicit key and storage with getItem, setItem and removeItem.");
  }
  // Saved composer state is restored verbatim. A read never reconstructs or
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
      return { ...message, status, checking: false, cancelling: false, error: message.error || (status === "accepted" ? "" :
        t("jskit.assistant.runtime.delivery.unconfirmedBeforeClose")) };
    });
    delivery.state.messages = unmatchedOptimisticMessages(turns.value, [...delivery.state.messages, ...restoredMessages], { receiptsOnly: true });
    // A cancel the server had not agreed to before this page closed is retried.
    for (const message of messages) {
      if (message.cancelling || message.cancelError) delivery.cancelFailed(message.id, message.cancelError);
    }
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
  let subscription = NO_SUBSCRIPTION;
  const goal = createConversationGoal({ api, identity, readers, goalReadEnabled, current, active, available, accessDenied,
    snapshot, delivery, submitRequest, receiveError, reloadSubscription });
  watch(goal.readsGoals, enabled => { if (enabled) void goal.refreshGoal(); });

  function receiveState(state, { initial = false, canonical = false } = {}) {
    if (!current.value) return;
    const previous = snapshot.value;
    history.receiveState(state, previous, { initial, canonical });
    snapshot.value = state;
    loading.value = false;
    error.value = "";
    accessDenied.value = false;
    delivery.reconcile(state.turns);
    if (state.status === "unconfirmed" && state.pendingRequest) delivery.restoreUncertain(state.pendingRequest, state.turns);
    retryCancels();
    goal.receiveState(state, previous, { initial });
  }
  function receiveError(failure) {
    if (!current.value) return;
    loading.value = false;
    error.value = failureMessage(failure);
    accessDenied.value = isAccessDenied(failure);
    if (accessDenied.value) {
      history.deny();
      clearConversationView();
      goal.forgetTarget();
    }
  }
  // Shared by access denial and actor change. Access denial keeps the open goal
  // command, queued goal read and question form; an actor change clears them.
  function clearConversationView() {
    delivery.reset();
    snapshot.value = null;
    history.clear();
    draft.value = "";
    draftMessageId.value = "";
    draftAttachments.value = [];
    draftRetry.value = null;
    goal.clear();
  }
  function receiveEvent(event) {
    history.receivePatch(event);
    if (event.type === "goal") void goal.refreshGoal();
    for (const [token, reader] of [...readers]) {
      if (!current.value) return;
      // readable-check: allow method-probe - optional operation: a reader retained through runtime.retain(), or a binding given no onEvent, has no presentation hook, so it is skipped
      if (!readers.has(token) || toValue(reader.active) === false || typeof reader.onEvent !== "function") continue;
      // Presentation hooks own their errors; one reader must not interrupt
      // another reader or the subscription's canonical state and delivery.
      try { void Promise.resolve(reader.onEvent(event)).catch(() => {}); }
      catch {}
    }
  }
  watch(listening, enabled => {
    subscription();
    subscription = NO_SUBSCRIPTION;
    history.invalidate();
    if (!enabled) return;
    loading.value = true;
    subscription = subscribeAssistantConversation({ socket, conversationId: identity.conversationId,
      targetSurfaceId: identity.targetSurfaceId, hostSurfaceId: identity.hostSurfaceId,
      ...(identity.workspaceSlug ? { workspaceSlug: identity.workspaceSlug } : {}),
      read: history.readLoadedHistory, onState: receiveState,
      onError: receiveError, onEvent: receiveEvent
    });
  }, { immediate: true, flush: "sync" });
  watch(current, value => {
    if (value) return;
    for (const pending of pendingMessages.values()) if (!pending.dispatched) pending.controller.abort();
    clearConversationView();
    goal.retire();
    questions.reset();
  }, { flush: "sync" });
  onScopeDispose(() => {
    disposed.value = true;
    subscription();
    stopPlacement();
    for (const pending of pendingMessages.values()) pending.controller.abort();
    pendingMessages.clear();
    for (const check of deliveryChecks.values()) check.abort();
    goal.abortRead();
    delivery.reset();
  });

  async function send(payload, { messageId = crypto.randomUUID(), onAccepted } = {}) {
    const retry = delivery.find(messageId);
    if (retry?.status === "failed" && retry.payload.goalRequest) return goal.changeGoal(retry.payload.goalRequest.action, {}, { messageId });
    if (!canSubmit.value) return false;
    if (retry && retry.status !== "failed") return false;
    if (delivery.state.messages.some(message => message.status === "uncertain" &&
        text(message.payload?.message) === text((retry?.payload || payload).message))) return false;
    const request = retry?.payload?.request || payload.request;
    const requestedSteering = request?.steer === true;
    if (requestedSteering && snapshot.value.capabilities?.steering !== true) return false;
    const steering = requestedSteering || steerable.value;
    const policy = workingPolicy.value;
    const deferred = policy.deferWhileWorking && !retry && !steering;
    // An application queue can admit ordinary messages without native steering
    // or waiting for ready. It still owns admission, permissions and receipts.
    const appAdmission = policy.admitWhileWorking && !steering;
    if ((snapshot.value.status === "working" || delivery.state.sending) && !steering && !deferred && !appAdmission) return false;
    if ((retry?.payload || payload).displayAttachments?.length && snapshot.value.capabilities?.attachments !== true) return false;
    const captured = retry?.payload?.request ? retry.payload : { ...(retry?.payload || payload), request: payload.request ||
      authoredRequest(payload, {
        attachmentIds: payload.displayAttachments?.map(file => file.attachmentId),
        steer: steerable.value
      }) };
    return submitRequest(captured, { messageId, onAccepted, queue: queueWhileSending !== false && (steering || deferred || appAdmission), deferred, appAdmission });
  }
  function submitPrepared(payload, { messageId = crypto.randomUUID(), onAccepted, prepare } = {}) {
    // readable-check: allow method-probe - input validation: an application hands a prepared submission its own preparation
    if (typeof prepare !== "function") throw new TypeError("Prepared submission requires application preparation.");
    const retry = delivery.find(messageId);
    const captured = retry?.payload || payload;
    if (!captured?.request || typeof captured.request !== "object" || Array.isArray(captured.request) || captured.goalRequest) {
      throw new TypeError("Prepared submission requires an authored conversation request.");
    }
    if (!current.value || accessDenied.value || retry && retry.status !== "failed") return Promise.resolve(false);
    return submitRequest(captured, { messageId, onAccepted, prepare, queue: queueWhileSending === true });
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
  // A deferred message waits only while the working turn cannot take it. It
  // steers as soon as that turn accepts steering, or sends once it is ready.
  // Its view may be hidden. While loading or after a failed read there is no
  // current state to admit it against, so the unsent message keeps waiting;
  // only Stop, Cancel, retirement or lost access end it.
  function waitForAdmission({ controller }) {
    return new Promise(resolve => {
      const check = () => {
        if (controller.signal.aborted || accessDenied.value) finish(false);
        else if (!admissible.value) return;
        else if (snapshot.value.status === "ready") finish("send");
        else if (steerable.value) finish("steer");
        else if (snapshot.value.status !== "working") finish(false);
      };
      const stop = watch([admissible, snapshot, steerable], check, { flush: "sync" });
      function finish(admission) {
        stop();
        controller.signal.removeEventListener("abort", check);
        resolve(admission);
      }
      controller.signal.addEventListener("abort", check, { once: true });
      check();
    });
  }

  async function submitRequest(payload, { messageId, onAccepted, queue = false, prepare, deferred = false, appAdmission = false }) {
    if (pendingMessages.has(messageId)) return false;
    // Register before the original serial tail so Stop/retirement also reaches
    // a local follower whose deliver callback has not started yet.
    const pending = { controller: new AbortController(), started: false, dispatched: false };
    const { controller } = pending;
    pendingMessages.set(messageId, pending);
    if (deferred) deferredWaits.value += 1;
    try {
      const result = await delivery.send(payload, {
        // A goal command settles on the server's goal answer, not on its
        // transcript turn, which can arrive while its goal is still changing.
        messageId, queue, isCurrent: () => current.value, onAccepted,
        receiptTurns: payload.goalRequest ? null : turns, uncertainOnError: true,
        async deliver(submission) {
          pending.started = true;
          let admission = null;
          try {
            if (controller.signal.aborted || appAdmission && (!available.value || stopping.value || !workingPolicy.value.admitWhileWorking)) return false;
            if (deferred) {
              // Refresh through the same subscription after a queued predecessor;
              // its receipt may have arrived before the working snapshot.
              await reloadSubscription();
              if (snapshot.value?.status === "working" && !steerable.value) {
                delivery.wait(messageId, t("jskit.assistant.runtime.delivery.waitingForStep"));
              }
              admission = await waitForAdmission(pending);
              delivery.wait(messageId, "");
              if (!admission || controller.signal.aborted || !admissible.value ||
                  snapshot.value.status !== (admission === "steer" ? "working" : "ready")) return false;
              if (submission.displayAttachments?.length && snapshot.value.capabilities?.attachments !== true) {
                return { ok: false, error: t("jskit.assistant.runtime.attachments.noLongerAccepted") };
              }
            }
            let request = prepare ? await prepare(submission, { signal: controller.signal }) : submission.request;
            if (admission === "steer") {
              request = { ...request, steer: true };
              const retained = delivery.find(messageId);
              if (retained) retained.payload.request = request;
            }
            if (prepare) {
              if (!current.value || accessDenied.value || controller.signal.aborted || request === false) return false;
              if (!request || typeof request !== "object" || Array.isArray(request)) {
                throw new TypeError("Application preparation must return its conversation request or false.");
              }
            }
            pending.dispatched = true;
            for (let attempt = 0; ; attempt += 1) {
              try {
                return await (submission.goalRequest
                  ? api.updateConversationGoal(identity.conversationId, { ...submission.goalRequest, messageId }, { signal: controller.signal })
                  : api.sendConversationMessage(identity.conversationId, { ...request, messageId }, { signal: controller.signal }));
              } catch (failure) {
                // The server identifies this exact pre-admission race. Keep the
                // same queued words/attachments/identity and try ordinary Send
                // once. A timeout, generic rejection or uncertain send never
                // grants another dispatch.
                if (attempt !== 0 || submission.goalRequest || request.steer !== true ||
                    failure.code !== "conversation_steer_turn_finished" || failure.status !== 409 ||
                    failure.details?.delivery && (failure.details.delivery.status !== "not-sent" ||
                      failure.details.delivery.messageId !== messageId)) throw failure;
                const retained = delivery.find(messageId);
                if (retained?.status === "accepted" || turns.value.some(turn => turn.user?.messageId === messageId && turn.user.receipt !== false)) return { ok: true };
                if (!current.value || accessDenied.value || controller.signal.aborted || !retained || retained.status !== "pending") return false;
                const { steer: _finishedTurn, ...nextRequest } = request;
                request = nextRequest;
                // Retain the new dispatch intent if Send itself fails; Retry
                // must not loop back through the obsolete steering request.
                retained.payload.request = nextRequest;
                retained.payload.submissionKind = "send";
              }
            }
          }
          catch (failure) {
            if (controller.signal.aborted) return false;
            if (prepare && !pending.dispatched) return { ok: false, error: failureMessage(failure),
              ...(failure.code ? { code: failure.code } : {}) };
            const rejection = failure.details?.delivery;
            const notSent = Number.isInteger(failure.status) && failure.status >= 400 && failure.status < 500 &&
              rejection && !Array.isArray(rejection) && rejection.status === "not-sent" && rejection.messageId === messageId;
            // A definite rejection keeps its code so the application can offer
            // the matching recovery, such as freeing assistant context.
            if (notSent || SEND_REJECTIONS.has(failure.code) || failure.code === "conversation_steer_turn_finished" && failure.status === 409 && !failure.details?.delivery) return { ok: false, error: failureMessage(failure),
              ...(failure.code ? { code: failure.code } : {}) };
            throw failure;
          } finally {
            if (pendingMessages.get(messageId) === pending) pendingMessages.delete(messageId);
          }
        }
      });
      return result;
    } catch (failure) {
      // Delivery keeps its exact authored payload until an explicit receipt check.
      if (prepare) return { ok: false, status: "uncertain", error: failureMessage(failure),
        ...(failure.code ? { code: failure.code } : {}) };
      return false;
    } finally {
      if (!pending.started && pendingMessages.get(messageId) === pending) pendingMessages.delete(messageId);
      if (deferred) deferredWaits.value -= 1;
      if (current.value) reloadSubscription();
    }
  }
  // Cancel means cancel, and the server decides. Cancel ends the message's
  // unsent request and running delivery check, then asks the server, which
  // always records the cancel. The message stays, shown as cancelling, until
  // the server agrees; when the server cannot be reached it stays with Cancel
  // again, and the next snapshot after reconnecting retries it.
  async function cancelMessage(messageId) {
    pendingMessages.get(messageId)?.controller.abort();
    deliveryChecks.get(messageId)?.abort();
    if (!available.value || !delivery.cancel(messageId)) return false;
    try {
      const result = await api.cancelConversationDelivery(identity.conversationId, messageId);
      if (result?.ok === false) throw Object.assign(new Error(resultError(result)), { status: 409 });
      if (!current.value) return false;
      delivery.remove(messageId);
      reloadSubscription();
      return true;
    } catch (failure) {
      // The server's own refusal names itself; anything else did not reach it.
      if (current.value) delivery.cancelFailed(messageId, Number.isInteger(failure?.status) && failure.status > 0 ? failureMessage(failure) : "");
      return false;
    }
  }
  function retryCancels() {
    for (const message of delivery.state.messages) {
      if (message.cancelError && !message.cancelling) void cancelMessage(message.id);
    }
  }

  async function cancel() {
    if (!editable.value || stopping.value) return false;
    stopping.value = true;
    for (const pending of pendingMessages.values()) {
      if (!pending.dispatched) pending.controller.abort();
    }
    try { return await api.cancelConversation(identity.conversationId); }
    catch (failure) { receiveError(failure); return false; }
    finally { stopping.value = false; if (current.value) reloadSubscription(); }
  }
  async function inspectDelivery(messageId) {
    if (!available.value) return false;
    const message = delivery.find(messageId);
    if (message?.checking) return false;
    const check = new AbortController();
    deliveryChecks.set(messageId, check);
    if (message) message.checking = true;
    try {
      const receipt = await api.inspectConversationDelivery(identity.conversationId, messageId, { signal: check.signal });
      if (!current.value || check.signal.aborted) return false;
      if (receipt.status === "accepted") {
        delivery.accept(messageId);
        if (receipt.messageId === messageId && message?.payload.goalRequest) goal.clearCommandError();
      }
      // The server recorded this message as cancelled, perhaps from another tab.
      else if (receipt.status === "cancelled" && receipt.messageId === messageId) delivery.remove(messageId);
      else if (receipt.status === "not-sent" && receipt.messageId === messageId) delivery.rejectUnsent(messageId, resultError(receipt));
      else if (receipt.status === "unknown" && message?.status === "uncertain") {
        message.error = t("jskit.assistant.runtime.delivery.stillUnknown");
      }
      reloadSubscription();
      return receipt;
    } catch (failure) {
      if (check.signal.aborted) return false;
      if (current.value && message?.status === "uncertain") message.error = failureMessage(failure, t("jskit.assistant.runtime.delivery.checkFailed"));
      receiveError(failure);
      return false;
    }
    finally {
      if (deliveryChecks.get(messageId) === check) deliveryChecks.delete(messageId);
      if (message) message.checking = false;
    }
  }

  /**
   * Reloads the conversation through its subscription; a reload while not listening does nothing.
   * @param {{ resubscribe?: boolean }} [options]
   */
  function reloadSubscription(options) {
    return subscription.reload(options);
  }

  const runtime = {
    identity,
    current,
    active,
    editable,
    available,
    canSubmit,
    steerable,
    queueWhileSending: queueing,
    snapshot,
    draft,
    draftMessageId,
    draftAttachments,
    draftRetry,
    draftRetryMatches,
    settleDraftRetry,
    error,
    accessDenied,
    loading,
    stopping,
    delivery,
    turns,
    hasMoreBefore: history.hasMoreBefore,
    loadingMore: history.loadingMore,
    loadMoreError: history.loadMoreError,
    loadMore: history.loadMore,
    send,
    submitPrepared,
    submitDraft,
    cancel,
    cancelMessage,
    inspectDelivery,
    changeGoal: goal.changeGoal,
    refreshGoal: goal.refreshGoal,
    goalState: goal.goalState,
    goalView: goal.goalView,
    goalLoadError: goal.goalLoadError,
    questions,
    retain,
    reload(options) {
      const job = reloadSubscription(options);
      void goal.refreshGoal();
      return job;
    },
    application: /** @type {unknown} */ (null)
  };
  // readable-check: allow fixed-result-shape - cycle: the application extension requires the conversation runtime it extends
  if (application) runtime.application = application(runtime);
  return runtime;
}

export { authoredRequest, createConversationRuntime, isQuestionConfiguration, resolveWorkingPolicy, text };
