import { computed, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import {
  workspaceBillingPlansQueryKey,
  workspaceBillingTimelineQueryKey
} from "../../features/workspaceAdmin/queryKeys.js";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function toTitleCase(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatMoneyMinor(amountMinor, currency = "USD") {
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

function normalizePositiveQuantity(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    return null;
  }
  return parsed;
}

function normalizeProviderPriceId(value) {
  return String(value || "").trim();
}

function resolvePlanDisplayName(plan) {
  return String(plan?.name || plan?.code || "Plan").trim();
}

export function useWorkspaceBillingView() {
  const workspaceStore = useWorkspaceStore();
  const page = ref(1);
  const pageSize = ref(20);
  const sourceFilter = ref("");
  const operationKeyFilter = ref("");
  const providerEventIdFilter = ref("");
  const activeTab = ref("purchase");

  const selectedPlanCode = ref("");
  const selectedCatalogPriceId = ref("");
  const selectedCatalogQuantity = ref(1);
  const oneOffMode = ref("catalog");
  const adHocName = ref("");
  const adHocAmountMinor = ref("");
  const adHocQuantity = ref(1);
  const checkoutLoading = ref(false);
  const paymentLinkLoading = ref(false);
  const actionError = ref("");
  const actionSuccess = ref("");
  const lastCheckoutUrl = ref("");
  const lastPaymentLinkUrl = ref("");

  const workspaceSlug = computed(() => {
    return String(workspaceStore.activeWorkspace?.slug || workspaceStore.activeWorkspaceSlug || "").trim();
  });
  const workspaceBillingPath = computed(() => workspaceStore.workspacePath("/billing"));

  const plansQuery = useQuery({
    queryKey: computed(() => workspaceBillingPlansQueryKey(workspaceSlug.value)),
    queryFn: () => api.billing.listPlans(),
    enabled: computed(() => Boolean(workspaceSlug.value))
  });

  const timelineQuery = useQuery({
    queryKey: computed(() =>
      workspaceBillingTimelineQueryKey(workspaceSlug.value, {
        page: page.value,
        pageSize: pageSize.value,
        source: sourceFilter.value,
        operationKey: operationKeyFilter.value,
        providerEventId: providerEventIdFilter.value
      })
    ),
    queryFn: () =>
      api.billing.getTimeline({
        page: page.value,
        pageSize: pageSize.value,
        source: sourceFilter.value || undefined,
        operationKey: operationKeyFilter.value || undefined,
        providerEventId: providerEventIdFilter.value || undefined
      }),
    enabled: computed(() => Boolean(workspaceSlug.value))
  });

  const plans = computed(() => (Array.isArray(plansQuery.data.value?.plans) ? plansQuery.data.value.plans : []));
  const activePlans = computed(() => plans.value.filter((plan) => plan && plan.isActive !== false));
  const selectedPlan = computed(() => {
    const explicit = activePlans.value.find((plan) => String(plan.code || "") === String(selectedPlanCode.value || ""));
    if (explicit) {
      return explicit;
    }
    return activePlans.value[0] || null;
  });

  const selectedPlanCorePrice = computed(() => {
    const plan = selectedPlan.value;
    if (!plan) {
      return null;
    }
    return plan.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
  });

  const catalogItems = computed(() => {
    const items = [];
    const seen = new Set();
    for (const plan of activePlans.value) {
      const corePrice = plan?.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
      if (!corePrice) {
        continue;
      }

      const providerPriceId = normalizeProviderPriceId(corePrice.providerPriceId);
      if (!providerPriceId || seen.has(providerPriceId)) {
        continue;
      }
      seen.add(providerPriceId);

      items.push({
        value: providerPriceId,
        title: resolvePlanDisplayName(plan),
        subtitle: formatMoneyMinor(corePrice.unitAmountMinor, corePrice.currency),
        currency: String(corePrice.currency || "USD"),
        amountMinor: Number(corePrice.unitAmountMinor || 0),
        planCode: String(plan.code || "")
      });
    }
    return items;
  });

  const planOptions = computed(() =>
    activePlans.value.map((plan) => ({
      value: String(plan.code || ""),
      title: String(plan.name || plan.code || "Plan")
    }))
  );

  watch(
    planOptions,
    (nextOptions) => {
      if (!Array.isArray(nextOptions) || nextOptions.length < 1) {
        selectedPlanCode.value = "";
        return;
      }

      const currentCode = String(selectedPlanCode.value || "");
      if (nextOptions.some((entry) => entry.value === currentCode)) {
        return;
      }
      selectedPlanCode.value = String(nextOptions[0].value || "");
    },
    {
      immediate: true
    }
  );

  watch(
    catalogItems,
    (nextItems) => {
      if (!Array.isArray(nextItems) || nextItems.length < 1) {
        selectedCatalogPriceId.value = "";
        return;
      }

      const current = String(selectedCatalogPriceId.value || "");
      if (nextItems.some((item) => item.value === current)) {
        return;
      }
      selectedCatalogPriceId.value = String(nextItems[0].value || "");
    },
    {
      immediate: true
    }
  );

  const entries = computed(() => (Array.isArray(timelineQuery.data.value?.entries) ? timelineQuery.data.value.entries : []));
  const loading = computed(() => timelineQuery.isFetching.value);
  const error = computed(() =>
    String(timelineQuery.error.value?.message || plansQuery.error.value?.message || "")
  );
  const hasMore = computed(() => Boolean(timelineQuery.data.value?.hasMore));

  function resetActionFeedback() {
    actionError.value = "";
    actionSuccess.value = "";
  }

  function buildWorkspaceBillingPath(searchParams = {}) {
    const basePath = String(workspaceBillingPath.value || "").trim() || "/billing";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams || {})) {
      if (value == null) {
        continue;
      }
      const normalizedValue = String(value).trim();
      if (!normalizedValue) {
        continue;
      }
      params.set(key, normalizedValue);
    }
    const queryString = params.toString();
    return queryString ? `${basePath}?${queryString}` : basePath;
  }

  async function refresh() {
    await Promise.all([timelineQuery.refetch(), plansQuery.refetch()]);
  }

  async function applyFilters() {
    page.value = 1;
    await refresh();
  }

  async function setPageSize(nextPageSize) {
    const parsed = Number(nextPageSize);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return;
    }

    pageSize.value = parsed;
    page.value = 1;
  }

  async function goPreviousPage() {
    if (loading.value || page.value <= 1) {
      return;
    }

    page.value -= 1;
  }

  async function goNextPage() {
    if (loading.value || !hasMore.value) {
      return;
    }

    page.value += 1;
  }

  async function startSubscriptionCheckout() {
    resetActionFeedback();
    const selectedPlanCodeValue = String(selectedPlanCode.value || "").trim();
    if (!selectedPlanCodeValue) {
      actionError.value = "Select a plan before starting checkout.";
      return;
    }

    checkoutLoading.value = true;
    try {
      const checkoutPayload = {
        planCode: selectedPlanCodeValue,
        successPath: buildWorkspaceBillingPath({ checkout: "success" }),
        cancelPath: buildWorkspaceBillingPath({ checkout: "cancel" })
      };

      const response = await api.billing.startCheckout(checkoutPayload);

      const checkoutUrl = String(response?.checkoutSession?.checkoutUrl || "").trim();
      lastCheckoutUrl.value = checkoutUrl;
      actionSuccess.value = checkoutUrl
        ? "Checkout session created. Redirecting to provider checkout..."
        : "Checkout session created.";
      if (checkoutUrl && typeof window !== "undefined" && typeof window.location?.assign === "function") {
        window.location.assign(checkoutUrl);
      }
    } catch (errorValue) {
      actionError.value = String(errorValue?.message || "Failed to start subscription checkout.");
    } finally {
      checkoutLoading.value = false;
    }
  }

  async function createCatalogPaymentLink() {
    resetActionFeedback();
    const selectedPriceId = normalizeProviderPriceId(selectedCatalogPriceId.value);
    if (!selectedPriceId) {
      actionError.value = "Select a catalog item before creating a payment link.";
      return;
    }

    const quantity = normalizePositiveQuantity(selectedCatalogQuantity.value);
    if (!quantity) {
      actionError.value = "Catalog quantity must be an integer between 1 and 10,000.";
      return;
    }

    paymentLinkLoading.value = true;
    try {
      const response = await api.billing.createPaymentLink({
        successPath: buildWorkspaceBillingPath({ payment: "success" }),
        lineItems: [
          {
            priceId: selectedPriceId,
            quantity
          }
        ]
      });
      const paymentLinkUrl = String(response?.paymentLink?.url || "").trim();
      lastPaymentLinkUrl.value = paymentLinkUrl;
      actionSuccess.value = paymentLinkUrl ? "Payment link created." : "Payment link created.";
    } catch (errorValue) {
      actionError.value = String(errorValue?.message || "Failed to create catalog payment link.");
    } finally {
      paymentLinkLoading.value = false;
    }
  }

  async function createAdHocPaymentLink() {
    resetActionFeedback();
    const name = String(adHocName.value || "").trim();
    const amountMinor = Number(adHocAmountMinor.value);
    const quantity = normalizePositiveQuantity(adHocQuantity.value);

    if (!name) {
      actionError.value = "Ad-hoc item name is required.";
      return;
    }
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 99999999) {
      actionError.value = "Ad-hoc amount must be an integer between 1 and 99,999,999.";
      return;
    }
    if (!quantity) {
      actionError.value = "Ad-hoc quantity must be an integer between 1 and 10,000.";
      return;
    }

    paymentLinkLoading.value = true;
    try {
      const response = await api.billing.createPaymentLink({
        successPath: buildWorkspaceBillingPath({ payment: "success" }),
        oneOff: {
          name,
          amountMinor,
          quantity
        }
      });
      const paymentLinkUrl = String(response?.paymentLink?.url || "").trim();
      lastPaymentLinkUrl.value = paymentLinkUrl;
      actionSuccess.value = paymentLinkUrl ? "Ad-hoc payment link created." : "Ad-hoc payment link created.";
    } catch (errorValue) {
      actionError.value = String(errorValue?.message || "Failed to create ad-hoc payment link.");
    } finally {
      paymentLinkLoading.value = false;
    }
  }

  return {
    meta: {
      tabs: [
        { value: "purchase", title: "Purchase" },
        { value: "timeline", title: "Timeline" }
      ],
      pageSizeOptions: [20, 50, 100],
      sourceOptions: [
        { title: "All sources", value: "" },
        { title: "Requests", value: "idempotency" },
        { title: "Checkout sessions", value: "checkout_session" },
        { title: "Subscriptions", value: "subscription" },
        { title: "Invoices", value: "invoice" },
        { title: "Payments", value: "payment" },
        { title: "Payment method sync", value: "payment_method_sync" },
        { title: "Webhooks", value: "webhook" },
        { title: "Outbox jobs", value: "outbox_job" },
        { title: "Remediations", value: "remediation" }
      ],
      oneOffModeOptions: [
        {
          title: "Catalog",
          value: "catalog"
        },
        {
          title: "Ad-hoc",
          value: "ad_hoc"
        }
      ],
      formatDateTime,
      toTitleCase,
      formatMoneyMinor
    },
    state: reactive({
      activeTab,
      planOptions,
      selectedPlanCode,
      selectedPlan,
      selectedPlanCorePrice,
      catalogItems,
      selectedCatalogPriceId,
      selectedCatalogQuantity,
      oneOffMode,
      adHocName,
      adHocAmountMinor,
      adHocQuantity,
      checkoutLoading,
      paymentLinkLoading,
      actionError,
      actionSuccess,
      lastCheckoutUrl,
      lastPaymentLinkUrl,
      entries,
      loading,
      error,
      page,
      pageSize,
      hasMore,
      sourceFilter,
      operationKeyFilter,
      providerEventIdFilter
    }),
    actions: {
      refresh,
      applyFilters,
      setPageSize,
      goPreviousPage,
      goNextPage,
      startSubscriptionCheckout,
      createCatalogPaymentLink,
      createAdHocPaymentLink
    }
  };
}
