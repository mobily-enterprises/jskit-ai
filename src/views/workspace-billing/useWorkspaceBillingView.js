import { computed, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import {
  workspaceBillingPlanStateQueryKey
} from "../../features/workspaceAdmin/queryKeys.js";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function formatDateOnly(value) {
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

function normalizePlanHistoryEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const toPlan = entry.toPlan && typeof entry.toPlan === "object" ? entry.toPlan : null;
      const fromPlan = entry.fromPlan && typeof entry.fromPlan === "object" ? entry.fromPlan : null;

      return {
        id: Number(entry.id || 0),
        effectiveAt: String(entry.effectiveAt || ""),
        changeKind: String(entry.changeKind || ""),
        fromPlan,
        toPlan
      };
    })
    .filter((entry) => entry.id > 0);
}

function normalizePlanSelection(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    id: Number(entry.id || 0),
    code: String(entry.code || ""),
    name: String(entry.name || ""),
    description: entry.description == null ? null : String(entry.description),
    isActive: entry.isActive !== false,
    corePrice: entry.corePrice && typeof entry.corePrice === "object" ? entry.corePrice : null
  };
}

export function useWorkspaceBillingView() {
  const workspaceStore = useWorkspaceStore();

  const selectedPlanCode = ref("");
  const planChangeLoading = ref(false);
  const cancelPlanChangeLoading = ref(false);

  const selectedCatalogPriceId = ref("");
  const selectedCatalogQuantity = ref(1);
  const oneOffMode = ref("catalog");
  const adHocName = ref("");
  const adHocAmountMinor = ref("");
  const adHocQuantity = ref(1);
  const paymentLinkLoading = ref(false);

  const actionError = ref("");
  const actionSuccess = ref("");
  const lastCheckoutUrl = ref("");
  const lastPaymentLinkUrl = ref("");

  const workspaceSlug = computed(() => {
    return String(workspaceStore.activeWorkspace?.slug || workspaceStore.activeWorkspaceSlug || "").trim();
  });
  const workspaceBillingPath = computed(() => workspaceStore.workspacePath("/billing"));

  const planStateQuery = useQuery({
    queryKey: computed(() => workspaceBillingPlanStateQueryKey(workspaceSlug.value)),
    queryFn: () => api.billing.getPlanState(),
    enabled: computed(() => Boolean(workspaceSlug.value))
  });

  const billableEntity = computed(() => {
    const value = planStateQuery.data.value?.billableEntity;
    return value && typeof value === "object" ? value : null;
  });

  const currentPlan = computed(() => normalizePlanSelection(planStateQuery.data.value?.currentPlan));

  const currentPlanExpiresAt = computed(() => {
    const value = String(planStateQuery.data.value?.currentPlan?.expiresAt || "").trim();
    return value || "";
  });

  const availablePlans = computed(() => {
    const entries = Array.isArray(planStateQuery.data.value?.availablePlans) ? planStateQuery.data.value.availablePlans : [];
    return entries.map(normalizePlanSelection).filter(Boolean);
  });

  const nextPlanChange = computed(() => {
    const value = planStateQuery.data.value?.nextPlanChange;
    if (!value || typeof value !== "object") {
      return null;
    }

    const targetPlan = normalizePlanSelection(value.targetPlan);
    if (!targetPlan) {
      return null;
    }

    return {
      id: Number(value.id || 0),
      changeKind: String(value.changeKind || ""),
      effectiveAt: String(value.effectiveAt || ""),
      targetPlan
    };
  });

  const historyEntries = computed(() => normalizePlanHistoryEntries(planStateQuery.data.value?.history));

  const paymentPolicy = computed(() =>
    String(planStateQuery.data.value?.settings?.paidPlanChangePaymentMethodPolicy || "required_now").trim()
  );

  const allSelectablePlans = computed(() => {
    const entries = [];
    if (currentPlan.value) {
      entries.push(currentPlan.value);
    }

    for (const entry of availablePlans.value) {
      entries.push(entry);
    }

    const byCode = new Map();
    for (const entry of entries) {
      if (!entry || !entry.code || byCode.has(entry.code)) {
        continue;
      }
      byCode.set(entry.code, entry);
    }

    return Array.from(byCode.values());
  });

  const selectedTargetPlan = computed(() => {
    const selectedCode = String(selectedPlanCode.value || "");
    if (!selectedCode) {
      return null;
    }

    return availablePlans.value.find((entry) => entry.code === selectedCode) || null;
  });

  const planOptions = computed(() =>
    availablePlans.value.map((plan) => ({
      value: String(plan.code || ""),
      title: String(plan.name || plan.code || "Plan")
    }))
  );

  const catalogItems = computed(() => {
    const items = [];
    const seen = new Set();
    for (const plan of allSelectablePlans.value) {
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

  watch(
    planOptions,
    (nextOptions) => {
      const currentCode = String(selectedPlanCode.value || "");
      if (currentCode && nextOptions.some((entry) => entry.value === currentCode)) {
        return;
      }

      const defaultOption = nextOptions[0];
      selectedPlanCode.value = defaultOption ? String(defaultOption.value || "") : "";
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

  const loading = computed(() => Boolean(planStateQuery.isPending.value || planStateQuery.isFetching.value));
  const error = computed(() => String(planStateQuery.error.value?.message || ""));

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
    await planStateQuery.refetch();
  }

  async function submitPlanChange() {
    resetActionFeedback();
    const selectedPlanCodeValue = String(selectedPlanCode.value || "").trim();
    if (!selectedPlanCodeValue) {
      actionError.value = "Select a target plan.";
      return;
    }

    planChangeLoading.value = true;
    try {
      const response = await api.billing.requestPlanChange({
        planCode: selectedPlanCodeValue,
        successPath: buildWorkspaceBillingPath({ billing: "checkout_success" }),
        cancelPath: buildWorkspaceBillingPath({ billing: "checkout_cancel" })
      });

      const mode = String(response?.mode || "").trim().toLowerCase();
      const checkoutUrl = String(response?.checkout?.checkoutSession?.checkoutUrl || "").trim();
      lastCheckoutUrl.value = checkoutUrl;

      if (mode === "checkout_required") {
        actionSuccess.value = "Checkout session created. Redirecting to complete the plan change.";
        if (checkoutUrl && typeof window !== "undefined" && typeof window.location?.assign === "function") {
          window.location.assign(checkoutUrl);
        }
      } else if (mode === "scheduled") {
        actionSuccess.value = "Plan downgrade scheduled for the current period end.";
      } else if (mode === "unchanged") {
        actionSuccess.value = "The selected plan is already current.";
      } else {
        actionSuccess.value = "Plan updated.";
      }

      await refresh();
    } catch (errorValue) {
      actionError.value = String(errorValue?.message || "Failed to change plan.");
    } finally {
      planChangeLoading.value = false;
    }
  }

  async function cancelPendingPlanChange() {
    resetActionFeedback();

    cancelPlanChangeLoading.value = true;
    try {
      const response = await api.billing.cancelPendingPlanChange();
      const canceled = Boolean(response?.canceled);
      actionSuccess.value = canceled ? "Scheduled plan change canceled." : "No pending plan change to cancel.";
      await refresh();
    } catch (errorValue) {
      actionError.value = String(errorValue?.message || "Failed to cancel the scheduled plan change.");
    } finally {
      cancelPlanChangeLoading.value = false;
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
      formatDateOnly,
      formatMoneyMinor
    },
    state: reactive({
      billableEntity,
      currentPlan,
      currentPlanExpiresAt,
      availablePlans,
      nextPlanChange,
      historyEntries,
      paymentPolicy,
      planOptions,
      selectedPlanCode,
      selectedTargetPlan,
      planChangeLoading,
      cancelPlanChangeLoading,
      catalogItems,
      selectedCatalogPriceId,
      selectedCatalogQuantity,
      oneOffMode,
      adHocName,
      adHocAmountMinor,
      adHocQuantity,
      paymentLinkLoading,
      actionError,
      actionSuccess,
      lastCheckoutUrl,
      lastPaymentLinkUrl,
      loading,
      error
    }),
    actions: {
      refresh,
      submitPlanChange,
      cancelPendingPlanChange,
      createCatalogPaymentLink,
      createAdHocPaymentLink
    }
  };
}
