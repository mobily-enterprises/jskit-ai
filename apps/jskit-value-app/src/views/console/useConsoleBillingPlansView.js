import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { api } from "../../platform/http/api/index.js";
import { resolveBillingPlanProviderProfile } from "./billingPlans/providers/index.js";

const CONSOLE_BILLING_PLANS_QUERY_KEY = ["console-billing-plans"];
const CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY = ["console-billing-provider-prices", "plan"];
const CONSOLE_BILLING_SETTINGS_QUERY_KEY = ["console-billing-settings"];

function helpLines(...lines) {
  return lines.map((line) => `- ${line}`).join("\n");
}

function normalizeEntitlementDefinitionEntry(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const code = String(source.code || "").trim();
  if (!code) {
    return null;
  }

  const id = Number(source.id || 0);
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    code,
    name: String(source.name || "").trim(),
    description: source.description == null ? null : String(source.description || ""),
    entitlementType: String(source.entitlementType || "").trim(),
    unit: String(source.unit || "").trim(),
    windowInterval: source.windowInterval == null ? null : String(source.windowInterval || "").trim(),
    enforcementMode: String(source.enforcementMode || "").trim(),
    isActive: source.isActive !== false
  };
}

function normalizeEntitlementDefinitions(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((entry) => normalizeEntitlementDefinitionEntry(entry)).filter(Boolean);
}

function buildEntitlementCodeSelectOptions({ definitions = [], plans = [] } = {}) {
  const optionsByCode = new Map();

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const code = String(definition?.code || "").trim();
    if (!code) {
      continue;
    }
    const name = String(definition?.name || "").trim();
    const activeSuffix = definition?.isActive === false ? " (inactive)" : "";
    optionsByCode.set(code, {
      const: code,
      title: name ? `${code} - ${name}${activeSuffix}` : `${code}${activeSuffix}`
    });
  }

  for (const plan of Array.isArray(plans) ? plans : []) {
    const entitlements = Array.isArray(plan?.entitlements) ? plan.entitlements : [];
    for (const entitlement of entitlements) {
      const code = String(entitlement?.code || "").trim();
      if (!code || optionsByCode.has(code)) {
        continue;
      }
      optionsByCode.set(code, {
        const: code,
        title: `${code} (missing from definition catalog)`
      });
    }
  }

  return [...optionsByCode.values()].sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));
}

const PLAN_ENTITLEMENTS_EDITOR_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    entitlements: {
      type: "array",
      title: "Entitlements",
      description: "Each entry is editable inline and applied to this plan when saved.",
      default: [],
      layout: {
        listEditMode: "inline",
        listActions: ["add", "delete", "sort", "duplicate"]
      },
      items: {
        type: "object",
        required: ["code", "schemaVersion", "valueJson"],
        layout: {
          title: null,
          children: [
            [
              { key: "code", cols: { xs: 12, md: 6 } },
              { key: "schemaVersion", cols: { xs: 12, md: 6 } }
            ],
            "valueJson",
            [
              { key: "grantKind", cols: { xs: 12, sm: 6, lg: 3 } },
              { key: "effectivePolicy", cols: { xs: 12, sm: 6, lg: 3 } },
              { key: "durationPolicy", cols: { xs: 12, sm: 6, lg: 3 } },
              { key: "durationDays", cols: { xs: 12, sm: 6, lg: 3 } }
            ],
            "metadataJson"
          ]
        },
        properties: {
          code: {
            type: "string",
            title: "Code",
            description: helpLines(
              "Naming: choose one code from the dropdown (example: projects.max or deg2rad.calculations.monthly).",
              "Purpose: this code links the plan row to one entitlement definition (type/unit/window/enforcement behavior).",
              "Where set: definitions are maintained server-side in the entitlement definitions catalog (seeded in this repo migrations).",
              "Values: only catalog codes are valid; unknown codes are rejected on save."
            ),
            minLength: 1,
            maxLength: 120
          },
          schemaVersion: {
            type: "string",
            title: "Schema version",
            description: helpLines(
              "Naming: use the schema id exactly (example: entitlement.quota.v1).",
              "Purpose: tells backend how to validate the value payload.",
              "Common values: entitlement.quota.v1 (limit/interval/enforcement), entitlement.boolean.v1 (enabled), entitlement.string_list.v1 (values)."
            ),
            minLength: 1,
            maxLength: 120
          },
          valueJson: {
            type: "object",
            layout: {
              title: null
            },
            additionalProperties: true,
            properties: {
              limit: {
                type: "integer",
                title: "Limit",
                description: helpLines(
                  "Naming: integer only.",
                  "Purpose: numeric allowance for this entitlement.",
                  "Values: for quota schemas, use a positive integer in the unit implied by the code."
                ),
                minimum: 0
              },
              interval: {
                type: "string",
                title: "Interval",
                description: helpLines(
                  "Naming: choose one enum value.",
                  "Purpose: reset window for quota accounting.",
                  "Values: day=daily reset, week=weekly reset, month=monthly reset, year=yearly reset."
                ),
                enum: ["day", "week", "month", "year"]
              },
              enforcement: {
                type: "string",
                title: "Enforcement",
                description: helpLines(
                  "Naming: choose one enum value.",
                  "Purpose: controls behavior when usage reaches the limit.",
                  "Values: hard=deny over-limit actions, soft=allow and mark over-limit state."
                ),
                enum: ["hard", "soft"]
              },
              enabled: {
                type: "boolean",
                title: "Enabled",
                description: helpLines(
                  "Naming: true or false.",
                  "Purpose: boolean switch for entitlement.boolean.v1 definitions.",
                  "Values: true=enabled, false=disabled."
                )
              },
              values: {
                type: "array",
                title: "Values",
                description: helpLines(
                  "Naming: non-empty unique strings.",
                  "Purpose: list payload for entitlement.string_list.v1 definitions.",
                  "Values: each item is one allowed string in that list."
                ),
                uniqueItems: true,
                items: {
                  type: "string",
                  minLength: 1
                }
              }
            }
          },
          grantKind: {
            type: "string",
            title: "Grant kind",
            description: helpLines(
              "Naming: choose one enum value.",
              "Purpose: classifies the source/type of grant emitted from this plan template.",
              "Values: plan_base=normal plan allowance, plan_bonus=bonus/promo allowance."
            ),
            enum: ["plan_base", "plan_bonus"]
          },
          effectivePolicy: {
            type: "string",
            title: "Effective policy",
            description: helpLines(
              "Naming: choose one enum value.",
              "Purpose: stores when the grant is intended to become effective in billing policy.",
              "Values: on_assignment_current=effective with current assignment, on_period_paid=intended paid-period policy (use only if your flow depends on it)."
            ),
            enum: ["on_assignment_current", "on_period_paid"]
          },
          durationPolicy: {
            type: "string",
            title: "Duration policy",
            description: helpLines(
              "Naming: choose one enum value.",
              "Purpose: controls expiration window for plan grants.",
              "Values: while_current=expires at assignment period end, period_window=period-scoped expiry (same period-end behavior), fixed_duration=expires after durationDays."
            ),
            enum: ["while_current", "period_window", "fixed_duration"]
          },
          durationDays: {
            type: "integer",
            title: "Duration days",
            description: helpLines(
              "Naming: positive integer.",
              "Purpose: explicit lifetime in days for fixed-duration grants.",
              "Values: required only when durationPolicy=fixed_duration; otherwise leave empty."
            ),
            minimum: 1
          },
          metadataJson: {
            type: "object",
            title: "Metadata",
            description: "Optional key/value metadata for this entitlement.",
            default: {},
            patternProperties: {
              "^[a-zA-Z0-9_.:-]+$": {
                type: "string",
                title: "Value",
                minLength: 1
              }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
});

const PLAN_ENTITLEMENTS_EDITOR_OPTIONS = Object.freeze({
  density: "compact"
});

const PLAN_ENTITLEMENTS_EDITOR_DEFAULT_PROPS = Object.freeze({
  VTextField: {
    variant: "outlined",
    hideDetails: "auto"
  },
  VNumberInput: {
    variant: "outlined",
    hideDetails: "auto"
  },
  VSelect: {
    variant: "outlined",
    hideDetails: "auto"
  },
  VTextarea: {
    variant: "outlined",
    hideDetails: "auto",
    rows: 2
  },
  "VjsfList-VCard": {
    border: false,
    flat: true,
    rounded: "lg"
  },
  "VjsfList-VList": {
    class: "py-1 px-1"
  },
  "VjsfList-VListItem": {
    variant: "tonal",
    rounded: "lg",
    class: "pa-4 mb-4"
  }
});

const PLAN_FIELD_HELP = Object.freeze({
  code: [
    "1) Naming: stable lowercase identifier (example: pro_monthly).",
    "2) Purpose: immutable technical id for the plan.",
    "3) Values: must be unique; treat this as a durable key, not display copy."
  ].join("\n"),
  name: [
    "1) Naming: human-readable title (example: Pro Monthly).",
    "2) Purpose: admin/customer display label.",
    "3) Values: can be changed later; does not replace code as identifier."
  ].join("\n"),
  isActive: [
    "1) Naming: boolean switch.",
    "2) Purpose: controls whether the plan is selectable for new assignments.",
    "3) Values: active=can be offered, inactive=hidden for new changes."
  ].join("\n"),
  billingMode: [
    "1) Naming: choose paid or free.",
    "2) Purpose: defines whether provider checkout pricing is required.",
    "3) Values: paid=requires mapped provider price, free=no provider checkout price."
  ].join("\n"),
  description: [
    "1) Naming: plain-language summary.",
    "2) Purpose: internal/admin-facing context for the plan.",
    "3) Values: optional text; safe to update without changing plan id."
  ].join("\n"),
  providerPriceId: [
    "1) Naming: provider price id (for Stripe, price_...).",
    "2) Purpose: links this plan to provider amount + interval at checkout.",
    "3) Values: must match an active recurring catalog price."
  ].join("\n")
});

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function buildEntitlementsEditorSchema(codeOptions = []) {
  const schema = cloneJson(PLAN_ENTITLEMENTS_EDITOR_SCHEMA, PLAN_ENTITLEMENTS_EDITOR_SCHEMA);
  const options = Array.isArray(codeOptions) ? codeOptions : [];
  const codeField = schema?.properties?.entitlements?.items?.properties?.code;
  if (!codeField || options.length < 1) {
    return schema;
  }

  codeField.oneOf = options;
  return schema;
}

function normalizeEntitlementsEntries(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => cloneJson(entry, {}));
}

function createEntitlementsEditorModel(entries = []) {
  return {
    entitlements: normalizeEntitlementsEntries(entries)
  };
}

function collectEntitlementsFromEditorModel(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return normalizeEntitlementsEntries(source.entitlements);
}

function formatMoneyMinor(amountMinor, currency) {
  const numericAmount = Number(amountMinor || 0);
  const normalizedCurrency =
    String(currency || "")
      .trim()
      .toUpperCase() || "USD";
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
  const normalizedInterval =
    String(interval || "")
      .trim()
      .toLowerCase() || "month";
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
    entitlementsModel: createEntitlementsEditorModel()
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
    entitlementsModel: createEntitlementsEditorModel()
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

  const currency = String(price.currency || "")
    .trim()
    .toUpperCase();
  const unitAmountMinor = Number(price.unitAmountMinor);
  const hasAmount = Number.isInteger(unitAmountMinor) && unitAmountMinor >= 0 && currency.length === 3;

  const interval = String(price.interval || "")
    .trim()
    .toLowerCase();
  const intervalCount = Number(price.intervalCount);
  const hasInterval = interval && Number.isInteger(intervalCount) && intervalCount > 0;

  const usageType =
    String(price.usageType || "")
      .trim()
      .toLowerCase() || null;
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
  const entitlementDefinitions = computed(() =>
    normalizeEntitlementDefinitions(plansQuery.data.value?.entitlementDefinitions)
  );
  const entitlementCodeOptions = computed(() =>
    buildEntitlementCodeSelectOptions({
      definitions: entitlementDefinitions.value,
      plans: plans.value
    })
  );
  const entitlementsEditorSchema = computed(() => buildEntitlementsEditorSchema(entitlementCodeOptions.value));
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
    createForm.billingMode === "paid"
      ? findProviderPriceById(selectableProviderPrices.value, createForm.providerPriceId)
      : null
  );

  const editSelectedProviderPrice = computed(() =>
    editForm.billingMode === "paid"
      ? findProviderPriceById(selectableProviderPrices.value, editForm.providerPriceId)
      : null
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

  const selectedPlan = computed(
    () => plans.value.find((plan) => Number(plan?.id || 0) === Number(selectedPlanId.value || 0)) || null
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
    editForm.entitlementsModel = createEntitlementsEditorModel(plan.entitlements);
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
    const entitlements = collectEntitlementsFromEditorModel(createForm.entitlementsModel);

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

    const entitlements = collectEntitlementsFromEditorModel(editForm.entitlementsModel);

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
      planBillingModeOptions,
      fieldHelp: PLAN_FIELD_HELP,
      get entitlementsEditorSchema() {
        return entitlementsEditorSchema.value;
      },
      entitlementsEditorOptions: PLAN_ENTITLEMENTS_EDITOR_OPTIONS,
      entitlementsEditorDefaultProps: PLAN_ENTITLEMENTS_EDITOR_DEFAULT_PROPS
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
