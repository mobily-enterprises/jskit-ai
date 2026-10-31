<script setup>
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const STATUS_KEYS = Object.freeze({
  active: "jskit.assistant.goal.running", paused: "jskit.assistant.goal.paused", blocked: "jskit.assistant.goal.blocked",
  usageLimited: "jskit.assistant.goal.usageLimited", budgetLimited: "jskit.assistant.goal.budgetLimited", complete: "jskit.assistant.goal.complete"
});

const props = defineProps({ state: { type: Object, default: null } });
const open = ref(false);
const objective = ref("");
const tokenBudget = ref("");
const now = ref(Date.now());
const goal = computed(() => props.state?.loading || props.state?.available === false ? null : props.state?.goal);
const running = computed(() => goal.value?.status === "active");
const working = computed(() => running.value && props.state?.working === true);
// A Start stays Starting… until the server's goal shows it, even while closed.
const starting = computed(() => props.state?.action === "set");
const label = computed(() => props.state?.loading ? t("jskit.assistant.goal.loading") : props.state?.available === false ? t("jskit.assistant.goal.unavailable")
  : starting.value ? t("jskit.assistant.goal.starting")
    : t(Object.hasOwn(STATUS_KEYS, goal.value?.status ?? "") ? STATUS_KEYS[goal.value.status] : "jskit.assistant.goal.set"));
const nativeElapsed = computed(() => Number.isFinite(goal.value?.elapsedSeconds));
const createdAt = computed(() => typeof goal.value?.createdAt === "string" ? Date.parse(goal.value.createdAt) : NaN);
const elapsedLabel = computed(() => nativeElapsed.value ? t("jskit.assistant.goal.runningTime") : t("jskit.assistant.goal.elapsedSinceStart"));
const elapsedText = computed(() => elapsed.value ? t("jskit.assistant.goal.elapsed", { label: elapsedLabel.value, elapsed: elapsed.value }) : "");
const clockRunning = computed(() => nativeElapsed.value ? running.value && Number.isFinite(goal.value?.sampledAt)
  : Boolean(goal.value && goal.value.status !== "complete" && Number.isFinite(createdAt.value)));
const elapsed = computed(() => {
  let secondsUsed;
  if (nativeElapsed.value) {
    const sinceSample = running.value && Number.isFinite(goal.value.sampledAt)
      ? Math.max(0, now.value - goal.value.sampledAt) / 1000 : 0;
    secondsUsed = goal.value.elapsedSeconds + sinceSample;
  } else {
    const end = goal.value?.status === "complete" ? goal.value.sampledAt : now.value;
    if (!Number.isFinite(createdAt.value) || !Number.isFinite(end)) return "";
    secondsUsed = (end - createdAt.value) / 1000;
  }
  const total = Math.max(0, Math.floor(secondsUsed));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}:${seconds}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
});
const canSet = computed(() => !props.state?.loading && props.state?.available !== false && typeof props.state?.set === "function" && (!goal.value || goal.value.status === "complete"));
const validBudget = computed(() => props.state?.tokenBudgetSupported === false || tokenBudget.value === "" || (Number.isSafeInteger(Number(tokenBudget.value)) && Number(tokenBudget.value) > 0));
let timer;
onMounted(() => watch(() => [props.state?.enabled, clockRunning.value, goal.value?.elapsedSeconds, goal.value?.sampledAt, createdAt.value], () => {
  clearInterval(timer);
  now.value = Date.now();
  if (props.state?.enabled !== false && clockRunning.value) {
    timer = setInterval(() => { now.value = Date.now(); }, 1000);
  }
}, { immediate: true, flush: "sync" }));
onScopeDispose(() => clearInterval(timer));
watch(() => props.state?.enabled, enabled => { if (enabled === false) open.value = false; });
async function setGoal() {
  if (!canSet.value || props.state.pending || !objective.value.trim() || !validBudget.value) return;
  const result = await props.state.set({ objective: objective.value.trim(), ...(props.state.tokenBudgetSupported === false || tokenBudget.value === "" ? {} : { tokenBudget: Number(tokenBudget.value) }) });
  if (result !== false && result?.ok !== false && !props.state.error) { objective.value = ""; tokenBudget.value = ""; open.value = false; }
}
</script>

<template>
  <v-menu v-if="state && state.enabled !== false" v-model="open" location="top" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" class="assistant-goal" size="small" variant="text" :aria-label="label" :title="[label, elapsedText, goal?.objective].filter(Boolean).join('\n')">
        <span v-if="goal" class="assistant-goal__light" :class="{ 'assistant-goal__light--running': running, 'assistant-goal__light--working': working, 'assistant-goal__light--paused': goal.status === 'paused' }" aria-hidden="true" />
        <span class="assistant-goal__label">{{ state.loading ? t('jskit.assistant.goal.loading') : state.available === false ? t('jskit.assistant.goal.unavailable') : starting ? t('jskit.assistant.goal.starting') : goal ? t('jskit.assistant.goal.goal') : t('jskit.assistant.goal.set') }}</span>
        <span v-if="elapsed" class="assistant-goal__elapsed" aria-hidden="true">{{ elapsed }}</span>
      </v-btn>
    </template>
    <v-card class="assistant-goal__details pa-3" max-width="360">
      <strong role="status">{{ label }}</strong>
      <v-btn v-if="(running || (state.pauseBlocked && goal?.status === 'blocked')) && state.pause" size="small" :disabled="state.stopPending" @click="state.pause()">{{ state.action === 'pause' ? t('jskit.assistant.goal.pausing') : t('jskit.assistant.goal.pause') }}</v-btn>
      <v-btn v-if="['paused', 'blocked', 'usageLimited'].includes(goal?.status) && state.resume" size="small" :disabled="state.pending" @click="state.resume()">{{ state.action === 'resume' ? t('jskit.assistant.goal.resuming') : t('jskit.assistant.goal.resume') }}</v-btn>
      <v-btn v-if="goal && goal.status !== 'complete' && state.cancel" color="error" size="small" variant="text" :disabled="state.stopPending" @click="state.cancel()">{{ state.action === 'cancel' ? t('jskit.assistant.goal.cancelling') : t('jskit.assistant.goal.cancel') }}</v-btn>
      <p v-if="goal" class="my-2">{{ goal.objective }}</p>
      <p v-if="goal?.reason" class="text-body-small my-2">{{ goal.reason }}</p>
      <p v-if="elapsed" class="text-body-small my-2">{{ elapsedText }}</p>
      <p v-if="running || goal?.status === 'paused'" class="text-body-small mt-2">{{ state.pauseInterruptsTurn ? t('jskit.assistant.goal.pauseInterruptsTurn') : t('jskit.assistant.goal.pausePreventsTurns') }}</p>
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
.assistant-goal__light--running { background: #d32f2f; box-shadow: 0 0 0 3px #d32f2f20; }
.assistant-goal__light--working { animation: assistant-goal-flash 1.5s ease-in-out infinite; }
.assistant-goal__light--paused { background: #ef6c00; box-shadow: 0 0 0 3px #ef6c0020; }
.assistant-goal__elapsed { margin-inline-start: 0.45rem; }
.assistant-goal__details { overflow-wrap: anywhere; min-height: 0; max-height: calc(100dvh - 24px); }
.assistant-goal__form { display: grid; gap: 0.75rem; }
@keyframes assistant-goal-flash { 50% { opacity: 0.3; } }
@container assistant-conversation (max-width: 26rem) { .assistant-goal__elapsed { display: none; } }
@media (prefers-reduced-motion: reduce) { .assistant-goal__light--working { animation: none; } }
</style>
