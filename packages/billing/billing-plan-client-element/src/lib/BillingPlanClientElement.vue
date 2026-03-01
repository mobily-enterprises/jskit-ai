<template>
  <section class="billing-plan-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-card class="billing-plan-client-element__shell" v-bind="shellCardProps" :data-testid="uiTestIds.shell">
      <v-card-item
        v-if="resolvedFeatures.header"
        class="billing-plan-client-element__header"
        :class="uiClasses.header"
        :data-testid="uiTestIds.header"
      >
        <div class="billing-plan-client-element__header-main">
          <v-card-title class="text-subtitle-1 font-weight-bold">{{ copyText.headingTitle }}</v-card-title>
          <v-card-subtitle>{{ copyText.headingSubtitle }}</v-card-subtitle>
        </div>
        <slot
          name="header-extra"
          :meta="meta"
          :state="state"
          :actions="actions"
          :copy="copyText"
          :variant="resolvedVariant"
          :features="resolvedFeatures"
        />
      </v-card-item>

      <v-divider v-if="resolvedFeatures.header" />

      <v-card-text class="billing-plan-client-element__body">
        <div
          v-if="resolvedFeatures.alerts"
          class="billing-plan-client-element__alerts"
          :class="uiClasses.alerts"
          :data-testid="uiTestIds.alerts"
        >
          <v-alert v-if="state.actionError" type="error" variant="tonal" class="mb-3">{{ state.actionError }}</v-alert>
          <v-alert v-if="state.actionSuccess" type="success" variant="tonal" class="mb-3">
            {{ state.actionSuccess }}
          </v-alert>
          <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">{{ state.error }}</v-alert>
        </div>

        <v-row dense class="billing-plan-client-element__plan-row" :class="uiClasses.planRow">
          <v-col v-if="resolvedFeatures.currentPlan" cols="12" lg="7">
            <v-card
              class="h-100 billing-plan-current-card"
              :class="uiClasses.currentPlanCard"
              :data-testid="uiTestIds.currentPlanCard"
              v-bind="sectionCardProps"
            >
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.currentPlanTitle }}</v-card-title>
                <v-card-subtitle v-if="state.currentPlan">
                  <template v-if="state.currentPlanHasNoExpiry">{{ copyText.currentPlanNoExpirySubtitle }}</template>
                  <template v-else>{{ copyText.currentPlanUntilPrefix }} {{ formatDateOnly(state.currentPeriodEndAt) }}.</template>
                </v-card-subtitle>
                <v-card-subtitle v-else>{{ copyText.currentPlanEmptySubtitle }}</v-card-subtitle>
              </v-card-item>

              <v-card-text v-if="state.currentPlan">
                <div class="d-flex flex-wrap align-center ga-2 mb-2">
                  <span class="text-h6 font-weight-bold">{{ state.currentPlan.name || state.currentPlan.code }}</span>
                  <v-chip size="small" label>{{ state.currentPlan.code }}</v-chip>
                </div>
                <div class="text-body-2 mb-2">{{ state.currentPlan.description || copyText.planDescriptionFallback }}</div>
                <div class="text-body-2 text-medium-emphasis mb-2">
                  {{ copyText.currentPeriodEndsLabel }}
                  <strong>{{ state.currentPlanHasNoExpiry ? copyText.noExpiryValue : formatDateOnly(state.currentPeriodEndAt) }}</strong>
                </div>
                <div v-if="state.currentPlan.corePrice" class="text-body-2 text-medium-emphasis">
                  {{ copyText.corePriceLabel }}
                  {{
                    formatMoneyMinor(state.currentPlan.corePrice.unitAmountMinor, state.currentPlan.corePrice.currency)
                  }}
                  / {{ state.currentPlan.corePrice.interval }}
                </div>
                <div v-else class="text-body-2 text-medium-emphasis">
                  {{ copyText.corePriceLabel }} <strong>{{ copyText.corePriceFreeValue }}</strong>
                </div>
                <div v-if="resolvedFeatures.currentPlanCancelAction && state.canCancelCurrentPlan" class="mt-3">
                  <v-btn
                    color="error"
                    variant="outlined"
                    :loading="state.cancelCurrentPlanLoading"
                    :data-testid="uiTestIds.cancelCurrentButton"
                    @click="onCancelCurrentPlan"
                  >
                    {{ copyText.cancelCurrentPlanLabel }}
                  </v-btn>
                </div>
              </v-card-text>

              <v-card-text v-else>
                <div class="text-body-2 text-medium-emphasis">{{ copyText.currentPlanEmptyBody }}</div>
              </v-card-text>

              <slot
                name="current-plan-extra"
                :meta="meta"
                :state="state"
                :actions="actions"
                :copy="copyText"
                :variant="resolvedVariant"
                :features="resolvedFeatures"
              />
            </v-card>
          </v-col>

          <v-col v-if="resolvedFeatures.scheduledChange" cols="12" lg="5">
            <v-card
              class="h-100 billing-plan-scheduled-card"
              :class="uiClasses.scheduledChangeCard"
              :data-testid="uiTestIds.scheduledChangeCard"
              v-bind="sectionCardProps"
            >
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.scheduledChangeTitle }}</v-card-title>
                <v-card-subtitle v-if="state.pendingChange && state.nextPlan">
                  {{ copyText.scheduledChangeEffectivePrefix }} {{ formatDateOnly(state.nextEffectiveAt) }}.
                </v-card-subtitle>
                <v-card-subtitle v-else>{{ copyText.scheduledChangeEmptySubtitle }}</v-card-subtitle>
              </v-card-item>

              <v-card-text v-if="state.pendingChange && state.nextPlan">
                <div class="text-body-1 font-weight-medium mb-1">{{ state.nextPlan.name || state.nextPlan.code }}</div>
                <div class="text-body-2 text-medium-emphasis mb-3">
                  {{ copyText.scheduledChangeEffectiveLabel }} {{ formatDateOnly(state.nextEffectiveAt) }}
                </div>
                <v-btn
                  v-if="resolvedFeatures.scheduledChangeCancelAction"
                  color="primary"
                  variant="outlined"
                  :loading="state.cancelPlanChangeLoading"
                  :data-testid="uiTestIds.cancelScheduledButton"
                  @click="onCancelScheduledPlanChange"
                >
                  {{ copyText.cancelScheduledChangeLabel }}
                </v-btn>
              </v-card-text>

              <v-card-text v-else>
                <div class="text-body-2 text-medium-emphasis">{{ copyText.scheduledChangeEmptyBody }}</div>
              </v-card-text>

              <slot
                name="scheduled-change-extra"
                :meta="meta"
                :state="state"
                :actions="actions"
                :copy="copyText"
                :variant="resolvedVariant"
                :features="resolvedFeatures"
              />
            </v-card>
          </v-col>
        </v-row>

        <v-card
          v-if="resolvedFeatures.changeCorePlan"
          class="mt-4 billing-plan-change-card"
          :class="uiClasses.changeCorePlanCard"
          :data-testid="uiTestIds.changeCorePlanCard"
          v-bind="sectionCardProps"
        >
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.changeCorePlanTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.changeCorePlanSubtitle }}</v-card-subtitle>
          </v-card-item>

          <v-card-text>
            <div class="d-flex flex-wrap ga-3 align-center mb-2 billing-plan-client-element__actions-row">
              <v-select
                :model-value="state.selectedPlanCode"
                :items="planOptions"
                item-title="title"
                item-value="value"
                :label="copyText.targetPlanLabel"
                :density="resolvedVariant.density"
                variant="outlined"
                hide-details
                class="billing-plan-client-element__filters-field"
                :class="uiClasses.targetPlanField"
                :data-testid="uiTestIds.targetPlanField"
                @update:model-value="onUpdateSelectedPlan"
              />

              <v-btn
                color="primary"
                :loading="state.planChangeLoading"
                :data-testid="uiTestIds.submitButton"
                @click="onSubmitPlanChange"
              >
                {{ copyText.changePlanButtonLabel }}
              </v-btn>

              <a
                v-if="resolvedFeatures.checkoutLink && state.lastCheckoutUrl"
                :href="state.lastCheckoutUrl"
                target="_blank"
                rel="noopener noreferrer"
                :data-testid="uiTestIds.checkoutLink"
                @click="onCheckoutLinkClick"
              >
                {{ copyText.checkoutLinkLabel }}
              </a>
            </div>

            <div v-if="state.selectedTargetPlan" class="text-body-2 text-medium-emphasis">
              {{ state.selectedTargetPlan.description || copyText.planDescriptionFallback }}
            </div>
            <div v-if="resolvedFeatures.paymentPolicy" class="text-caption text-medium-emphasis mt-2">
              {{ copyText.paymentPolicyLabel }}: <strong>{{ state.paymentPolicy }}</strong>
            </div>
          </v-card-text>

          <slot
            name="change-core-plan-extra"
            :meta="meta"
            :state="state"
            :actions="actions"
            :copy="copyText"
            :variant="resolvedVariant"
            :features="resolvedFeatures"
          />
        </v-card>

        <slot
          name="footer-extra"
          :meta="meta"
          :state="state"
          :actions="actions"
          :copy="copyText"
          :variant="resolvedVariant"
          :features="resolvedFeatures"
        />
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useClientElementProps } from "@jskit-ai/web-runtime-core";

const DEFAULT_COPY = Object.freeze({
  headingTitle: "Workspace billing",
  headingSubtitle: "Current plan, upcoming changes, and one-off extras.",
  currentPlanTitle: "Current plan",
  currentPlanNoExpirySubtitle: "This plan does not expire.",
  currentPlanUntilPrefix: "Current plan remains active until",
  currentPlanEmptySubtitle: "No active plan assigned yet.",
  currentPlanEmptyBody: "Choose a plan below. Free plans apply immediately, paid plans can require checkout.",
  planDescriptionFallback: "No description.",
  currentPeriodEndsLabel: "Current period ends:",
  noExpiryValue: "No expiry",
  corePriceLabel: "Core price:",
  corePriceFreeValue: "Free",
  cancelCurrentPlanLabel: "Cancel plan",
  scheduledChangeTitle: "Scheduled change",
  scheduledChangeEffectivePrefix: "The downgrade will take effect on",
  scheduledChangeEmptySubtitle: "No scheduled plan change.",
  scheduledChangeEffectiveLabel: "Effective",
  scheduledChangeEmptyBody: "Downgrades are scheduled to your period end; upgrades apply immediately.",
  cancelScheduledChangeLabel: "Cancel scheduled change",
  changeCorePlanTitle: "Change core plan",
  changeCorePlanSubtitle: "Select a different plan. Current plan is excluded from options.",
  targetPlanLabel: "Target plan",
  changePlanButtonLabel: "Change plan",
  checkoutLinkLabel: "Open checkout",
  paymentPolicyLabel: "Paid-plan payment-method policy"
});

const props = defineProps({
  meta: {
    type: Object,
    required: true
  },
  state: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  },
  copy: {
    type: Object,
    default: () => ({})
  },
  variant: {
    type: Object,
    default: () => ({})
  },
  features: {
    type: Object,
    default: () => ({})
  },
  ui: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  "action:started",
  "action:succeeded",
  "action:failed",
  "interaction",
  "plan-change:submit",
  "plan-change:cancel-current",
  "plan-change:cancel-scheduled",
  "checkout:open"
]);

function fallbackFormatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function fallbackFormatMoneyMinor(amountMinor, currency = "USD") {
  const amount = Number(amountMinor);
  const normalizedCurrency = String(currency || "")
    .trim()
    .toUpperCase();
  if (!Number.isFinite(amount) || !normalizedCurrency) {
    return "-";
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

const { toRecord, copyText, resolvedVariant, resolvedFeatures } = useClientElementProps({
  props,
  defaultCopy: DEFAULT_COPY,
  variantConfig: {
    layout: { supported: ["compact", "comfortable"], fallback: "comfortable" },
    surface: { supported: ["plain", "carded"], fallback: "carded" },
    density: { supported: ["compact", "comfortable"], fallback: "comfortable" },
    emphasis: { supported: ["default", "quiet"], fallback: "default" }
  },
  featureDefaults: {
    header: true,
    alerts: true,
    currentPlan: true,
    scheduledChange: true,
    changeCorePlan: true,
    checkoutLink: true,
    paymentPolicy: true,
    currentPlanCancelAction: true,
    scheduledChangeCancelAction: true
  }
});

const meta = computed(() => toRecord(props.meta));
const state = computed(() => toRecord(props.state));
const actions = computed(() => toRecord(props.actions));

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);

  return {
    header: String(classes.header || "").trim(),
    alerts: String(classes.alerts || "").trim(),
    planRow: String(classes.planRow || "").trim(),
    currentPlanCard: String(classes.currentPlanCard || "").trim(),
    scheduledChangeCard: String(classes.scheduledChangeCard || "").trim(),
    changeCorePlanCard: String(classes.changeCorePlanCard || "").trim(),
    targetPlanField: String(classes.targetPlanField || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);

  return {
    root: String(testIds.root || "billing-plan-client-element"),
    shell: String(testIds.shell || "billing-plan-shell"),
    header: String(testIds.header || "billing-plan-header"),
    alerts: String(testIds.alerts || "billing-plan-alerts"),
    currentPlanCard: String(testIds.currentPlanCard || "billing-plan-current-card"),
    scheduledChangeCard: String(testIds.scheduledChangeCard || "billing-plan-scheduled-card"),
    changeCorePlanCard: String(testIds.changeCorePlanCard || "billing-plan-change-card"),
    targetPlanField: String(testIds.targetPlanField || "billing-plan-target-plan"),
    submitButton: String(testIds.submitButton || "billing-plan-submit"),
    cancelCurrentButton: String(testIds.cancelCurrentButton || "billing-plan-cancel-current"),
    cancelScheduledButton: String(testIds.cancelScheduledButton || "billing-plan-cancel-scheduled"),
    checkoutLink: String(testIds.checkoutLink || "billing-plan-checkout-link")
  };
});

const rootClasses = computed(() => {
  const classes = [
    `billing-plan-client-element--layout-${resolvedVariant.value.layout}`,
    `billing-plan-client-element--surface-${resolvedVariant.value.surface}`,
    `billing-plan-client-element--density-${resolvedVariant.value.density}`,
    `billing-plan-client-element--emphasis-${resolvedVariant.value.emphasis}`
  ];

  const rootClass = String(toRecord(toRecord(props.ui).classes).root || "").trim();
  if (rootClass) {
    classes.push(rootClass);
  }

  return classes;
});

const shellCardProps = computed(() => {
  if (resolvedVariant.value.surface === "plain") {
    return {
      rounded: "0",
      elevation: 0,
      border: false,
      variant: "text"
    };
  }

  return {
    rounded: "lg",
    elevation: 1,
    border: true,
    variant: "elevated"
  };
});

const sectionCardProps = computed(() => {
  if (resolvedVariant.value.surface === "plain") {
    return {
      rounded: "0",
      border: false,
      variant: "text"
    };
  }

  return {
    rounded: "lg",
    border: true,
    variant: "elevated"
  };
});

const planOptions = computed(() => {
  const items = state.value.planOptions;
  return Array.isArray(items) ? items : [];
});

const formatDateOnly = computed(() => {
  const formatter = meta.value.formatDateOnly;
  return typeof formatter === "function" ? formatter : fallbackFormatDateOnly;
});

const formatMoneyMinor = computed(() => {
  const formatter = meta.value.formatMoneyMinor;
  return typeof formatter === "function" ? formatter : fallbackFormatMoneyMinor;
});

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    ...payload
  });
}

async function invokeAction(actionName, domainEventName, payload, callback) {
  emit(domainEventName, payload);
  emitInteraction(domainEventName, payload);
  emit("action:started", {
    action: actionName,
    payload
  });

  try {
    if (typeof callback === "function") {
      await callback();
    }
    emit("action:succeeded", {
      action: actionName,
      payload
    });
  } catch (errorValue) {
    emit("action:failed", {
      action: actionName,
      payload,
      message: String(errorValue?.message || "Action failed")
    });
  }
}

function onUpdateSelectedPlan(value) {
  state.value.selectedPlanCode = String(value || "");
  emitInteraction("plan-change:target-selected", {
    planCode: state.value.selectedPlanCode
  });
}

async function onSubmitPlanChange() {
  const payload = {
    planCode: String(state.value.selectedPlanCode || "").trim()
  };
  await invokeAction("submitPlanChange", "plan-change:submit", payload, actions.value.submitPlanChange);
}

async function onCancelCurrentPlan() {
  const payload = {
    currentPlanCode: String(state.value.currentPlan?.code || "").trim()
  };
  await invokeAction("cancelCurrentPlan", "plan-change:cancel-current", payload, actions.value.cancelCurrentPlan);
}

async function onCancelScheduledPlanChange() {
  const payload = {
    nextPlanCode: String(state.value.nextPlan?.code || "").trim()
  };
  await invokeAction(
    "cancelPendingPlanChange",
    "plan-change:cancel-scheduled",
    payload,
    actions.value.cancelPendingPlanChange
  );
}

function onCheckoutLinkClick() {
  const payload = {
    checkoutUrl: String(state.value.lastCheckoutUrl || "").trim()
  };
  emit("checkout:open", payload);
  emitInteraction("checkout:open", payload);
}
</script>

<style scoped>
.billing-plan-client-element__filters-field {
  min-width: 220px;
  max-width: 340px;
}

.billing-plan-client-element--layout-compact .billing-plan-client-element__body {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}

.billing-plan-client-element--layout-compact .billing-plan-client-element__actions-row {
  gap: 0.5rem;
}

.billing-plan-client-element--surface-plain .billing-plan-client-element__shell {
  border: 0;
  box-shadow: none;
}

.billing-plan-client-element--density-compact :deep(.v-card-item) {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}

.billing-plan-client-element--emphasis-quiet {
  opacity: 0.97;
}
</style>
