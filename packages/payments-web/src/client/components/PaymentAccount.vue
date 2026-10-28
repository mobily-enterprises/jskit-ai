<script setup>
import { computed } from "vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  plans: { type: Array, default: () => [] },
  account: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: "" },
  pending: { type: Boolean, default: false },
  canManage: { type: Boolean, default: false },
  canReadHistory: { type: Boolean, default: false },
  history: { type: Object, default: null },
  historyLoading: { type: Boolean, default: false },
  historyError: { type: String, default: "" },
  locale: { type: String, default: undefined }
});
const emit = defineEmits(["refresh", "checkout", "portal", "history", "retry-history"]);
const subscriptions = computed(() => props.account?.subscriptions ?? []);
const hasSubscription = computed(() => subscriptions.value.some((item) =>
  !["canceled", "incomplete_expired"].includes(item.status)));
const disabled = computed(() => props.pending || props.loading || Boolean(props.loadError) || !props.account || !props.canManage);
const jskitText = useJskitText();
const { t } = jskitText;
const statusKeys = {
  active: "jskit.payments.account.status.active",
  trialing: "jskit.payments.account.status.trialing",
  past_due: "jskit.payments.account.status.pastDue",
  paused: "jskit.payments.account.status.paused",
  canceled: "jskit.payments.account.status.canceled",
  unpaid: "jskit.payments.account.status.unpaid",
  incomplete: "jskit.payments.account.status.incomplete",
  incomplete_expired: "jskit.payments.account.status.incompleteExpired"
};
const historyKindKeys = {
  invoice: "jskit.payments.account.history.invoice",
  transaction: "jskit.payments.account.history.transaction"
};
const historyTitle = (item) =>
  t(Object.hasOwn(historyKindKeys, item.kind) ? historyKindKeys[item.kind] : "jskit.payments.account.history.subscription", { id: item.id });
const historyTotal = (item) => {
  const total = item.totalLabel ?? t("jskit.payments.account.history.totalPending");
  return item.paidLabel
    ? t("jskit.payments.account.history.totalAndPaid", { total, paid: item.paidLabel })
    : t("jskit.payments.account.history.total", { total });
};
const statusLabel = (status) => Object.hasOwn(statusKeys, status) ? t(statusKeys[status]) : status;
// An explicit locale prop wins; otherwise numbers and dates follow the app's language.
const locale = () => props.locale ?? jskitText.locale;
const number = (value) => new Intl.NumberFormat(locale()).format(value);
const date = (value) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: "UTC" }).format(value);
const planName = (id) => props.plans.find((plan) => plan.id === id)?.name ?? id;
function checkout(plan) {
  if (!disabled.value && !hasSubscription.value && plan.available === true) emit("checkout", plan.id);
}
function loadHistory(collection, after = null) {
  if (props.canReadHistory && !props.historyLoading && !props.loading) emit("history", { collection, after });
}
</script>

<template>
  <section class="payment-account" :aria-label="t('jskit.payments.account.region')" :aria-busy="loading || pending">
    <v-skeleton-loader v-if="loading && !account" type="article, list-item-two-line, actions" />
    <div v-else-if="loadError" role="alert">
      <p>{{ loadError }}</p>
      <v-btn variant="tonal" :disabled="loading" @click="emit('refresh')">{{ t('jskit.payments.account.retryDetails') }}</v-btn>
    </div>
    <template v-else-if="account">
      <dl class="payment-account__summary">
        <div><dt>{{ t('jskit.payments.account.availableCredits') }}</dt><dd>{{ number(account.balance) }}</dd></div>
        <div><dt>{{ t('jskit.payments.account.includedFeatures') }}</dt><dd>{{ account.features.length ? account.features.join(', ') : t('jskit.payments.account.noPaidFeatures') }}</dd></div>
      </dl>
      <ul v-if="subscriptions.length" class="payment-account__subscriptions" :aria-label="t('jskit.payments.account.subscriptions')">
        <li v-for="subscription in subscriptions" :key="subscription.id">
          <strong>{{ planName(subscription.planId) }}</strong>
          <span>{{ statusLabel(subscription.status) }}</span>
          <span v-if="subscription.periodEnd > 0">{{ t('jskit.payments.account.periodEnd', { date: date(subscription.periodEnd) }) }}</span>
        </li>
      </ul>
      <p v-else>{{ t('jskit.payments.account.noSubscription') }}</p>
      <div class="payment-account__actions">
        <v-btn v-if="account.hasCustomer" variant="tonal" :disabled="disabled" @click="emit('portal')">{{ t('jskit.payments.account.manageBilling') }}</v-btn>
        <v-btn variant="text" :disabled="loading || pending" @click="emit('refresh')">{{ t('jskit.payments.account.refreshDetails') }}</v-btn>
      </div>
      <p v-if="!canManage">{{ t('jskit.payments.account.adminManages') }}</p>
      <p v-else-if="hasSubscription">{{ t('jskit.payments.account.useManageBilling') }}</p>
      <p>{{ t('jskit.payments.account.confirmationNote') }}</p>
      <ul v-if="plans.length" class="payment-account__plans" :aria-label="t('jskit.payments.account.availablePlans')">
        <li v-for="plan in plans" :key="plan.id" class="payment-account__plan">
          <strong>{{ plan.name }}</strong>
          <p>{{ plan.priceLabel }}</p>
          <ul v-if="plan.features.length"><li v-for="feature in plan.features" :key="feature">{{ feature }}</li></ul>
          <p>{{ t('jskit.payments.account.renewalCredits', { credits: number(plan.renewalCredits), count: plan.renewalCredits }) }}</p>
          <v-btn variant="flat" color="primary" :disabled="disabled || hasSubscription || plan.available !== true" :aria-label="t('jskit.payments.account.choosePlanNamed', { plan: plan.name })" @click="checkout(plan)">{{ t('jskit.payments.account.choosePlan') }}</v-btn>
          <p v-if="plan.available !== true">{{ t('jskit.payments.account.notAvailableForCheckout') }}</p>
        </li>
      </ul>
      <p v-else>{{ t('jskit.payments.account.noPlans') }}</p>
      <section v-if="canReadHistory" :aria-label="t('jskit.payments.account.history.region')" :aria-busy="historyLoading">
        <div class="payment-account__actions">
          <v-btn variant="tonal" :disabled="historyLoading || loading" @click="loadHistory('transactions')">{{ t('jskit.payments.account.history.viewTransactions') }}</v-btn>
          <v-btn variant="tonal" :disabled="historyLoading || loading" @click="loadHistory('subscriptions')">{{ t('jskit.payments.account.history.viewSubscriptions') }}</v-btn>
        </div>
        <v-skeleton-loader v-if="historyLoading" type="list-item-three-line, list-item-three-line" />
        <div v-else-if="historyError" role="alert">
          <p>{{ historyError }}</p>
          <v-btn variant="text" @click="emit('retry-history')">{{ t('jskit.payments.account.history.retry') }}</v-btn>
        </div>
        <template v-else-if="history">
          <p v-if="history.collection === 'transactions'">{{ t('jskit.payments.account.history.unpaidNote') }}</p>
          <v-list v-if="history.items.length" lines="three" :aria-label="t('jskit.payments.account.history.records')">
            <v-list-item v-for="item in history.items" :key="item.id">
              <v-list-item-title>{{ historyTitle(item) }}</v-list-item-title>
              <v-list-item-subtitle>{{ t('jskit.payments.account.history.statusAndDate', { status: statusLabel(item.status), date: date(Date.parse(item.createdAt)) }) }}</v-list-item-subtitle>
              <p v-if="item.kind !== 'subscription'">{{ historyTotal(item) }}</p>
            </v-list-item>
          </v-list>
          <p v-else>{{ t('jskit.payments.account.history.empty') }}</p>
          <v-btn v-if="history.nextCursor" variant="text" @click="loadHistory(history.collection, history.nextCursor)">{{ t('jskit.payments.account.history.nextPage') }}</v-btn>
        </template>
      </section>
    </template>
    <p v-else>{{ t('jskit.payments.account.unavailable') }}</p>
  </section>
</template>

<style scoped>
.payment-account { min-width: 0; overflow-wrap: anywhere; }
.payment-account__summary { display: flex; flex-wrap: wrap; gap: 1rem 2rem; margin: 0 0 1rem; }
.payment-account__summary dt { font-weight: 600; }
.payment-account__summary dd { margin: .25rem 0 0; }
.payment-account__subscriptions { list-style: none; padding: 0; }
.payment-account__subscriptions li { display: flex; flex-wrap: wrap; gap: .5rem 1rem; padding-block: .5rem; }
.payment-account__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.payment-account__plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 1rem; padding: 0; list-style: none; }
.payment-account__plan { min-width: 0; padding: 1rem; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; }
.payment-account :deep(.v-list-item-title), .payment-account :deep(.v-list-item-subtitle) { white-space: normal; overflow-wrap: anywhere; }
.payment-account :deep(.v-btn) { min-height: 48px; max-width: 100%; height: auto; white-space: normal; }
.payment-account :deep(.v-btn__content) { white-space: normal; }
</style>
