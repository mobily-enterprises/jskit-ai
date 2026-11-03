import { computed, ref, shallowRef, toValue, watch } from "vue";
import { failureMessage, isAccessDenied, resultError } from "../support/conversationFailures.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

/**
 * A retained conversation's goal: the goal read for the current segment and the Set, Resume, Pause and Cancel
 * commands. The conversation calls its lifecycle operations; it starts no watcher of its own.
 * @param {{
 *   api: import("@jskit-ai/assistant-core/client/types").AssistantApi,
 *   identity: import("../types.js").ConversationIdentity,
 *   readers: Map<symbol, import("../types.js").ConversationReader>,
 *   goalReadEnabled: boolean,
 *   current: import("vue").ComputedRef<boolean>,
 *   active: import("vue").ComputedRef<boolean>,
 *   available: import("vue").ComputedRef<boolean>,
 *   accessDenied: import("vue").Ref<boolean>,
 *   snapshot: import("vue").ShallowRef<any>,
 *   delivery: import("@jskit-ai/assistant-core/client/types").AssistantMessageDelivery,
 *   submitRequest: (payload: object, options: { messageId: string }) => Promise<any>,
 *   receiveError: (failure: any) => void,
 *   reloadSubscription: () => Promise<unknown> | undefined
 * }} conversation
 */
function createConversationGoal({ api, identity, readers, goalReadEnabled, current, active, available, accessDenied, snapshot,
  delivery, submitRequest, receiveError, reloadSubscription }) {
  const goalAction = ref("");
  // An accepted Set or Resume waiting for its goal keeps Pause and Cancel usable.
  const goalSettling = ref(false);
  const goalTargetCurrent = ref(false);
  const goalError = ref("");
  const goalView = shallowRef(null);
  const goalLoadError = ref("");
  let goalRead = null;
  let goalSegment = null;
  let goalReadController = null;
  let goalReadQueued = false;
  let goalCommandSequence = 0;
  const readsGoals = computed(() => goalReadEnabled || snapshot.value?.capabilities?.goals === true ||
    [...readers.values()].some(reader => toValue(reader.goal) === true));

  /**
   * Follows a new conversation state: a new segment needs a new goal target, and a changed goal a fresh read.
   * @param {any} state
   * @param {any} previous The state it replaces.
   * @param {{ initial: boolean }} options
   */
  function receiveState(state, previous, { initial }) {
    const goalChanged = JSON.stringify([previous?.goal, previous?.capabilities?.goals,
      previous?.capabilities?.goalCommands, previous?.capabilities?.goalBudgets]) !==
      JSON.stringify([state.goal, state.capabilities?.goals, state.capabilities?.goalCommands, state.capabilities?.goalBudgets]);
    if (state.segmentId !== goalSegment) {
      // Keep the open goal menu while its first native identity arrives. The
      // pending read disables commands until it supplies the new exact target.
      goalTargetCurrent.value = false;
      goalLoadError.value = "";
      abortRead();
    }
    if (readsGoals.value && (initial || goalChanged || state.segmentId !== goalSegment)) void refreshGoal();
    goalSegment = state.segmentId;
  }
  /** Clears the goal shown with the conversation view. The open command, queued read and target stay. */
  function clear() {
    goalError.value = "";
    goalView.value = null;
    goalLoadError.value = "";
    abortRead();
  }
  /** After lost access, commands wait for a target read with access again. */
  function forgetTarget() {
    goalTargetCurrent.value = false;
  }
  /** After the actor changed, no open command or queued read survives. */
  function retire() {
    goalAction.value = "";
    goalSettling.value = false;
    goalReadQueued = false;
  }
  /** Stops the goal read in flight. */
  function abortRead() {
    // readable-check: allow optional-collaborator - data: the controller of the goal read in flight, none between reads
    goalReadController?.abort();
  }
  /** A goal command whose delivery was confirmed no longer shows its earlier error. */
  function clearCommandError() {
    goalError.value = "";
  }

  function refreshGoal() {
    if (!active.value || !snapshot.value || !readsGoals.value || accessDenied.value) return Promise.resolve(false);
    if (goalRead) { goalReadQueued = true; return goalRead; }
    const segment = snapshot.value.segmentId;
    const capabilities = snapshot.value.capabilities;
    const controller = new AbortController();
    goalReadController = controller;
    const job = Promise.resolve().then(() => api.readConversationGoal(identity.conversationId, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    })).then(result => {
      if (!current.value || controller.signal.aborted || snapshot.value?.segmentId !== segment) return false;
      // Hosts may supply a same-read target and product view. Standalone reads
      // retain their existing goal/null contract and captured conversation target.
      goalView.value = result && Object.hasOwn(result, "target") ? result : {
        status: "available", goal: result, target: { segmentId: segment, capabilities }
      };
      // A background read does not invalidate this observation. Its supplied
      // goal target may intentionally differ from the visible chat segment.
      goalTargetCurrent.value = true;
      goalLoadError.value = "";
      return true;
    }).catch(failure => {
      if (current.value && !controller.signal.aborted && snapshot.value?.segmentId === segment) {
        goalLoadError.value = failureMessage(failure, t("jskit.assistant.runtime.goal.unavailable"));
      }
      return false;
    }).finally(() => {
      if (goalRead !== job) return;
      goalRead = null;
      goalReadController = null;
      if (goalReadQueued) {
        goalReadQueued = false;
        void refreshGoal();
      }
    });
    goalRead = job;
    return job;
  }
  async function changeGoal(action, input = {}, { messageId = crypto.randomUUID() } = {}) {
    const view = goalView.value;
    const target = view?.target;
    const command = target?.capabilities?.goalCommands?.[action];
    // Pause and Cancel never depend on chat delivery: each is pinned to the goal
    // it stops and goes straight to the goal operation, even while a message is
    // sending or its receipt is unknown. Set and Resume wait for those.
    const stopping = action === "pause" || action === "cancel";
    if (!available.value || view?.status !== "available" || goalLoadError.value ||
        goalAction.value && !(stopping && goalSettling.value) || !goalTargetCurrent.value ||
        !["message", "control"].includes(command?.delivery) ||
        !stopping && delivery.state.messages.some(message => message.status === "uncertain")) return false;
    if (input.tokenBudget != null && !target.capabilities.goalBudgets) {
      goalError.value = t("jskit.assistant.runtime.goal.budgetsUnsupported");
      return false;
    }
    const retry = stopping ? null : delivery.find(messageId);
    if (retry && retry.status !== "failed") return false;
    const request = retry?.payload.goalRequest || { action, expectedSegmentId: target.segmentId,
      expectedGoalId: view.goal?.id || null,
      ...(action === "set" ? { objective: String(input.objective || "").trim(),
        ...(input.tokenBudget == null ? {} : { tokenBudget: input.tokenBudget }) } : {}) };
    const before = view.goal ? { id: view.goal.id, status: view.goal.status } : null;
    const sequence = ++goalCommandSequence;
    let accepted = false;
    goalAction.value = action;
    goalSettling.value = false;
    goalError.value = "";
    try {
      let result;
      if (retry || !stopping && command.delivery === "message") {
        result = await submitRequest(retry?.payload || {
          message: action === "set" ? request.objective
            : t(action === "resume" ? "jskit.assistant.runtime.goal.resumeMessage" : "jskit.assistant.runtime.goal.cancelMessage"),
          goalRequest: request
        }, { messageId });
        if (result === false || result?.ok === false) {
          if (current.value) {
            goalError.value = result?.error || delivery.find(messageId)?.error || t("jskit.assistant.runtime.goal.changeFailed");
          }
          return false;
        }
      } else {
        result = await api.updateConversationGoal(identity.conversationId,
          command.delivery === "message" ? { ...request, messageId } : request);
        if (result?.ok === false) throw new Error(resultError(result) || t("jskit.assistant.runtime.goal.changeFailed"));
      }
      accepted = true;
      return result;
    } catch (failure) {
      if (current.value) {
        goalError.value = failureMessage(failure);
        if (isAccessDenied(failure)) receiveError(failure);
      }
      return false;
    } finally {
      // The command stays Starting, Resuming, Pausing or Cancelling until a goal
      // read made after the server's answer arrives; until then the control
      // shows no stale goal or enabled form. An accepted Set or Resume also
      // waits while its goal waits behind the running turn.
      if (current.value && goalCommandSequence === sequence) {
        await goalRead;
        await refreshGoal();
        if (accepted && !stopping) await awaitGoalChange(before, sequence);
        reloadSubscription();
      }
      if (goalCommandSequence === sequence) {
        goalAction.value = "";
        goalSettling.value = false;
      }
    }
  }
  // An accepted Set or Resume changes the server's goal, now or once the turn
  // it waits behind has ended. When the conversation stops working without
  // that change, a fresh read decides and the reason is shown. A later Pause
  // or Cancel ends the wait.
  const goalChangedFrom = before => {
    const goal = goalView.value?.goal;
    return Boolean(goal) && (goal.id !== before?.id || goal.status !== before?.status);
  };
  async function awaitGoalChange(before, sequence) {
    const settled = () => !current.value || goalCommandSequence !== sequence || goalChangedFrom(before);
    await reloadSubscription();
    if (!settled()) goalSettling.value = true;
    while (!settled() && snapshot.value?.status === "working") {
      await new Promise(resolve => {
        const stop = watch([goalView, () => snapshot.value?.status, current, goalAction], () => { stop(); resolve(); });
      });
    }
    if (settled()) return;
    await goalRead;
    await refreshGoal();
    if (!settled()) goalError.value = t("jskit.assistant.runtime.goal.notStarted");
  }
  const goalState = computed(() => {
    const view = goalView.value;
    if (!readsGoals.value) return null;
    const capabilities = view?.target?.capabilities || {};
    const commands = capabilities.goalCommands || {};
    const loading = !goalTargetCurrent.value && !goalLoadError.value;
    const goalAvailable = goalTargetCurrent.value && view?.status === "available" && !goalLoadError.value;
    const stopPending = Boolean(goalAction.value) && !goalSettling.value || !goalAvailable || !available.value;
    return {
      enabled: active.value && Boolean(loading || (view?.status === "available" && !goalLoadError.value) || goalError.value || goalLoadError.value),
      loading,
      available: Boolean(goalAvailable),
      action: goalAction.value,
      working: snapshot.value?.status === "working",
      tokenBudgetSupported: capabilities.goalBudgets === true,
      goal: goalAvailable && view?.goal ? { ...view.goal, elapsedSeconds: view.goal.timeUsedSeconds,
        sampledAt: Date.parse(view.goal.updatedAt) } : null,
      pending: Boolean(goalAction.value) || stopPending || delivery.state.sending ||
        delivery.state.messages.some(message => message.status === "uncertain"),
      stopPending,
      error: goalError.value || goalLoadError.value || view?.error || "",
      pauseInterruptsTurn: commands.pause?.interruptsTurn === true,
      cancelInterruptsTurn: commands.cancel?.interruptsTurn === true,
      ...Object.fromEntries(["set", "resume", "pause", "cancel"].filter(action =>
        ["message", "control"].includes(commands[action]?.delivery)).map(action => [action, input => changeGoal(action, input)]))
    };
  });

  return {
    readsGoals,
    goalState,
    goalView,
    goalLoadError,
    refreshGoal,
    changeGoal,
    receiveState,
    clear,
    forgetTarget,
    retire,
    abortRead,
    clearCommandError
  };
}

export { createConversationGoal };
