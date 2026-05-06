<script setup>
import { computed } from "vue";
import { useGoogleRewardedRuntime } from "../composables/useGoogleRewardedRuntime.js";

const props = defineProps({
  runtime: {
    type: Object,
    required: false,
    default: null
  }
});

const runtime = computed(() => props.runtime || useGoogleRewardedRuntime());
const state = computed(() => runtime.value?.state || null);
const isVisible = computed(() => {
  const currentState = state.value;
  return currentState?.open === true && currentState?.phase !== "showing-ad";
});
const titleText = computed(() => state.value?.gateState?.rule?.title || "Watch an ad to continue");
const descriptionText = computed(() =>
  state.value?.gateState?.rule?.description ||
  "Watch a rewarded ad to unlock this action."
);

function handleWatchClick() {
  runtime.value?.beginWatch?.();
}

function handleCancelClick() {
  runtime.value?.cancelPrompt?.();
}

function handleDismissError() {
  runtime.value?.dismissError?.();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isVisible" class="google-rewarded-gate">
      <div class="google-rewarded-gate__scrim" />
      <div class="google-rewarded-gate__panel">
        <div class="google-rewarded-gate__eyebrow">Rewarded unlock</div>
        <h2 class="google-rewarded-gate__title">{{ titleText }}</h2>
        <p class="google-rewarded-gate__description">{{ descriptionText }}</p>

        <p
          v-if="state?.phase === 'loading'"
          class="google-rewarded-gate__status"
        >
          Loading Google rewarded ad…
        </p>

        <p
          v-else-if="state?.phase === 'error'"
          class="google-rewarded-gate__status google-rewarded-gate__status--error"
        >
          {{ state?.errorMessage || "Unable to start the rewarded ad." }}
        </p>

        <div class="google-rewarded-gate__actions">
          <button
            v-if="state?.phase === 'prompt'"
            type="button"
            class="google-rewarded-gate__button google-rewarded-gate__button--primary"
            @click="handleWatchClick"
          >
            Watch ad
          </button>

          <button
            v-if="state?.phase === 'prompt'"
            type="button"
            class="google-rewarded-gate__button"
            @click="handleCancelClick"
          >
            Not now
          </button>

          <button
            v-if="state?.phase === 'error'"
            type="button"
            class="google-rewarded-gate__button google-rewarded-gate__button--primary"
            @click="handleDismissError"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.google-rewarded-gate {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.google-rewarded-gate__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(2, 6, 23, 0.94));
  backdrop-filter: blur(4px);
}

.google-rewarded-gate__panel {
  position: relative;
  width: min(32rem, calc(100vw - 2rem));
  border-radius: 1.5rem;
  padding: 1.5rem;
  background: #fffaf0;
  color: #201510;
  box-shadow: 0 2rem 5rem rgba(15, 23, 42, 0.35);
}

.google-rewarded-gate__eyebrow {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9a3412;
}

.google-rewarded-gate__title {
  margin: 0.5rem 0 0;
  font-size: 1.5rem;
  line-height: 1.2;
}

.google-rewarded-gate__description {
  margin: 0.75rem 0 0;
  line-height: 1.5;
  color: #5b4636;
}

.google-rewarded-gate__status {
  margin: 1rem 0 0;
  font-size: 0.95rem;
  color: #854d0e;
}

.google-rewarded-gate__status--error {
  color: #991b1b;
}

.google-rewarded-gate__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.google-rewarded-gate__button {
  appearance: none;
  border: 1px solid #d6d3d1;
  border-radius: 999px;
  padding: 0.8rem 1.2rem;
  background: #fff;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.google-rewarded-gate__button--primary {
  border-color: transparent;
  background: #ea580c;
  color: #fff;
}

@media (max-width: 640px) {
  .google-rewarded-gate__actions {
    flex-direction: column;
  }

  .google-rewarded-gate__button {
    width: 100%;
  }
}
</style>
