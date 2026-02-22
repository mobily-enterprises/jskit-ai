import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { api } from "../../services/api/index.js";
import { resolveBillingPlanProviderProfile } from "./billingPlans/providers/index.js";

const CONSOLE_BILLING_PLANS_QUERY_KEY = ["console-billing-plans"];
const CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY = ["console-billing-provider-prices", "plan"];
const CONSOLE_BILLING_SETTINGS_QUERY_KEY = ["console-billing-settings"];

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
  if (value.fieldErrors && typeof value.fieldErrors === "object") {
    return value.fieldErrors;
  }
  const details = value.details && typeof value.details === "object" ? value.details : {};
  if (details.fieldErrors && typeof details.fieldErrors === "object") {
    return details.fieldErrors;
  }
  return {};
}

function resolveCorePlanPrice(plan) {
  if (!plan || typeof plan !== "object") {
    return null;
  }

  return plan.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
}

function resolvePlanBillingMode(plan) {
  return resolveCorePlanPrice(plan) ? "paid" : "free";
}

function createDefaultCreateForm() {
  return {
    code: "",
    name: "",
    description: "",
    isActive: true,
    billingMode: "paid",
    providerPriceId: "",
    entitlementsJson: "[]"
  };
}

function createDefaultEditForm() {
  return {
    code: "",
    name: "",
    description: "",
    isActive: true,
    billingMode: "paid",
    providerPriceId: "",
    entitlementsJson: "[]"
  };
}

function normalizeOptionalString(value) {
  return String(value || "").trim();
}

function resolvePriceDetails(price) {
  if (!price || typeof price !== "object") {
    return null;
  }

  const providerPriceId = String(price.id || price.providerPriceId || "").trim();
  if (!providerPriceId) {
    return null;
  }

  const currency = String(price.currency || "").trim().toUpperCase();
  const unitAmountMinor = Number(price.unitAmountMinor);
  const hasAmount = Number.isInteger(unitAmountMinor) && unitAmountMinor >= 0 && currency.length === 3;

  const interval = String(price.interval || "").trim().toLowerCase();
  const intervalCount = Number(price.intervalCount);
  const hasInterval = interval && Number.isInteger(intervalCount) && intervalCount > 0;

  const usageType = String(price.usageType || "").trim().toLowerCase() || null;
  const active = typeof price.active === "boolean" ? price.active : null;

  return {
    providerPriceId,
    shortProviderPriceId: shortenProviderPriceId(providerPriceId),
    productName: String(price.productName || "").trim() || null,
    productId: String(price.productId || price.providerProductId || "").trim() || null,
    currency: currency || null,
    unitAmountMinor: Number.isInteger(unitAmountMinor) ? unitAmountMinor : null,
    hasAmount,
    interval: interval || null,
    intervalCount: Number.isInteger(intervalCount) ? intervalCount : null,
    hasInterval,
    usageType,
    active
  };
}

function findProviderPriceById(prices, providerPriceId) {
  const targetId = String(providerPriceId || "").trim();
  if (!targetId) {
    return null;
  }

  return (Array.isArray(prices) ? prices : []).find((entry) => String(entry?.id || "").trim() === targetId) || null;
}

function collectPrefixedFieldErrors(fieldErrors, prefix) {
  const source = fieldErrors && typeof fieldErrors === "object" ? fieldErrors : {};
  const normalizedPrefix = String(prefix || "");
  if (!normalizedPrefix) {
    return [];
  }

  return Object.entries(source)
    .filter(([key]) => String(key || "").startsWith(normalizedPrefix))
    .map(([, message]) => String(message || "").trim())
    .filter(Boolean);
}

export function useConsoleBillingPlansView() {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const submitError = ref("");
  const submitMessage = ref("");
  const billingSettingsError = ref("");
  const billingSettingsSaveMessage = ref("");

  const createDialogOpen = ref(false);
  const createFieldErrors = ref({});
  const createError = ref("");

  const viewDialogOpen = ref(false);
  const selectedPlanId = ref(0);

  const editDialogOpen = ref(false);
  const editFieldErrors = ref({});
  const editError = ref("");
  const editSaving = ref(false);
  const editingPlanId = ref(0);
  const editInitialProviderPriceId = ref("");

  const createForm = reactive(createDefaultCreateForm());
  const editForm = reactive(createDefaultEditForm());
  const billingSettingsForm = reactive({
    paidPlanChangePaymentMethodPolicy: "required_now"
  });

  const plansQuery = useQuery({
    queryKey: CONSOLE_BILLING_PLANS_QUERY_KEY,
    queryFn: () => api.console.listBillingPlans()
  });

  const providerPricesQuery = useQuery({
    queryKey: CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY,
    queryFn: () => api.console.listBillingProviderPrices({ active: true, limit: 100, target: "plan" })
  });

  const billingSettingsQuery = useQuery({
    queryKey: CONSOLE_BILLING_SETTINGS_QUERY_KEY,
    queryFn: () => api.console.getBillingSettings()
  });

  const createPlanMutation = useMutation({
    mutationFn: (payload) => api.console.createBillingPlan(payload)
  });

  const billingSettingsMutation = useMutation({
    mutationFn: (payload) => api.console.updateBillingSettings(payload)
  });

  const plans = computed(() => (Array.isArray(plansQuery.data.value?.plans) ? plansQuery.data.value.plans : []));
  const provider = computed(() => String(plansQuery.data.value?.provider || "").trim());
  const providerProfile = computed(() => resolveBillingPlanProviderProfile(provider.value));
  const ui = computed(() => providerProfile.value.ui);

  const providerPrices = computed(() =>
    Array.isArray(providerPricesQuery.data.value?.prices) ? providerPricesQuery.data.value.prices : []
  );
  const billingSettings = computed(() => {
    const value = billingSettingsQuery.data.value?.settings;
    return value && typeof value === "object" ? value : null;
  });
  const billingPolicyOptions = [
    {
      title: "Require payment method now",
      value: "required_now"
    },
    {
      title: "Allow change without payment method",
      value: "allow_without_payment_method"
    }
  ];
  const planBillingModeOptions = [
    {
      title: "Paid (Stripe subscription)",
      value: "paid"
    },
    {
      title: "Free (no checkout price)",
      value: "free"
    }
  ];

  const selectableProviderPrices = computed(() => providerProfile.value.selectCatalogPrices(providerPrices.value));

  const providerPriceOptions = computed(() => {
    const options = selectableProviderPrices.value
      .filter((entry) => String(entry?.id || "").trim())
      .map((entry) => ({
        title: providerProfile.value.formatCatalogPriceOption(entry, {
          formatMoneyMinor,
          formatInterval
        }),
        value: String(entry.id).trim()
      }));

      const editingProviderPriceId = String(editForm.providerPriceId || "").trim();
      if (editingProviderPriceId && !options.some((entry) => entry.value === editingProviderPriceId)) {
        options.unshift({
          title: `${shortenProviderPriceId(editingProviderPriceId)} | Current mapping`,
          value: editingProviderPriceId
        });
      }

    return options;
  });

  const createSelectedProviderPrice = computed(() =>
    createForm.billingMode === "paid" ? findProviderPriceById(selectableProviderPrices.value, createForm.providerPriceId) : null
  );

  const editSelectedProviderPrice = computed(() =>
    editForm.billingMode === "paid" ? findProviderPriceById(selectableProviderPrices.value, editForm.providerPriceId) : null
  );

  const createSelectedProviderPriceInfo = computed(() => resolvePriceDetails(createSelectedProviderPrice.value));
  const editSelectedProviderPriceInfo = computed(() => resolvePriceDetails(editSelectedProviderPrice.value));
  const createEntitlementErrors = computed(() =>
    collectPrefixedFieldErrors(createFieldErrors.value, "entitlements[").filter(
      (message, index, array) => array.indexOf(message) === index
    )
  );
  const editEntitlementErrors = computed(() =>
    collectPrefixedFieldErrors(editFieldErrors.value, "entitlements[").filter(
      (message, index, array) => array.indexOf(message) === index
    )
  );

  const providerPricesLoading = computed(() =>
    Boolean(providerPricesQuery.isPending.value || providerPricesQuery.isFetching.value)
  );
  const billingSettingsLoading = computed(() =>
    Boolean(billingSettingsQuery.isPending.value || billingSettingsQuery.isFetching.value)
  );
  const billingSettingsSaving = computed(() => billingSettingsMutation.isPending.value);

  const loading = computed(() =>
    Boolean(plansQuery.isPending.value || plansQuery.isFetching.value || billingSettingsQuery.isFetching.value)
  );
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
  const billingSettingsLoadError = useQueryErrorMessage({
    query: billingSettingsQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load billing settings.")
  });

  const selectedPlan = computed(() =>
    plans.value.find((plan) => Number(plan?.id || 0) === Number(selectedPlanId.value || 0)) || null
  );

  const selectedPlanCorePriceInfo = computed(() => {
    const corePrice = resolveCorePlanPrice(selectedPlan.value);
    if (!corePrice) {
      return null;
    }

    const catalogPrice = findProviderPriceById(selectableProviderPrices.value, corePrice.providerPriceId);
    return resolvePriceDetails(
      catalogPrice
        ? {
            ...corePrice,
            ...catalogPrice,
            providerPriceId: corePrice.providerPriceId
          }
        : corePrice
    );
  });

  const tableRows = computed(() =>
    plans.value.map((plan) => {
      const corePrice = resolveCorePlanPrice(plan);
      return {
        id: Number(plan?.id || 0),
        code: String(plan?.code || ""),
        name: String(plan?.name || ""),
        description: String(plan?.description || ""),
        isActive: plan?.isActive !== false,
        corePrice
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

  function clearBillingSettingsMessages() {
    billingSettingsError.value = "";
    billingSettingsSaveMessage.value = "";
  }

  async function refresh() {
    await Promise.all([plansQuery.refetch(), providerPricesQuery.refetch(), billingSettingsQuery.refetch()]);
  }

  function openCreateDialog() {
    clearMessages();
    createFieldErrors.value = {};
    createError.value = "";
    resetCreateForm();
    createDialogOpen.value = true;
  }

  function closeCreateDialog() {
    createDialogOpen.value = false;
    createError.value = "";
  }

  function openViewDialog(planId) {
    selectedPlanId.value = Number(planId || 0);
    viewDialogOpen.value = selectedPlanId.value > 0;
  }

  function closeViewDialog() {
    viewDialogOpen.value = false;
  }

  function openEditDialog(planId) {
    const plan = plans.value.find((entry) => Number(entry?.id || 0) === Number(planId || 0)) || null;
    if (!plan) {
      return;
    }

    const defaults = createDefaultEditForm();
    for (const [key, value] of Object.entries(defaults)) {
      editForm[key] = value;
    }

    const targetPrice = resolveCorePlanPrice(plan);
    selectedPlanId.value = Number(plan.id || 0);
    editingPlanId.value = Number(plan.id || 0);
    editForm.code = String(plan.code || "").trim();
    editForm.name = String(plan.name || "").trim();
    editForm.description = String(plan.description || "");
    editForm.isActive = plan.isActive !== false;
    editForm.billingMode = resolvePlanBillingMode(plan);
    editInitialProviderPriceId.value = String(targetPrice?.providerPriceId || "").trim();
    editForm.providerPriceId = editInitialProviderPriceId.value;
    editForm.entitlementsJson = JSON.stringify(Array.isArray(plan.entitlements) ? plan.entitlements : [], null, 2);
    editFieldErrors.value = {};
    editError.value = "";
    editDialogOpen.value = true;
  }

  function closeEditDialog() {
    editDialogOpen.value = false;
    editInitialProviderPriceId.value = "";
  }

  watch(
    billingSettings,
    (nextSettings) => {
      const policy = String(nextSettings?.paidPlanChangePaymentMethodPolicy || "required_now").trim();
      if (policy === "required_now" || policy === "allow_without_payment_method") {
        billingSettingsForm.paidPlanChangePaymentMethodPolicy = policy;
      }
    },
    { immediate: true }
  );

  watch(
    providerPriceOptions,
    (options) => {
      if (!createForm.providerPriceId && Array.isArray(options) && options.length > 0) {
        createForm.providerPriceId = String(options[0].value || "");
      }
    },
    { immediate: true }
  );

  async function submitCreatePlan() {
    clearMessages();
    createError.value = "";
    createFieldErrors.value = {};

    let entitlements;
    try {
      entitlements = parseEntitlementsJson(createForm.entitlementsJson);
    } catch (error) {
      createError.value = String(error?.message || "Entitlements JSON must be a valid JSON array.");
      return;
    }

    if (
      createForm.billingMode === "paid" &&
      providerProfile.value.requiresCatalogPriceSelection() &&
      !createSelectedProviderPrice.value
    ) {
      createError.value = String(ui.value?.selectPriceRequiredError || "Select a catalog price.");
      return;
    }

    const payload = {
      code: createForm.code,
      name: createForm.name,
      description: normalizeOptionalString(createForm.description) || undefined,
      isActive: Boolean(createForm.isActive),
      corePrice:
        createForm.billingMode === "free"
          ? null
          : providerProfile.value.buildCorePricePayload({
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
      createError.value = String(error?.message || "Unable to create billing plan.");
    }
  }

  async function saveEditedPlan() {
    clearMessages();
    editFieldErrors.value = {};
    editError.value = "";

    if (!editingPlanId.value) {
      editError.value = "Missing plan context for update.";
      return;
    }

    const normalizedCurrentPriceId = String(editForm.providerPriceId || "").trim();
    const initialProviderPriceId = String(editInitialProviderPriceId.value || "").trim();
    const wasPaid = Boolean(initialProviderPriceId);
    const wantsPaid = String(editForm.billingMode || "paid") === "paid";
    const priceChanged = wantsPaid ? normalizedCurrentPriceId !== initialProviderPriceId || !wasPaid : wasPaid;
    const requiresCatalogSelection = providerProfile.value.requiresCatalogPriceSelection();
    if (wantsPaid && requiresCatalogSelection && priceChanged && !editSelectedProviderPrice.value) {
      editError.value = "Selected price is unavailable. Pick an active catalog price.";
      return;
    }

    let entitlements;
    try {
      entitlements = parseEntitlementsJson(editForm.entitlementsJson);
    } catch (error) {
      editError.value = String(error?.message || "Entitlements JSON must be a valid JSON array.");
      return;
    }

    editSaving.value = true;
    const payload = {
      name: editForm.name,
      description: normalizeOptionalString(editForm.description) || null,
      isActive: Boolean(editForm.isActive),
      entitlements
    };
    if (wantsPaid) {
      if (priceChanged || !requiresCatalogSelection) {
        payload.corePrice = providerProfile.value.buildCorePricePayload({
          form: editForm,
          selectedPrice: editSelectedProviderPrice.value
        });
      }
    } else if (wasPaid) {
      payload.corePrice = null;
    }

    try {
      await api.console.updateBillingPlan(editingPlanId.value, payload);
      submitMessage.value = "Billing plan updated.";
      editDialogOpen.value = false;
      editInitialProviderPriceId.value = "";
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_PLANS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }

      editFieldErrors.value = toFieldErrors(error);
      editError.value = String(error?.message || "Unable to update billing plan.");
    } finally {
      editSaving.value = false;
    }
  }

  async function saveBillingSettings() {
    clearBillingSettingsMessages();

    const policy = String(billingSettingsForm.paidPlanChangePaymentMethodPolicy || "").trim();
    if (policy !== "required_now" && policy !== "allow_without_payment_method") {
      billingSettingsError.value = "Select a valid payment-method policy.";
      return;
    }

    try {
      await billingSettingsMutation.mutateAsync({
        paidPlanChangePaymentMethodPolicy: policy
      });
      billingSettingsSaveMessage.value = "Billing settings updated.";
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_SETTINGS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }

      billingSettingsError.value = String(error?.message || "Unable to update billing settings.");
    }
  }

  function formatPriceSummary(price) {
    if (!price) {
      return "Free";
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
      formatMoneyMinor,
      formatInterval,
      formatPriceSummary,
      shortenProviderPriceId,
      billingPolicyOptions,
      planBillingModeOptions
    },
    state: reactive({
      provider,
      ui,
      billingSettingsForm,
      billingSettingsLoading,
      billingSettingsSaving,
      billingSettingsError,
      billingSettingsSaveMessage,
      billingSettingsLoadError,
      tableRows,
      plans,
      selectedPlan,
      selectedPlanCorePriceInfo,
      createDialogOpen,
      viewDialogOpen,
      editDialogOpen,
      createForm,
      editForm,
      createFieldErrors,
      createError,
      editFieldErrors,
      editError,
      submitError,
      submitMessage,
      providerPriceOptions,
      providerPricesLoading,
      providerPricesLoadError,
      createSelectedProviderPriceInfo,
      editSelectedProviderPriceInfo,
      createEntitlementErrors,
      editEntitlementErrors,
      editInitialProviderPriceId,
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
      saveEditedPlan,
      saveBillingSettings
    }
  };
}
