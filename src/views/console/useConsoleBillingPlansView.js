import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { api } from "../../services/api/index.js";
import { resolveBillingPlanProviderProfile } from "./billingPlans/providers/index.js";

const CONSOLE_BILLING_PLANS_QUERY_KEY = ["console-billing-plans"];
const CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY = ["console-billing-provider-prices"];

function parseEntitlementsJson(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return [];
  }

  const parsed = JSON.parse(normalized);
  if (!Array.isArray(parsed)) {
    throw new Error("Entitlements JSON must be an array.");
  }
  return parsed;
}

function formatMoneyMinor(amountMinor, currency) {
  const numericAmount = Number(amountMinor || 0);
  const normalizedCurrency = String(currency || "").trim().toUpperCase() || "USD";
  const major = numericAmount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${normalizedCurrency}`;
  }
}

function formatInterval(interval, intervalCount) {
  const normalizedInterval = String(interval || "").trim().toLowerCase() || "month";
  const count = Math.max(1, Number(intervalCount) || 1);
  return count === 1 ? normalizedInterval : `${count} ${normalizedInterval}s`;
}

function shortenProviderPriceId(value) {
  const normalized = String(value || "").trim();
  if (normalized.length <= 15) {
    return normalized;
  }
  return `${normalized.slice(0, 9)}...${normalized.slice(-3)}`;
}

function toFieldErrors(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const details = value.details && typeof value.details === "object" ? value.details : {};
  const fieldErrors = details.fieldErrors && typeof details.fieldErrors === "object" ? details.fieldErrors : {};
  return fieldErrors;
}

function resolveBasePlanPrice(plan) {
  const prices = Array.isArray(plan?.prices) ? plan.prices : [];
  const activeBase = prices.find((price) => {
    if (!price || !price.isActive) {
      return false;
    }
    return (
      String(price.billingComponent || "").trim().toLowerCase() === "base" &&
      String(price.usageType || "").trim().toLowerCase() === "licensed"
    );
  });
  if (activeBase) {
    return activeBase;
  }

  return prices[0] || null;
}

function createDefaultCreateForm() {
  return {
    code: "",
    planFamilyCode: "",
    version: 1,
    name: "",
    description: "",
    pricingModel: "flat",
    currency: "USD",
    unitAmountMinor: 0,
    interval: "month",
    intervalCount: 1,
    providerPriceId: "",
    providerProductId: "",
    entitlementsJson: "[]"
  };
}

export function useConsoleBillingPlansView() {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const submitError = ref("");
  const submitMessage = ref("");

  const createDialogOpen = ref(false);
  const createFieldErrors = ref({});

  const viewDialogOpen = ref(false);
  const selectedPlanId = ref(0);

  const editDialogOpen = ref(false);
  const editFieldErrors = ref({});
  const editError = ref("");
  const editSaving = ref(false);
  const editingPlanId = ref(0);
  const editingPriceId = ref(0);

  const createForm = reactive(createDefaultCreateForm());
  const editForm = reactive({
    providerPriceId: "",
    providerProductId: ""
  });

  const plansQuery = useQuery({
    queryKey: CONSOLE_BILLING_PLANS_QUERY_KEY,
    queryFn: () => api.console.listBillingPlans()
  });

  const providerPricesQuery = useQuery({
    queryKey: CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY,
    queryFn: () => api.console.listBillingProviderPrices({ active: true, limit: 100 })
  });

  const createPlanMutation = useMutation({
    mutationFn: (payload) => api.console.createBillingPlan(payload)
  });

  const plans = computed(() => (Array.isArray(plansQuery.data.value?.plans) ? plansQuery.data.value.plans : []));
  const provider = computed(() => String(plansQuery.data.value?.provider || "").trim());
  const providerProfile = computed(() => resolveBillingPlanProviderProfile(provider.value));
  const ui = computed(() => providerProfile.value.ui);

  const providerPrices = computed(() =>
    Array.isArray(providerPricesQuery.data.value?.prices) ? providerPricesQuery.data.value.prices : []
  );

  const selectableProviderPrices = computed(() => providerProfile.value.selectCatalogPrices(providerPrices.value));

  const providerPriceOptions = computed(() =>
    selectableProviderPrices.value
      .filter((entry) => String(entry?.id || "").trim())
      .map((entry) => ({
        title: providerProfile.value.formatCatalogPriceOption(entry, {
          formatMoneyMinor,
          formatInterval
        }),
        value: String(entry.id).trim()
      }))
  );

  const createSelectedProviderPrice = computed(() => {
    const selectedId = String(createForm.providerPriceId || "").trim();
    if (!selectedId) {
      return null;
    }

    return selectableProviderPrices.value.find((entry) => String(entry?.id || "").trim() === selectedId) || null;
  });

  const editSelectedProviderPrice = computed(() => {
    const selectedId = String(editForm.providerPriceId || "").trim();
    if (!selectedId) {
      return null;
    }

    return selectableProviderPrices.value.find((entry) => String(entry?.id || "").trim() === selectedId) || null;
  });

  const isCreatePriceAutofilled = computed(() =>
    providerProfile.value.isCreateFormDerivedFromSelectedPrice(createSelectedProviderPrice.value)
  );

  const isEditPriceAutofilled = computed(() =>
    providerProfile.value.isCreateFormDerivedFromSelectedPrice(editSelectedProviderPrice.value)
  );

  const providerPricesLoading = computed(() =>
    Boolean(providerPricesQuery.isPending.value || providerPricesQuery.isFetching.value)
  );

  const loading = computed(() => Boolean(plansQuery.isPending.value || plansQuery.isFetching.value));
  const isSavingCreate = computed(() => createPlanMutation.isPending.value);

  const plansLoadError = useQueryErrorMessage({
    query: plansQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load billing plans.")
  });

  const providerPricesLoadError = useQueryErrorMessage({
    query: providerPricesQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load provider catalog prices.")
  });

  const selectedPlan = computed(() =>
    plans.value.find((plan) => Number(plan?.id || 0) === Number(selectedPlanId.value || 0)) || null
  );

  const selectedPlanPrices = computed(() =>
    Array.isArray(selectedPlan.value?.prices) ? selectedPlan.value.prices : []
  );

  const editingPrice = computed(() =>
    selectedPlanPrices.value.find((price) => Number(price?.id || 0) === Number(editingPriceId.value || 0)) || null
  );

  const tableRows = computed(() =>
    plans.value.map((plan) => {
      const basePrice = resolveBasePlanPrice(plan);
      const prices = Array.isArray(plan?.prices) ? plan.prices : [];
      const entitlements = Array.isArray(plan?.entitlements) ? plan.entitlements : [];
      return {
        id: Number(plan?.id || 0),
        code: String(plan?.code || ""),
        name: String(plan?.name || ""),
        planFamilyCode: String(plan?.planFamilyCode || ""),
        version: Number(plan?.version || 0),
        pricingModel: String(plan?.pricingModel || ""),
        isActive: plan?.isActive !== false,
        basePrice,
        pricesCount: prices.length,
        entitlementsCount: entitlements.length,
        source: plan
      };
    })
  );

  function resetCreateForm() {
    const defaults = createDefaultCreateForm();
    for (const [key, value] of Object.entries(defaults)) {
      createForm[key] = value;
    }

    const firstOption = providerPriceOptions.value[0];
    if (firstOption?.value) {
      createForm.providerPriceId = String(firstOption.value);
    }
  }

  function clearMessages() {
    submitMessage.value = "";
    submitError.value = "";
  }

  async function refresh() {
    await Promise.all([plansQuery.refetch(), providerPricesQuery.refetch()]);
  }

  function openCreateDialog() {
    clearMessages();
    createFieldErrors.value = {};
    resetCreateForm();
    createDialogOpen.value = true;
  }

  function closeCreateDialog() {
    createDialogOpen.value = false;
  }

  function openViewDialog(planId) {
    selectedPlanId.value = Number(planId || 0);
    viewDialogOpen.value = selectedPlanId.value > 0;
  }

  function closeViewDialog() {
    viewDialogOpen.value = false;
  }

  function openEditDialog(planId, priceId) {
    const plan = plans.value.find((entry) => Number(entry?.id || 0) === Number(planId || 0)) || null;
    if (!plan) {
      return;
    }

    const planPrices = Array.isArray(plan.prices) ? plan.prices : [];
    const targetPrice =
      planPrices.find((entry) => Number(entry?.id || 0) === Number(priceId || 0)) ||
      resolveBasePlanPrice(plan) ||
      null;

    if (!targetPrice) {
      return;
    }

    selectedPlanId.value = Number(plan.id || 0);
    editingPlanId.value = Number(plan.id || 0);
    editingPriceId.value = Number(targetPrice.id || 0);
    editForm.providerPriceId = String(targetPrice.providerPriceId || "").trim();
    editForm.providerProductId = String(targetPrice.providerProductId || "").trim();
    editFieldErrors.value = {};
    editError.value = "";
    editDialogOpen.value = true;
  }

  function closeEditDialog() {
    editDialogOpen.value = false;
  }

  watch(
    providerPriceOptions,
    (options) => {
      if (!createForm.providerPriceId && Array.isArray(options) && options.length > 0) {
        createForm.providerPriceId = String(options[0].value || "");
      }
    },
    { immediate: true }
  );

  watch(
    createSelectedProviderPrice,
    (price) => {
      providerProfile.value.applySelectedPriceToForm({
        form: createForm,
        selectedPrice: price
      });
    },
    { immediate: true }
  );

  watch(editSelectedProviderPrice, (price) => {
    const productId = String(price?.productId || "").trim();
    if (productId) {
      editForm.providerProductId = productId;
    }
  });

  async function submitCreatePlan() {
    clearMessages();
    createFieldErrors.value = {};

    let entitlements;
    try {
      entitlements = parseEntitlementsJson(createForm.entitlementsJson);
    } catch (error) {
      submitError.value = String(error?.message || "Entitlements JSON must be a valid JSON array.");
      return;
    }

    if (providerProfile.value.requiresCatalogPriceSelection() && !createSelectedProviderPrice.value) {
      submitError.value = String(ui.value?.selectPriceRequiredError || "Select a catalog price.");
      return;
    }

    const payload = {
      code: createForm.code,
      planFamilyCode: createForm.planFamilyCode || undefined,
      version: Number(createForm.version) || 1,
      name: createForm.name,
      description: createForm.description || undefined,
      pricingModel: createForm.pricingModel,
      basePrice: providerProfile.value.buildCreateBasePrice({
        form: createForm,
        selectedPrice: createSelectedProviderPrice.value
      }),
      entitlements
    };

    try {
      await createPlanMutation.mutateAsync(payload);
      submitMessage.value = "Billing plan created.";
      createDialogOpen.value = false;
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_PLANS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }

      createFieldErrors.value = toFieldErrors(error);
      submitError.value = String(error?.message || "Unable to create billing plan.");
    }
  }

  async function saveEditedPrice() {
    clearMessages();
    editFieldErrors.value = {};
    editError.value = "";

    if (!editingPlanId.value || !editingPriceId.value) {
      editError.value = "Missing plan price context for update.";
      return;
    }

    editSaving.value = true;
    const payload = {
      providerPriceId: String(editForm.providerPriceId || "").trim(),
      providerProductId: String(editForm.providerProductId || "").trim() || undefined
    };

    try {
      await api.console.updateBillingPlanPrice(editingPlanId.value, editingPriceId.value, payload);
      submitMessage.value = "Billing plan price updated.";
      editDialogOpen.value = false;
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_PLANS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }

      editFieldErrors.value = toFieldErrors(error);
      editError.value = String(error?.message || "Unable to update billing plan price.");
    } finally {
      editSaving.value = false;
    }
  }

  function formatPriceSummary(price) {
    if (!price) {
      return "-";
    }

    const money = formatMoneyMinor(price.unitAmountMinor, price.currency);
    const interval = formatInterval(price.interval, price.intervalCount);
    const providerPriceId = shortenProviderPriceId(price.providerPriceId);
    if (!providerPriceId) {
      return `${money}/${interval}`;
    }

    return `${money}/${interval} (${providerPriceId})`;
  }

  return {
    meta: {
      pricingModelOptions: [
        { title: "Flat", value: "flat" },
        { title: "Per seat", value: "per_seat" },
        { title: "Usage", value: "usage" },
        { title: "Hybrid", value: "hybrid" }
      ],
      intervalOptions: [
        { title: "Day", value: "day" },
        { title: "Week", value: "week" },
        { title: "Month", value: "month" },
        { title: "Year", value: "year" }
      ],
      formatMoneyMinor,
      formatInterval,
      formatPriceSummary,
      shortenProviderPriceId
    },
    state: reactive({
      provider,
      ui,
      tableRows,
      plans,
      selectedPlan,
      selectedPlanPrices,
      editingPrice,
      createDialogOpen,
      viewDialogOpen,
      editDialogOpen,
      createForm,
      editForm,
      createFieldErrors,
      editFieldErrors,
      editError,
      submitError,
      submitMessage,
      providerPriceOptions,
      providerPricesLoading,
      providerPricesLoadError,
      isCreatePriceAutofilled,
      isEditPriceAutofilled,
      loading,
      isSavingCreate,
      editSaving,
      plansLoadError
    }),
    actions: {
      refresh,
      openCreateDialog,
      closeCreateDialog,
      openViewDialog,
      closeViewDialog,
      openEditDialog,
      closeEditDialog,
      submitCreatePlan,
      saveEditedPrice
    }
  };
}
