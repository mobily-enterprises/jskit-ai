<template>
  <section
    v-if="items.length"
    ref="queueRoot"
    class="assistant-attachment-queue"
    :class="{ 'assistant-attachment-queue--standalone': !joined }"
    :aria-busy="hasUnresolved ? 'true' : undefined"
    aria-label="Message attachments"
  >
    <header class="assistant-attachment-queue__summary">
      <span>{{ aggregateLabel }}</span>
      <span class="assistant-attachment-queue__limit">{{ retainedItems.length }} / {{ maximumFiles }}</span>
    </header>

    <ol class="assistant-attachment-queue__items">
      <li
        v-for="(item, index) in items"
        :key="itemKey(item)"
        class="assistant-attachment-queue__item"
        :class="`assistant-attachment-queue__item--${itemPhase(item)}`"
      >
        <v-icon
          class="assistant-attachment-queue__icon"
          :color="itemColor(item)"
          :icon="itemIcon(item)"
          size="18"
          aria-hidden="true"
        />

        <div class="assistant-attachment-queue__content">
          <div class="assistant-attachment-queue__primary">
            <component
              :is="item.attachmentId && previewEnabled ? 'button' : 'span'"
              :type="item.attachmentId && previewEnabled ? 'button' : undefined"
              class="assistant-attachment-queue__name"
              :title="itemName(item)"
              @click="item.attachmentId && previewEnabled && emit('preview', item.receipt || item)"
            >
              {{ item.receipt?.reference }} {{ itemName(item) }}
            </component>
            <span class="assistant-attachment-queue__size">{{ attachmentSizeLabel(item.size) }}</span>
          </div>
          <div class="assistant-attachment-queue__secondary">
            <span>{{ itemStatusLabel(item) }}</span>
            <span v-if="itemProgressVisible(item)">{{ itemBytesLabel(item) }}</span>
          </div>
          <div
            v-if="itemProgressStationary(item)"
            aria-hidden="true"
            class="assistant-attachment-queue__progress assistant-attachment-queue__progress--stationary rounded-pill"
          />
          <v-progress-linear
            v-else-if="itemProgressVisible(item)"
            :aria-label="`Upload progress for ${itemName(item)}`"
            class="assistant-attachment-queue__progress"
            color="primary"
            height="3"
            :indeterminate="itemProgressIndeterminate(item)"
            :model-value="itemProgressValue(item)"
            rounded
          />
          <span
            v-if="item.error"
            class="assistant-attachment-queue__error"
            role="alert"
          >
            {{ item.error }}
          </span>
        </div>

        <div class="assistant-attachment-queue__actions">
          <v-btn
            v-if="itemCancelable(item)"
            :ref="(element) => setActionElement(item, 'cancel', element)"
            :aria-label="`Cancel ${itemName(item)}`"
            class="assistant-attachment-queue__action"
            :icon="mdiCloseCircleOutline"
            size="small"
            :title="`Cancel ${itemName(item)}`"
            type="button"
            variant="text"
            @click="handleAction('cancel', item, index)"
          />
          <v-btn
            v-if="itemPhase(item) === 'failed' || itemPhase(item) === 'cancelled'"
            :ref="(element) => setActionElement(item, 'retry', element)"
            :aria-label="`Retry ${itemName(item)}`"
            class="assistant-attachment-queue__action"
            :icon="mdiRefresh"
            size="small"
            :title="`Retry ${itemName(item)}`"
            type="button"
            variant="text"
            @click="handleAction('retry', item, index)"
          />
          <v-btn
            v-if="itemPhase(item) === 'ready' || itemPhase(item) === 'failed' || itemPhase(item) === 'cancelled'"
            :ref="(element) => setActionElement(item, 'remove', element)"
            :aria-label="`Remove ${itemName(item)}`"
            class="assistant-attachment-queue__action"
            :icon="mdiClose"
            size="small"
            :title="`Remove ${itemName(item)}`"
            type="button"
            variant="text"
            @click="handleAction('remove', item, index)"
          />
        </div>
      </li>
    </ol>

    <span
      class="assistant-attachment-queue__announcement"
      aria-atomic="true"
      aria-live="polite"
      role="status"
    >
      {{ announcement }}
    </span>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiClose,
  mdiCloseCircleOutline,
  mdiFileOutline,
  mdiRefresh
} from "@mdi/js";

import { attachmentSizeLabel } from "../../shared/conversation/attachments.js";

const emit = defineEmits(["cancel", "remove", "retry", "preview", "focus-input"]);

const props = defineProps({
  previewEnabled: Boolean,
  items: {
    default: () => [],
    type: Array
  },
  joined: {
    default: true,
    type: Boolean
  },
  maximumFiles: {
    default: 10,
    type: Number
  }
});

const activePhases = new Set(["queued", "preparing", "uploading", "delivering"]);
const queueRoot = ref(null);
const reducedMotion = ref(false);
const actionElements = new Map();
let reducedMotionMediaQuery = null;
const retainedItems = computed(() => props.items.filter((item) => itemPhase(item) !== "cancelled"));
const completedCount = computed(() => props.items.filter((item) => itemPhase(item) === "ready").length);
const hasUnresolved = computed(() => props.items.some((item) => activePhases.has(itemPhase(item))));
const aggregatePercent = computed(() => {
  if (!retainedItems.value.length) {
    return 0;
  }
  const totalSize = retainedItems.value.reduce((sum, item) => sum + Math.max(0, Number(item.size) || 0), 0);
  if (retainedItems.value.some((item) => (
    activePhases.has(itemPhase(item)) && itemPercent(item) === null
  ))) {
    return null;
  }
  if (totalSize < 1) {
    return Math.round((completedCount.value / retainedItems.value.length) * 100);
  }
  const sent = retainedItems.value.reduce((sum, item) => {
    if (itemPhase(item) === "ready") {
      return sum + Math.max(0, Number(item.size) || 0);
    }
    return sum + Math.min(Math.max(0, Number(item.bytesSent) || 0), Math.max(0, Number(item.size) || 0));
  }, 0);
  return Math.min(100, Math.max(0, Math.round((sent / totalSize) * 100)));
});
const aggregateLabel = computed(() => {
  const total = retainedItems.value.length;
  const active = props.items.filter((item) => activePhases.has(itemPhase(item))).length;
  const failed = props.items.filter((item) => itemPhase(item) === "failed").length;
  const cancelled = props.items.filter((item) => itemPhase(item) === "cancelled").length;
  if (active) {
    return aggregatePercent.value === null
      ? `${completedCount.value} of ${total} ready · in progress`
      : `${completedCount.value} of ${total} ready · ${aggregatePercent.value}%`;
  }
  if (failed) {
    return `${completedCount.value} of ${total} ready · ${failed} ${failed === 1 ? "needs" : "need"} attention`;
  }
  if (cancelled) {
    return `${completedCount.value} ready · ${cancelled} cancelled`;
  }
  return `${completedCount.value} of ${total} ready`;
});
const announcement = computed(() => {
  const messages = [];
  const failed = props.items.filter((item) => itemPhase(item) === "failed").length;
  if (failed) {
    messages.push(`${attachmentCountLabel(failed)} ${failed === 1 ? "needs" : "need"} attention.`);
  }
  const active = props.items.filter((item) => activePhases.has(itemPhase(item))).length;
  if (active) {
    messages.push(`${attachmentCountLabel(active)} ${active === 1 ? "is" : "are"} in progress.`);
  }
  const cancelled = props.items.filter((item) => itemPhase(item) === "cancelled").length;
  if (cancelled) {
    messages.push(`${attachmentCountLabel(cancelled)} cancelled.`);
  }
  if (completedCount.value) {
    messages.push(`${attachmentCountLabel(completedCount.value)} ready.`);
  }
  return messages.join(" ");
});

function attachmentCountLabel(count = 0) {
  return `${count} attachment${count === 1 ? "" : "s"}`;
}

function itemKey(item = {}) {
  return String(item.clientId || item.id || item.attachmentId || item.fileName || "attachment");
}

function itemName(item = {}) {
  return String(item.fileName || item.file?.name || "attachment");
}

function itemPhase(item = {}) {
  return String(item.phase || item.status || "queued");
}

function itemPercent(item = {}) {
  if (itemPhase(item) === "ready") {
    return 100;
  }
  if (itemPhase(item) === "delivering") {
    return 100;
  }
  if (itemPhase(item) === "queued") {
    return 0;
  }
  const progressValue = item.percent ?? item.progress;
  const directPercent = progressValue === null || progressValue === undefined || progressValue === ""
    ? null
    : Number(progressValue);
  if (directPercent !== null && Number.isFinite(directPercent)) {
    return Math.min(100, Math.max(0, Math.round(directPercent)));
  }
  const size = Number(item.size) || 0;
  return size > 0 && Number(item.bytesSent) > 0
    ? Math.min(100, Math.max(0, Math.round(((Number(item.bytesSent) || 0) / size) * 100)))
    : null;
}

function itemProgressVisible(item = {}) {
  return activePhases.has(itemPhase(item));
}

function itemProgressIndeterminate(item = {}) {
  return itemProgressVisible(item) && itemPercent(item) === null;
}

function itemProgressValue(item = {}) {
  return itemPercent(item) ?? 0;
}

function itemProgressStationary(item = {}) {
  return reducedMotion.value && itemProgressVisible(item) && itemPercent(item) === null;
}

function itemBytesLabel(item = {}) {
  const size = Math.max(0, Number(item.size) || 0);
  const sent = Math.min(Math.max(0, Number(item.bytesSent) || 0), size);
  const percent = itemPercent(item);
  return percent === null
    ? `${attachmentSizeLabel(sent)} / ${attachmentSizeLabel(size)}`
    : `${attachmentSizeLabel(sent)} / ${attachmentSizeLabel(size)} · ${percent}%`;
}

function itemStatusLabel(item = {}) {
  const labels = {
    cancelled: "Cancelled",
    delivering: "Sending to Codex",
    failed: item.failureStage === "preparing"
      ? "Preparation failed"
      : item.failureStage === "handoff"
        ? "Sending failed"
        : "Upload failed",
    preparing: "Preparing",
    queued: "Queued",
    ready: "Ready",
    uploading: "Uploading"
  };
  return labels[itemPhase(item)] || "Queued";
}

function itemCancelable(item = {}) {
  return ["preparing", "queued", "uploading"].includes(itemPhase(item));
}

function actionKey(item = {}, action = "") {
  return `${itemKey(item)}:${action}`;
}

function actionElement(element = null) {
  return element?.$el || element || null;
}

function setActionElement(item = {}, action = "", element = null) {
  const key = actionKey(item, action);
  if (element) {
    actionElements.set(key, element);
    return;
  }
  actionElements.delete(key);
}

function focusItemAction(item = {}) {
  for (const action of ["cancel", "retry", "remove"]) {
    const target = actionElement(actionElements.get(actionKey(item, action)));
    if (target && !target.disabled) {
      target.focus?.();
      return true;
    }
  }
  return false;
}

async function handleAction(action, item, index) {
  emit(action, item);
  await nextTick();
  const retainedItem = props.items.find((candidate) => itemKey(candidate) === itemKey(item));
  if (retainedItem && focusItemAction(retainedItem)) {
    return;
  }
  const neighbour = props.items[index] || props.items[index - 1];
  if (neighbour && focusItemAction(neighbour)) {
    return;
  }
  emit("focus-input");
}

function itemIcon(item = {}) {
  if (itemPhase(item) === "ready") {
    return mdiCheckCircleOutline;
  }
  if (itemPhase(item) === "failed") {
    return mdiAlertCircleOutline;
  }
  return mdiFileOutline;
}

function itemColor(item = {}) {
  if (itemPhase(item) === "ready") {
    return "success";
  }
  if (itemPhase(item) === "failed") {
    return "error";
  }
  return "primary";
}

function updateReducedMotionPreference() {
  reducedMotion.value = reducedMotionMediaQuery?.matches === true;
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  reducedMotionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  updateReducedMotionPreference();
}

onMounted(() => {
  if (!reducedMotionMediaQuery) {
    return;
  }
  if (typeof reducedMotionMediaQuery.addEventListener === "function") {
    reducedMotionMediaQuery.addEventListener("change", updateReducedMotionPreference);
  } else {
    reducedMotionMediaQuery.addListener?.(updateReducedMotionPreference);
  }
});

onBeforeUnmount(() => {
  if (typeof reducedMotionMediaQuery?.removeEventListener === "function") {
    reducedMotionMediaQuery.removeEventListener("change", updateReducedMotionPreference);
  } else {
    reducedMotionMediaQuery?.removeListener?.(updateReducedMotionPreference);
  }
  reducedMotionMediaQuery = null;
});
</script>

<style scoped>
.assistant-attachment-queue {
  background: rgba(var(--v-theme-on-surface), 0.035);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-bottom: 0;
  border-radius: 14px 14px 0 0;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.2rem;
  max-height: min(15rem, 32dvh);
  min-width: 0;
  overflow: hidden;
  padding: 0.35rem 0.4rem;
}

.assistant-attachment-queue__summary,
.assistant-attachment-queue__primary,
.assistant-attachment-queue__secondary {
  align-items: baseline;
  display: flex;
  gap: 0.45rem;
  justify-content: space-between;
  min-width: 0;
}

.assistant-attachment-queue--standalone {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 10px;
}

.assistant-attachment-queue__summary {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.25;
  padding: 0 0.28rem 0.15rem;
}

.assistant-attachment-queue__limit {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.assistant-attachment-queue__items {
  display: grid;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 0;
}

.assistant-attachment-queue__item {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
  display: grid;
  gap: 0.4rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 3rem;
  padding: 0.28rem 0.2rem 0.28rem 0.5rem;
}

.assistant-attachment-queue__item--failed {
  background: rgba(var(--v-theme-error), 0.07);
}

.assistant-attachment-queue__icon {
  align-self: start;
  margin-top: 0.3rem;
}

.assistant-attachment-queue__content {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.assistant-attachment-queue__name {
  background: transparent;
  border: 0;
  color: inherit;
  padding: 0;
  text-align: left;
  font-size: 0.78rem;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.assistant-attachment-queue__name {
  cursor: pointer;
}

.assistant-attachment-queue__size,
.assistant-attachment-queue__secondary,
.assistant-attachment-queue__error {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.68rem;
  line-height: 1.25;
}

.assistant-attachment-queue__size {
  flex: 0 0 auto;
}

.assistant-attachment-queue__secondary {
  font-variant-numeric: tabular-nums;
}

.assistant-attachment-queue__error {
  color: rgb(var(--v-theme-error));
  overflow-wrap: anywhere;
}

.assistant-attachment-queue__progress {
  margin-top: 0.08rem;
}

.assistant-attachment-queue__progress--stationary {
  background: rgba(var(--v-theme-primary), 0.18);
  height: 3px;
}

.assistant-attachment-queue__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
}

.assistant-attachment-queue__action {
  min-height: 2.5rem;
  min-width: 2.5rem;
}

.assistant-attachment-queue__announcement {
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  width: 1px;
  clip: rect(0 0 0 0);
}

@media (pointer: coarse) {
  .assistant-attachment-queue__action {
    min-height: 3rem;
    min-width: 3rem;
  }
}

@media (max-width: 599px) {
  .assistant-attachment-queue {
    max-height: min(13rem, 30dvh);
  }

  .assistant-attachment-queue__item {
    gap: 0.25rem;
    padding-left: 0.4rem;
  }
}
</style>
