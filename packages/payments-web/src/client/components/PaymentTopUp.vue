<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  // The validated configuration's topUps: { currency, minimumAmount, maximumAmount }, amounts in the currency's
  // smallest unit.
  offer: { type: Object, required: true },
  // Suggested amounts, in the currency's smallest unit.
  presets: { type: Array, default: () => [] },
  canTopUp: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  // The top-up the server answered: { topUpId, status, amount, currency, url }; null before one starts.
  topUp: { type: Object, default: null },
  // How the payment page was opened (openPaymentPage's answer): "opened", "blocked" or "redirected"; "" when it was
  // not opened from this page, as on the return page.
  paymentPage: { type: String, default: "" },
  locale: { type: String, default: undefined }
});
const emit = defineEmits(["top-up", "open-payment", "check", "dismiss"]);
const jskitText = useJskitText();
const { t } = jskitText;
// An explicit locale prop wins; otherwise amounts follow the app's language.
const locale = () => props.locale ?? jskitText.locale;
const currencyFormat = () => new Intl.NumberFormat(locale(), { style: "currency", currency: props.offer.currency });
// The currency's decimal places: 2 for USD, 0 for JPY.
const fractionDigits = () => currencyFormat().resolvedOptions().maximumFractionDigits;
const money = (minor) => currencyFormat().format(minor / 10 ** fractionDigits());
const entered = ref("");

// The amount typed, in the currency's smallest unit, read exactly from its digits ("12.5" is 1250 cents), or null.
function parseAmount(text) {
  const digits = fractionDigits();
  const match = /^(\d{1,9})(?:[.,](\d*))?$/u.exec(text.trim());
  if (!match || (match[2] ?? "").length > digits) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
}
const amount = computed(() => parseAmount(entered.value));
const inRange = computed(() => amount.value !== null && amount.value >= props.offer.minimumAmount && amount.value <= props.offer.maximumAmount);
const limits = computed(() => ({ minimum: money(props.offer.minimumAmount), maximum: money(props.offer.maximumAmount) }));
const amountErrors = computed(() => entered.value.trim() && !inRange.value ? [t("jskit.payments.topUp.amountInvalid", limits.value)] : []);
const status = computed(() => props.topUp?.status ?? "");
const waiting = computed(() => ["starting", "open"].includes(status.value));
const topUpAmount = computed(() => ({ amount: props.topUp ? money(props.topUp.amount) : "" }));

function choose(minor) {
  entered.value = (minor / 10 ** fractionDigits()).toFixed(fractionDigits());
}
function submit() {
  if (props.canTopUp && !props.pending && inRange.value) emit("top-up", amount.value);
}
// Back from the payment tab: the person paid there or gave up, so the server is asked again.
function returned() {
  if (waiting.value && props.paymentPage === "opened" && !props.pending) emit("check");
}
onMounted(() => window.addEventListener("focus", returned));
onBeforeUnmount(() => window.removeEventListener("focus", returned));
</script>

<template>
  <section class="payment-top-up" :aria-label="t('jskit.payments.topUp.region')" :aria-busy="pending">
    <template v-if="!topUp">
      <div v-if="presets.length" class="payment-top-up__actions">
        <v-btn v-for="preset in presets" :key="preset" variant="tonal" :disabled="!canTopUp || pending" @click="choose(preset)">{{ money(preset) }}</v-btn>
      </div>
      <v-text-field
        v-model="entered"
        inputmode="decimal"
        :label="t('jskit.payments.topUp.amountLabel', { currency: offer.currency })"
        :hint="t('jskit.payments.topUp.amountHint', limits)"
        persistent-hint
        :error-messages="amountErrors"
        :disabled="!canTopUp || pending"
        @keydown.enter="submit"
      />
      <v-btn variant="flat" color="primary" :disabled="!canTopUp || pending || !inRange" @click="submit">{{ t('jskit.payments.topUp.submit') }}</v-btn>
      <p v-if="!canTopUp">{{ t('jskit.payments.topUp.notAllowed') }}</p>
    </template>
    <div v-else-if="waiting && paymentPage === 'redirected'" role="status">
      <p>{{ t('jskit.payments.topUp.redirecting') }}</p>
    </div>
    <div v-else-if="waiting && paymentPage === 'opened'" role="status">
      <p><strong>{{ t('jskit.payments.topUp.waiting') }}</strong></p>
      <p>{{ t('jskit.payments.topUp.waitingNote', topUpAmount) }}</p>
      <div class="payment-top-up__actions">
        <v-btn variant="flat" color="primary" :disabled="pending" @click="emit('check')">{{ t('jskit.payments.topUp.check') }}</v-btn>
        <v-btn variant="tonal" :disabled="pending || !topUp.url" @click="emit('open-payment')">{{ t('jskit.payments.topUp.openAgain') }}</v-btn>
        <v-btn variant="text" :disabled="pending" @click="emit('dismiss')">{{ t('jskit.payments.topUp.cancel') }}</v-btn>
      </div>
    </div>
    <div v-else-if="waiting" role="status">
      <p>{{ paymentPage === 'blocked' ? t('jskit.payments.topUp.blocked') : t('jskit.payments.topUp.notComplete', topUpAmount) }}</p>
      <div class="payment-top-up__actions">
        <v-btn variant="flat" color="primary" :disabled="pending || !topUp.url" @click="emit('open-payment')">{{ t('jskit.payments.topUp.openPayment') }}</v-btn>
        <v-btn variant="tonal" :disabled="pending" @click="emit('check')">{{ t('jskit.payments.topUp.check') }}</v-btn>
        <v-btn variant="text" :disabled="pending" @click="emit('dismiss')">{{ t('jskit.payments.topUp.cancel') }}</v-btn>
      </div>
    </div>
    <div v-else-if="status === 'processing'" role="status">
      <p>{{ t('jskit.payments.topUp.processing', topUpAmount) }}</p>
      <div class="payment-top-up__actions">
        <v-btn variant="tonal" :disabled="pending" @click="emit('check')">{{ t('jskit.payments.topUp.check') }}</v-btn>
        <v-btn variant="text" :disabled="pending" @click="emit('dismiss')">{{ t('jskit.payments.topUp.done') }}</v-btn>
      </div>
    </div>
    <div v-else-if="status === 'paid'" role="status">
      <p>{{ t('jskit.payments.topUp.paid', topUpAmount) }}</p>
      <v-btn variant="tonal" :disabled="pending" @click="emit('dismiss')">{{ t('jskit.payments.topUp.again') }}</v-btn>
    </div>
    <div v-else role="alert">
      <p>{{ status === 'expired' ? t('jskit.payments.topUp.expired', topUpAmount) : t('jskit.payments.topUp.failed', topUpAmount) }}</p>
      <v-btn variant="tonal" :disabled="pending" @click="emit('dismiss')">{{ t('jskit.payments.topUp.tryAgain') }}</v-btn>
    </div>
  </section>
</template>

<style scoped>
.payment-top-up { display: grid; gap: 1rem; min-width: 0; overflow-wrap: anywhere; }
.payment-top-up p { margin: 0; }
.payment-top-up__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.payment-top-up :deep(.v-btn) { min-height: 48px; max-width: 100%; height: auto; white-space: normal; }
.payment-top-up :deep(.v-btn__content) { white-space: normal; }
</style>
