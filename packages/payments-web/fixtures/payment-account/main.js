import { createApp, h, reactive } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import PaymentAccount from "../../src/client/components/PaymentAccount.vue";

// Controlled component inputs only: no server, identity exchange or provider calls.
const state = reactive({
  account: { balance: 1200, features: ["Scheduling", "Customer reminders"], subscriptions: [], hasCustomer: true },
  plans: [{ id: "studio", name: "Studio plan", priceLabel: "$20.00 / month", features: ["Scheduling", "Customer reminders"], renewalCredits: 1200, available: true }],
  canManage: true, canReadHistory: true, pending: false, loading: false, loadError: "",
  historyLoading: false, historyError: "",
  history: { collection: "transactions", items: [{ id: "invoice_" + "long_reference_".repeat(12), kind: "invoice", status: "open", createdAt: "2026-09-12T12:00:00Z", totalLabel: "$20.00", paidLabel: "$0.00" }], nextCursor: "next-1" },
  locale: "en-US"
});
window.paymentFixture = { state, events: [] };
const record = (name) => (value) => window.paymentFixture.events.push({ name, value });
createApp({
  setup: () => () => h(components.VApp, {}, { default: () => h(components.VMain, {}, {
    default: () => h("div", { style: "padding:16px;max-width:1200px;margin:auto" }, [
      h(PaymentAccount, { ...state, onCheckout: record("checkout"), onPortal: record("portal"), onRefresh: record("refresh"), onHistory: record("history"), "onRetry-history": record("retry-history") })
    ])
  }) })
}).use(createVuetify({ components, directives })).mount("#app");
