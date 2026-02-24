<template>
  <section class="billing-commerce-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-row dense class="mt-4" :class="uiClasses.row">
      <v-col v-if="resolvedFeatures.oneOffPurchases" cols="12" lg="7">
        <v-card
          rounded="lg"
          border
          class="h-100 billing-commerce-one-off-card"
          :class="uiClasses.oneOffCard"
          :data-testid="uiTestIds.oneOffCard"
        >
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.oneOffPurchasesTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.oneOffPurchasesSubtitle }}</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div v-if="state.catalogItems.length > 0" class="one-off-grid d-grid ga-3 mb-3">
              <button
                v-for="item in state.catalogItems"
                :key="item.value"
                type="button"
                class="one-off-tile d-grid text-left"
                :disabled="state.paymentLinkLoading"
                @click="onBuyCatalogItem(item)"
              >
                <span class="one-off-tile__name">{{ item.title }}</span>
                <span class="one-off-tile__price">{{ item.subtitle }}</span>
                <span class="one-off-tile__meta">
                  <template v-if="state.buyingCatalogPriceId === item.value && state.paymentLinkLoading">
                    {{ copyText.openingCheckout }}
                  </template>
                  <template v-else>{{ copyText.buyNow }}</template>
                </span>
              </button>
            </div>
            <div v-else class="text-body-2 text-medium-emphasis mb-3">{{ copyText.oneOffPurchasesEmpty }}</div>

            <a
              v-if="resolvedFeatures.paymentLink && state.lastPaymentLinkUrl"
              :href="state.lastPaymentLinkUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="onPaymentLinkOpen"
            >
              {{ copyText.openPaymentLink }}
            </a>
          </v-card-text>
          <slot name="one-off-extra" :meta="meta" :state="state" :actions="actions" />
        </v-card>
      </v-col>

      <v-col v-if="resolvedFeatures.purchaseHistory" cols="12" lg="5">
        <v-card
          rounded="lg"
          border
          class="h-100 billing-commerce-purchase-history-card"
          :class="uiClasses.purchaseHistoryCard"
          :data-testid="uiTestIds.purchaseHistoryCard"
        >
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.purchaseHistoryTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.purchaseHistorySubtitle }}</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div v-if="state.purchasesError" class="text-body-2 text-error mb-2">
              {{ state.purchasesError }}
            </div>
            <template v-if="state.purchasesLoading">
              <v-skeleton-loader type="text, list-item-two-line@3" />
            </template>
            <v-list v-else-if="state.purchaseItems.length > 0" density="compact" lines="two" class="pa-0">
              <v-list-item v-for="purchase in state.purchaseItems" :key="purchase.id">
                <template #title>{{ purchase.title }}</template>
                <template #subtitle>
                  {{ formatDateOnly(purchase.purchasedAt) }} · {{ purchase.kindLabel }}
                </template>
                <template #append>
                  <div class="text-body-2 font-weight-semibold text-no-wrap">
                    {{
                      formatMoneyMinor(
                        Number(purchase.amountMinor || 0) * Number(purchase.quantity || 1),
                        purchase.currency
                      )
                    }}
                  </div>
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-body-2 text-medium-emphasis">{{ copyText.purchaseHistoryEmpty }}</div>
          </v-card-text>
          <slot name="purchase-history-extra" :meta="meta" :state="state" :actions="actions" />
        </v-card>
      </v-col>
    </v-row>

    <v-card
      v-if="resolvedFeatures.usageLimits"
      rounded="lg"
      border
      class="mt-4 billing-commerce-usage-limits-card"
      :class="uiClasses.usageLimitsCard"
      :data-testid="uiTestIds.usageLimitsCard"
    >
      <v-card-item>
        <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.usageLimitsTitle }}</v-card-title>
        <v-card-subtitle>{{ copyText.usageLimitsSubtitle }}</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <div v-if="state.limitationsError" class="text-body-2 text-error mb-2">
          {{ state.limitationsError }}
        </div>
        <template v-if="state.limitationsLoading">
          <v-skeleton-loader type="text@7" />
        </template>
        <div v-else-if="state.limitationItems.length > 0" class="limit-grid d-grid ga-3">
          <v-card v-for="limit in state.limitationItems" :key="limit.code" rounded="lg" variant="tonal" class="limit-card">
            <v-card-item class="pb-1">
              <div class="d-flex align-center ga-2">
                <code>{{ limit.code }}</code>
                <v-chip
                  size="x-small"
                  label
                  :color="limit.overLimit ? 'error' : 'primary'"
                  :variant="limit.overLimit ? 'tonal' : 'outlined'"
                >
                  {{ limit.overLimit ? copyText.overLimit : copyText.withinLimit }}
                </v-chip>
              </div>
            </v-card-item>
            <v-card-text class="pt-1">
              <div class="text-body-2">
                <strong>{{ limit.consumedAmount }}</strong>
                <span class="text-medium-emphasis"> {{ copyText.usedSuffix }}</span>
                <span class="text-medium-emphasis">
                  / <strong>{{ limit.hardLimitAmount ?? limit.grantedAmount }}</strong>
                </span>
                <span v-if="limit.unit" class="text-medium-emphasis"> {{ limit.unit }}</span>
              </div>
              <v-progress-linear
                v-if="limit.usagePercent != null"
                :model-value="limit.usagePercent"
                :color="limit.overLimit ? 'error' : 'primary'"
                height="8"
                rounded
                class="mt-2"
              />
              <div class="text-caption text-medium-emphasis mt-2">
                {{ copyText.remainingLabel }} {{ limit.effectiveAmount }} · {{ copyText.lockLabel }}
                {{ limit.lockState || copyText.noneValue }}
              </div>
              <div v-if="limit.nextChangeAt" class="text-caption text-medium-emphasis">
                {{ copyText.nextChangeLabel }} {{ formatDateOnly(limit.nextChangeAt) }}
              </div>
            </v-card-text>
          </v-card>
        </div>
        <div v-else class="text-body-2 text-medium-emphasis">{{ copyText.usageLimitsEmpty }}</div>
        <div v-if="state.limitationsGeneratedAt" class="text-caption text-medium-emphasis mt-3">
          {{ copyText.generatedPrefix }} {{ formatDateOnly(state.limitationsGeneratedAt) }}
          <span v-if="state.limitationsStale"> ({{ copyText.staleLabel }})</span>
        </div>
      </v-card-text>
      <slot name="usage-limits-extra" :meta="meta" :state="state" :actions="actions" />
    </v-card>

    <slot name="footer-extra" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { computed } from "vue";

const DEFAULT_COPY = Object.freeze({
  oneOffPurchasesTitle: "One-off purchases",
  oneOffPurchasesSubtitle: "Click a product to open checkout.",
  openingCheckout: "Opening checkout...",
  buyNow: "Buy now",
  oneOffPurchasesEmpty: "No one-off products are available yet.",
  openPaymentLink: "Open payment link",
  purchaseHistoryTitle: "Purchase history",
  purchaseHistorySubtitle: "Confirmed charges, including plan invoices and one-off purchases.",
  loadingPurchases: "Loading purchases...",
  purchaseHistoryEmpty: "No confirmed purchases yet.",
  usageLimitsTitle: "Usage limits",
  usageLimitsSubtitle: "Effective entitlement balances for this workspace.",
  loadingLimits: "Loading limits...",
  overLimit: "Over limit",
  withinLimit: "Within limit",
  usedSuffix: "used",
  remainingLabel: "Remaining:",
  lockLabel: "Lock:",
  noneValue: "none",
  nextChangeLabel: "Next change:",
  usageLimitsEmpty: "No limitations are configured.",
  generatedPrefix: "Generated",
  staleLabel: "stale"
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
  "checkout:open"
]);

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

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

const meta = props.meta;
const state = props.state;
const actions = props.actions;

const copyText = computed(() => ({
  ...DEFAULT_COPY,
  ...toRecord(props.copy)
}));

const resolvedVariant = computed(() => {
  const variant = toRecord(props.variant);
  return {
    layout: normalizeVariantValue(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeVariantValue(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeVariantValue(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeVariantValue(variant.tone, ["neutral", "emphasized"], "neutral")
  };
});

const resolvedFeatures = computed(() => {
  const features = toRecord(props.features);
  return {
    oneOffPurchases: features.oneOffPurchases !== false,
    purchaseHistory: features.purchaseHistory !== false,
    usageLimits: features.usageLimits !== false,
    paymentLink: features.paymentLink !== false
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    row: String(classes.row || "").trim(),
    oneOffCard: String(classes.oneOffCard || "").trim(),
    purchaseHistoryCard: String(classes.purchaseHistoryCard || "").trim(),
    usageLimitsCard: String(classes.usageLimitsCard || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "billing-commerce-client-element"),
    oneOffCard: String(testIds.oneOffCard || "billing-commerce-one-off-card"),
    purchaseHistoryCard: String(testIds.purchaseHistoryCard || "billing-commerce-purchase-history-card"),
    usageLimitsCard: String(testIds.usageLimitsCard || "billing-commerce-usage-limits-card")
  };
});

const rootClasses = computed(() => [
  `billing-commerce-client-element--layout-${resolvedVariant.value.layout}`,
  `billing-commerce-client-element--surface-${resolvedVariant.value.surface}`,
  `billing-commerce-client-element--density-${resolvedVariant.value.density}`,
  `billing-commerce-client-element--tone-${resolvedVariant.value.tone}`
]);

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    ...payload
  });
}

async function invokeAction(actionName, payload, callback) {
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
    throw errorValue;
  }
}

function formatDateOnly(value) {
  if (typeof meta.formatDateOnly === "function") {
    return meta.formatDateOnly(value);
  }
  return fallbackFormatDateOnly(value);
}

function formatMoneyMinor(amountMinor, currency) {
  if (typeof meta.formatMoneyMinor === "function") {
    return meta.formatMoneyMinor(amountMinor, currency);
  }
  return fallbackFormatMoneyMinor(amountMinor, currency);
}

async function onBuyCatalogItem(item) {
  const payload = {
    priceId: String(item?.value || "")
  };
  emit("checkout:open", {
    source: "catalog",
    ...payload
  });
  emitInteraction("checkout:open", {
    source: "catalog",
    ...payload
  });
  await invokeAction("buyCatalogItem", payload, () => actions.buyCatalogItem(item));
}

function onPaymentLinkOpen() {
  emitInteraction("payment-link:open", {
    url: String(state.lastPaymentLinkUrl || "")
  });
}
</script>

<style scoped>
.one-off-grid {
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}

.one-off-tile {
  aspect-ratio: 1 / 1;
  width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 14px;
  background: transparent;
  color: inherit;
  padding: 0.9rem;
  grid-template-rows: 1fr auto auto;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    transform 140ms ease;
}

.one-off-tile:hover:not(:disabled),
.one-off-tile:focus-visible:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.05);
  transform: translateY(-1px);
  outline: none;
}

.one-off-tile:disabled {
  cursor: wait;
  opacity: 0.7;
}

.one-off-tile__name {
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.2;
  align-self: start;
}

.one-off-tile__price {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.1;
}

.one-off-tile__meta {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.limit-grid {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.limit-card {
  min-height: 168px;
}
</style>
