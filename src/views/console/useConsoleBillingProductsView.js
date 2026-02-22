import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { api } from "../../services/api/index.js";

const CONSOLE_BILLING_PRODUCTS_QUERY_KEY = ["console-billing-products"];
const CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY = ["console-billing-provider-prices", "product"];

const PRODUCT_KIND_OPTIONS = [
  { title: "One-off", value: "one_off" },
  { title: "Credit top-up", value: "credit_topup" },
  { title: "Setup fee", value: "setup_fee" }
];

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
  const normalizedInterval = String(interval || "").trim().toLowerCase();
  const count = Math.max(1, Number(intervalCount) || 1);
  if (!normalizedInterval) {
    return "one-time";
  }
  return count === 1 ? normalizedInterval : `${count} ${normalizedInterval}s`;
}

function shortenProviderPriceId(value) {
  const normalized = String(value || "").trim();
  if (normalized.length <= 15) {
    return normalized;
  }
  return `${normalized.slice(0, 9)}...${normalized.slice(-3)}`;
}

function normalizeOptionalString(value) {
  return String(value || "").trim();
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

function createDefaultCreateForm() {
  return {
    code: "",
    name: "",
    description: "",
    productKind: "one_off",
    isActive: true,
    providerPriceId: "",
    entitlementsJson: "[]"
  };
}

function createDefaultEditForm() {
  return {
    code: "",
    name: "",
    description: "",
    productKind: "one_off",
    isActive: true,
    providerPriceId: "",
    entitlementsJson: "[]"
  };
}

function resolveProductPrice(product) {
  if (!product || typeof product !== "object") {
    return null;
  }

  return product.price && typeof product.price === "object" ? product.price : null;
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
  const hasInterval = Boolean(interval && Number.isInteger(intervalCount) && intervalCount > 0);

  const usageType = String(price.usageType || "").trim().toLowerCase() || null;

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
    usageType
  };
}

function findProviderPriceById(prices, providerPriceId) {
  const targetId = String(providerPriceId || "").trim();
  if (!targetId) {
    return null;
  }

  return (Array.isArray(prices) ? prices : []).find((entry) => String(entry?.id || "").trim() === targetId) || null;
}

function buildProductPricePayload({ form, selectedPrice }) {
  const providerPriceId = String(form?.providerPriceId || selectedPrice?.id || "").trim();
  const interval = String(selectedPrice?.interval || "").trim().toLowerCase();
  const intervalCountValue = Number(selectedPrice?.intervalCount);

  return {
    providerPriceId,
    providerProductId: String(selectedPrice?.productId || "").trim() || undefined,
    currency: String(selectedPrice?.currency || "").trim().toUpperCase() || undefined,
    unitAmountMinor:
      Number.isInteger(Number(selectedPrice?.unitAmountMinor)) && Number(selectedPrice?.unitAmountMinor) >= 0
        ? Number(selectedPrice.unitAmountMinor)
        : undefined,
    interval: interval || undefined,
    intervalCount: interval && Number.isInteger(intervalCountValue) && intervalCountValue > 0 ? intervalCountValue : undefined
  };
}

function formatProviderPriceOption(price) {
  const id = String(price?.id || "").trim();
  const moneyLabel = formatMoneyMinor(price?.unitAmountMinor, price?.currency);
  const intervalLabel = formatInterval(price?.interval, price?.intervalCount);
  const productName = String(price?.productName || "").trim();
  return `${shortenProviderPriceId(id)} | ${moneyLabel}/${intervalLabel}${productName ? ` | ${productName}` : ""}`;
}

function selectCatalogPrices(prices = []) {
  return (Array.isArray(prices) ? prices : []).filter((entry) => {
    const id = String(entry?.id || "").trim();
    const currency = String(entry?.currency || "").trim();
    const amount = Number(entry?.unitAmountMinor);
    const interval = String(entry?.interval || "").trim().toLowerCase();
    return id && currency && Number.isInteger(amount) && amount >= 0 && !interval;
  });
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

export function useConsoleBillingProductsView() {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const submitError = ref("");
  const submitMessage = ref("");

  const createDialogOpen = ref(false);
  const createFieldErrors = ref({});
  const createError = ref("");

  const viewDialogOpen = ref(false);
  const selectedProductId = ref(0);

  const editDialogOpen = ref(false);
  const editFieldErrors = ref({});
  const editError = ref("");
  const editSaving = ref(false);
  const editingProductId = ref(0);
  const editInitialProviderPriceId = ref("");

  const createForm = reactive(createDefaultCreateForm());
  const editForm = reactive(createDefaultEditForm());

  const productsQuery = useQuery({
    queryKey: CONSOLE_BILLING_PRODUCTS_QUERY_KEY,
    queryFn: () => api.console.listBillingProducts()
  });

  const providerPricesQuery = useQuery({
    queryKey: CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY,
    queryFn: () => api.console.listBillingProviderPrices({ active: true, limit: 100, target: "product" })
  });

  const createProductMutation = useMutation({
    mutationFn: (payload) => api.console.createBillingProduct(payload)
  });

  const products = computed(() =>
    Array.isArray(productsQuery.data.value?.products) ? productsQuery.data.value.products : []
  );
  const provider = computed(() => {
    const fromProducts = String(productsQuery.data.value?.provider || "").trim();
    if (fromProducts) {
      return fromProducts;
    }
    return String(providerPricesQuery.data.value?.provider || "").trim();
  });

  const providerPrices = computed(() =>
    Array.isArray(providerPricesQuery.data.value?.prices) ? providerPricesQuery.data.value.prices : []
  );

  const selectableProviderPrices = computed(() => selectCatalogPrices(providerPrices.value));

  const providerPriceOptions = computed(() => {
    const options = selectableProviderPrices.value.map((entry) => ({
      title: formatProviderPriceOption(entry),
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
    findProviderPriceById(selectableProviderPrices.value, createForm.providerPriceId)
  );
  const editSelectedProviderPrice = computed(() =>
    findProviderPriceById(selectableProviderPrices.value, editForm.providerPriceId)
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

  const selectedProduct = computed(() =>
    products.value.find((product) => Number(product?.id || 0) === Number(selectedProductId.value || 0)) || null
  );
  const selectedProductPriceInfo = computed(() => {
    const price = resolveProductPrice(selectedProduct.value);
    if (!price) {
      return null;
    }

    const catalogPrice = findProviderPriceById(selectableProviderPrices.value, price.providerPriceId);
    return resolvePriceDetails(
      catalogPrice
        ? {
            ...price,
            ...catalogPrice,
            providerPriceId: price.providerPriceId
          }
        : price
    );
  });

  const tableRows = computed(() =>
    products.value.map((product) => ({
      id: Number(product?.id || 0),
      code: String(product?.code || ""),
      name: String(product?.name || ""),
      description: String(product?.description || ""),
      productKind: String(product?.productKind || "one_off"),
      isActive: product?.isActive !== false,
      price: resolveProductPrice(product)
    }))
  );

  const providerPricesLoading = computed(() =>
    Boolean(providerPricesQuery.isPending.value || providerPricesQuery.isFetching.value)
  );
  const loading = computed(() =>
    Boolean(productsQuery.isPending.value || productsQuery.isFetching.value || providerPricesQuery.isFetching.value)
  );
  const isSavingCreate = computed(() => createProductMutation.isPending.value);

  const productsLoadError = useQueryErrorMessage({
    query: productsQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load billing products.")
  });

  const providerPricesLoadError = useQueryErrorMessage({
    query: providerPricesQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load provider catalog prices.")
  });

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
    submitError.value = "";
    submitMessage.value = "";
  }

  async function refresh() {
    await Promise.all([productsQuery.refetch(), providerPricesQuery.refetch()]);
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

  function openViewDialog(productId) {
    selectedProductId.value = Number(productId || 0);
    viewDialogOpen.value = selectedProductId.value > 0;
  }

  function closeViewDialog() {
    viewDialogOpen.value = false;
  }

  function openEditDialog(productId) {
    const product = products.value.find((entry) => Number(entry?.id || 0) === Number(productId || 0)) || null;
    if (!product) {
      return;
    }

    const defaults = createDefaultEditForm();
    for (const [key, value] of Object.entries(defaults)) {
      editForm[key] = value;
    }

    const price = resolveProductPrice(product);
    selectedProductId.value = Number(product.id || 0);
    editingProductId.value = Number(product.id || 0);
    editForm.code = String(product.code || "").trim();
    editForm.name = String(product.name || "").trim();
    editForm.description = String(product.description || "");
    editForm.productKind = String(product.productKind || "one_off").trim() || "one_off";
    editForm.isActive = product.isActive !== false;
    editInitialProviderPriceId.value = String(price?.providerPriceId || "").trim();
    editForm.providerPriceId = editInitialProviderPriceId.value;
    editForm.entitlementsJson = JSON.stringify(Array.isArray(product.entitlements) ? product.entitlements : [], null, 2);
    editFieldErrors.value = {};
    editError.value = "";
    editDialogOpen.value = true;
  }

  function closeEditDialog() {
    editDialogOpen.value = false;
    editInitialProviderPriceId.value = "";
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

  async function submitCreateProduct() {
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

    if (!createSelectedProviderPrice.value) {
      createError.value = "Select an active catalog price.";
      return;
    }

    const payload = {
      code: createForm.code,
      name: createForm.name,
      description: normalizeOptionalString(createForm.description) || undefined,
      productKind: normalizeOptionalString(createForm.productKind) || "one_off",
      isActive: Boolean(createForm.isActive),
      price: buildProductPricePayload({
        form: createForm,
        selectedPrice: createSelectedProviderPrice.value
      }),
      entitlements
    };

    try {
      await createProductMutation.mutateAsync(payload);
      submitMessage.value = "Billing product created.";
      createDialogOpen.value = false;
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_PRODUCTS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }
      createFieldErrors.value = toFieldErrors(error);
      createError.value = String(error?.message || "Unable to create billing product.");
    }
  }

  async function saveEditedProduct() {
    clearMessages();
    editFieldErrors.value = {};
    editError.value = "";

    if (!editingProductId.value) {
      editError.value = "Missing product context for update.";
      return;
    }

    const normalizedCurrentPriceId = String(editForm.providerPriceId || "").trim();
    const priceChanged = normalizedCurrentPriceId !== String(editInitialProviderPriceId.value || "").trim();
    if (priceChanged && !editSelectedProviderPrice.value) {
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
      productKind: normalizeOptionalString(editForm.productKind) || "one_off",
      isActive: Boolean(editForm.isActive),
      entitlements
    };
    if (priceChanged) {
      payload.price = buildProductPricePayload({
        form: editForm,
        selectedPrice: editSelectedProviderPrice.value
      });
    }

    try {
      await api.console.updateBillingProduct(editingProductId.value, payload);
      submitMessage.value = "Billing product updated.";
      editDialogOpen.value = false;
      editInitialProviderPriceId.value = "";
      await queryClient.invalidateQueries({ queryKey: CONSOLE_BILLING_PRODUCTS_QUERY_KEY });
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }
      editFieldErrors.value = toFieldErrors(error);
      editError.value = String(error?.message || "Unable to update billing product.");
    } finally {
      editSaving.value = false;
    }
  }

  return {
    meta: {
      productKindOptions: PRODUCT_KIND_OPTIONS,
      formatMoneyMinor,
      formatInterval,
      formatPriceSummary
    },
    state: reactive({
      provider,
      products,
      tableRows,
      selectedProduct,
      selectedProductPriceInfo,
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
      productsLoadError,
      ui: {
        priceDescription:
          "Select an active one-time provider catalog price. Recurring prices belong in billing plans.",
        catalogPriceLabel: "Provider price",
        catalogPriceHint: "Pick the one-time provider price this product should sell.",
        catalogPriceNoDataLoading: "Loading one-time provider prices...",
        catalogPriceNoDataEmpty: "No active one-time provider prices found."
      }
    }),
    actions: {
      refresh,
      openCreateDialog,
      closeCreateDialog,
      openViewDialog,
      closeViewDialog,
      openEditDialog,
      closeEditDialog,
      submitCreateProduct,
      saveEditedProduct
    }
  };
}
