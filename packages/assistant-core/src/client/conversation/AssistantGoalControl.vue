<script setup>
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const STATUS_KEYS = Object.freeze({
  active: "jskit.assistant.goal.running", paused: "jskit.assistant.goal.paused", blocked: "jskit.assistant.goal.blocked",
  usageLimited: "jskit.assistant.goal.usageLimited", budgetLimited: "jskit.assistant.goal.budgetLimited", complete: "jskit.assistant.goal.complete"
});

const props = defineProps({
  state: { type: /** @type {import("vue").PropType<import("../types.js").AssistantGoalState>} */ (Object), required: true }
});
const open = ref(false);
const objective = ref("");
const tokenBudget = ref("");
const now = ref(Date.now());
const goal = computed(() => props.state.loading || props.state.available === false ? null : props.state.goal);
const active = computed(() => goal.value?.status === "active");
// An active goal runs only while its conversation is working; between turns,
// or before a restart's continuation starts, nothing is working on it.
const running = computed(() => active.value && props.state.working === true);
// A Start stays Starting… until the server's goal shows it, even while closed.
const starting = computed(() => props.state.action === "set");
// A goal waiting at its AI account's limit names it, with the reset time when
// the engine reports one (with its day when that is not today).
const resetTime = computed(() => {
  if (!Number.isSafeInteger(goal.value?.resetsAt)) return "";
  const reset = new Date(goal.value.resetsAt * 1000);
  const time = `${String(reset.getHours()).padStart(2, "0")}:${String(reset.getMinutes()).padStart(2, "0")}`;
  return reset.toDateString() === new Date().toDateString() ? time : `${reset.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
});
const statusLabel = computed(() => goal.value?.status === "usageLimited" && goal.value.outOfCredit ? t("jskit.assistant.goal.outOfCredit")
  : goal.value?.status === "usageLimited" && resetTime.value ? t("jskit.assistant.goal.usageLimitedUntil", { time: resetTime.value })
    : active.value && !running.value ? t("jskit.assistant.goal.notRunning")
      : t(Object.hasOwn(STATUS_KEYS, goal.value?.status ?? "") ? STATUS_KEYS[goal.value.status] : "jskit.assistant.goal.set"));
const label = computed(() => props.state.loading ? t("jskit.assistant.goal.loading") : props.state.available === false ? t("jskit.assistant.goal.unavailable")
  : starting.value ? t("jskit.assistant.goal.starting") : statusLabel.value);
// The clock is the time spent working on the goal: the engine's running time
// as of sampledAt, plus the time since while the conversation works on it. It
// never counts idle, paused or restart time, and carries on from its total.
// A turn seen starting after the sample counts from that start, not from the
// older sample; a turn already working when the control appeared trusts it.
const workingSince = ref(-Infinity);
watch(running, (value, previous) => { if (value && previous === false) workingSince.value = Date.now(); }, { flush: "sync" });
const elapsedText = computed(() => elapsed.value ? t("jskit.assistant.goal.elapsed", { label: t("jskit.assistant.goal.runningTime"), elapsed: elapsed.value }) : "");
const clockRunning = computed(() => running.value && Number.isFinite(goal.value?.elapsedSeconds) && Number.isFinite(goal.value?.sampledAt));
const elapsed = computed(() => {
  if (!Number.isFinite(goal.value?.elapsedSeconds)) return "";
  const since = clockRunning.value ? Math.max(goal.value.sampledAt, workingSince.value) : now.value;
  const total = Math.max(0, Math.floor(goal.value.elapsedSeconds + Math.max(0, now.value - since) / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}:${seconds}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
});
// The chip says plainly when a goal is not running (paused, blocked, waiting,
// or active with nothing working on it) and shows its clock only while it
// runs; the details keep the running time.
const WAITING_STATUSES = Object.freeze(["paused", "blocked", "usageLimited", "budgetLimited"]);
const chipLabel = computed(() => props.state.loading || props.state.available === false || starting.value ||
  WAITING_STATUSES.includes(goal.value?.status) || (active.value && !running.value) ? label.value
  : t(goal.value ? "jskit.assistant.goal.goal" : "jskit.assistant.goal.set"));
// readable-check: allow method-probe - optional operation: a goal state without set() does not allow starting a goal, so Start stays disabled
const canSet = computed(() => !props.state.loading && props.state.available !== false && typeof props.state.set === "function" && (!goal.value || goal.value.status === "complete"));
const validBudget = computed(() => props.state.tokenBudgetSupported === false || tokenBudget.value === "" || (Number.isSafeInteger(Number(tokenBudget.value)) && Number(tokenBudget.value) > 0));
let timer;
onMounted(() => watch(() => [props.state.enabled, clockRunning.value, goal.value?.elapsedSeconds, goal.value?.sampledAt], () => {
  clearInterval(timer);
  now.value = Date.now();
  if (props.state.enabled !== false && clockRunning.value) {
    timer = setInterval(() => { now.value = Date.now(); }, 1000);
  }
}, { immediate: true, flush: "sync" }));
onScopeDispose(() => clearInterval(timer));
watch(() => props.state.enabled, enabled => { if (enabled === false) open.value = false; });
async function setGoal() {
  if (!canSet.value || props.state.pending || !objective.value.trim() || !validBudget.value) return;
  const result = await props.state.set({ objective: objective.value.trim(), ...(props.state.tokenBudgetSupported === false || tokenBudget.value === "" ? {} : { tokenBudget: Number(tokenBudget.value) }) });
  if (result !== false && result?.ok !== false && !props.state.error) { objective.value = ""; tokenBudget.value = ""; open.value = false; }
}
// A successful Cancel closes the menu, as Start does; Pause and Resume keep it open.
async function cancelGoal() {
  const result = await props.state.cancel();
  if (result !== false && result?.ok !== false && !props.state.error) open.value = false;
}
</script>

<template>
  <v-menu v-if="state && state.enabled !== false" v-model="open" location="top" width="360" max-width="calc(100vw - 24px)" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" class="assistant-goal" size="small" variant="text" :aria-label="label" :title="[label, elapsedText, goal?.objective].filter(Boolean).join('\n')">
        <span v-if="goal" class="assistant-goal__light" :class="{ 'assistant-goal__light--running': running, 'assistant-goal__light--paused': goal.status === 'paused' }" aria-hidden="true" />
        <span class="assistant-goal__label">{{ chipLabel }}</span>
        <span v-if="elapsed && running" class="assistant-goal__elapsed" aria-hidden="true">{{ elapsed }}</span>
      </v-btn>
    </template>
    <v-card class="assistant-goal__details pa-3">
      <strong role="status">{{ label }}</strong>
      <v-btn v-if="(active || (state.pauseBlocked && ['blocked', 'usageLimited'].includes(goal?.status))) && state.pause" size="small" :disabled="state.stopPending" @click="state.pause()">{{ state.action === 'pause' ? t('jskit.assistant.goal.pausing') : t('jskit.assistant.goal.pause') }}</v-btn>
      <v-btn v-if="['paused', 'blocked', 'usageLimited'].includes(goal?.status) && state.resume" size="small" :disabled="state.pending" @click="state.resume()">{{ state.action === 'resume' ? t('jskit.assistant.goal.resuming') : t('jskit.assistant.goal.resume') }}</v-btn>
      <v-btn v-if="goal && goal.status !== 'complete' && state.cancel" color="error" size="small" variant="text" :disabled="state.stopPending" @click="cancelGoal">{{ state.action === 'cancel' ? t('jskit.assistant.goal.cancelling') : t('jskit.assistant.goal.cancel') }}</v-btn>
      <p v-if="goal" class="my-2">{{ goal.objective }}</p>
      <p v-if="goal?.reason" class="text-body-small my-2">{{ goal.reason }}</p>
      <p v-if="elapsed" class="text-body-small my-2">{{ elapsedText }}</p>
      <p v-if="active && !running" class="text-body-small my-2">{{ t('jskit.assistant.goal.notRunningHint') }}</p>
      <p v-if="goal?.status === 'usageLimited'" class="text-body-small mt-2">{{ t('jskit.assistant.goal.usageLimitedHint') }}</p>
      <p v-if="active || goal?.status === 'paused'" class="text-body-small mt-2">{{ state.pauseInterruptsTurn ? t('jskit.assistant.goal.pauseInterruptsTurn') : t('jskit.assistant.goal.pausePreventsTurns') }}</p>
      <p v-if="goal && goal.status !== 'complete' && state.cancel" class="text-body-small mt-2">{{ state.cancelInterruptsTurn ? t('jskit.assistant.goal.cancelInterruptsTurn') : t('jskit.assistant.goal.cancelRemovesGoal') }}</p>
      <form v-if="canSet" class="assistant-goal__form mt-2" @submit.prevent="setGoal">
        <v-textarea v-model="objective" :label="t('jskit.assistant.goal.objective')" rows="2" max-rows="4" maxlength="4000" auto-grow :disabled="state.pending" hide-details />
        <v-text-field v-if="state.tokenBudgetSupported !== false" v-model="tokenBudget" :label="t('jskit.assistant.goal.tokenBudget')" type="number" min="1" step="1" :disabled="state.pending" :error="!validBudget" hide-details />
        <v-btn type="submit" size="small" :disabled="state.pending || !objective.trim() || !validBudget">{{ starting ? t('jskit.assistant.goal.starting') : t('jskit.assistant.goal.start') }}</v-btn>
      </form>
      <p v-if="state.error" role="alert" class="text-error text-body-small mt-2">{{ state.error }}</p>
      <slot :goal="goal" />
    </v-card>
  </v-menu>
</template>

<style scoped>
.assistant-goal { text-transform: none; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.assistant-goal__light { width: 0.625rem; height: 0.625rem; border-radius: 50%; margin-inline-end: 0.45rem; background: currentColor; }
.assistant-goal__light--running { background: #d32f2f; box-shadow: 0 0 0 3px #d32f2f20; animation: assistant-goal-flash 1.5s ease-in-out infinite; }
.assistant-goal__light--paused { background: #ef6c00; box-shadow: 0 0 0 3px #ef6c0020; }
.assistant-goal__elapsed { margin-inline-start: 0.45rem; }
.assistant-goal__details { overflow-wrap: anywhere; min-height: 0; max-height: calc(100dvh - 24px); }
.assistant-goal__form { display: grid; gap: 0.75rem; }
@keyframes assistant-goal-flash { 50% { opacity: 0.3; } }
@container assistant-conversation (max-width: 26rem) {
  .assistant-goal__elapsed { display: none; }
  .assistant-goal__label { max-width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) { .assistant-goal__light--running { animation: none; } }
</style>
