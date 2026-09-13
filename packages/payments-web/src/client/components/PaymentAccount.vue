<script setup>
import { computed } from "vue";

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
const statuses = {
  active: "Active", trialing: "Trial", past_due: "Payment overdue", paused: "Paused",
  canceled: "Canceled", unpaid: "Unpaid", incomplete: "Payment incomplete",
  incomplete_expired: "Payment expired"
};
const number = (value) => new Intl.NumberFormat(props.locale).format(value);
const date = (value) => new Intl.DateTimeFormat(props.locale, { dateStyle: "medium", timeZone: "UTC" }).format(value);
const planName = (id) => props.plans.find((plan) => plan.id === id)?.name ?? id;
function checkout(plan) {
  if (!disabled.value && !hasSubscription.value && plan.available === true) emit("checkout", plan.id);
}
function loadHistory(collection, after = null) {
  if (props.canReadHistory && !props.historyLoading && !props.loading) emit("history", { collection, after });
}
</script>

<template>
  <section class="payment-account" aria-label="Subscription and billing" :aria-busy="loading || pending">
    <v-skeleton-loader v-if="loading && !account" type="article, list-item-two-line, actions" />
    <div v-else-if="loadError" role="alert">
      <p>{{ loadError }}</p>
      <v-btn variant="tonal" :disabled="loading" @click="emit('refresh')">Retry billing details</v-btn>
    </div>
    <template v-else-if="account">
      <dl class="payment-account__summary">
        <div><dt>Available credits</dt><dd>{{ number(account.balance) }}</dd></div>
        <div><dt>Included features</dt><dd>{{ account.features.length ? account.features.join(', ') : 'No paid features active' }}</dd></div>
      </dl>
      <ul v-if="subscriptions.length" class="payment-account__subscriptions" aria-label="Subscriptions">
        <li v-for="subscription in subscriptions" :key="subscription.id">
          <strong>{{ planName(subscription.planId) }}</strong>
          <span>{{ statuses[subscription.status] ?? subscription.status }}</span>
          <span v-if="subscription.periodEnd > 0">Period end: {{ date(subscription.periodEnd) }} (UTC)</span>
        </li>
      </ul>
      <p v-else>No subscription yet.</p>
      <div class="payment-account__actions">
        <v-btn v-if="account.hasCustomer" variant="tonal" :disabled="disabled" @click="emit('portal')">Manage billing</v-btn>
        <v-btn variant="text" :disabled="loading || pending" @click="emit('refresh')">Refresh billing details</v-btn>
      </div>
      <p v-if="!canManage">A billing administrator can manage this account.</p>
      <p v-else-if="hasSubscription">Use Manage billing to update your subscription or payment details.</p>
      <p>Access and credits update after payment confirmation. Returning from checkout alone does not activate a plan.</p>
      <ul v-if="plans.length" class="payment-account__plans" aria-label="Available plans">
        <li v-for="plan in plans" :key="plan.id" class="payment-account__plan">
          <strong>{{ plan.name }}</strong>
          <p>{{ plan.priceLabel }}</p>
          <ul v-if="plan.features.length"><li v-for="feature in plan.features" :key="feature">{{ feature }}</li></ul>
          <p>{{ number(plan.renewalCredits) }} credits per paid renewal; unused renewal credits expire at period end.</p>
          <v-btn variant="flat" color="primary" :disabled="disabled || hasSubscription || plan.available !== true" :aria-label="`Choose ${plan.name}`" @click="checkout(plan)">Choose plan</v-btn>
          <p v-if="plan.available !== true">Not available for checkout yet.</p>
        </li>
      </ul>
      <p v-else>No plans are available yet.</p>
      <section v-if="canReadHistory" aria-label="Billing history" :aria-busy="historyLoading">
        <div class="payment-account__actions">
          <v-btn variant="tonal" :disabled="historyLoading || loading" @click="loadHistory('transactions')">View invoices and transactions</v-btn>
          <v-btn variant="tonal" :disabled="historyLoading || loading" @click="loadHistory('subscriptions')">View subscription history</v-btn>
        </div>
        <v-skeleton-loader v-if="historyLoading" type="list-item-three-line, list-item-three-line" />
        <div v-else-if="historyError" role="alert">
          <p>{{ historyError }}</p>
          <v-btn variant="text" @click="emit('retry-history')">Retry billing history</v-btn>
        </div>
        <template v-else-if="history">
          <p v-if="history.collection === 'transactions'">Invoices and transactions include unpaid records. Their totals do not confirm payment.</p>
          <v-list v-if="history.items.length" lines="three" aria-label="Provider billing records">
            <v-list-item v-for="item in history.items" :key="item.id">
              <v-list-item-title>{{ item.kind === 'invoice' ? 'Invoice' : item.kind === 'transaction' ? 'Transaction' : 'Subscription' }} {{ item.id }}</v-list-item-title>
              <v-list-item-subtitle>{{ statuses[item.status] ?? item.status }} · {{ date(Date.parse(item.createdAt)) }} (UTC)</v-list-item-subtitle>
              <p v-if="item.kind !== 'subscription'">Total: {{ item.totalLabel ?? 'Not available yet' }}<span v-if="item.paidLabel"> · Paid: {{ item.paidLabel }}</span></p>
            </v-list-item>
          </v-list>
          <p v-else>No billing records found.</p>
          <v-btn v-if="history.nextCursor" variant="text" @click="loadHistory(history.collection, history.nextCursor)">Next billing page</v-btn>
        </template>
      </section>
    </template>
    <p v-else>Billing details are not available yet.</p>
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
