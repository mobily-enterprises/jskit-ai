<template>
  <v-app>
    <v-main class="app-main">
      <v-container class="py-6">
        <v-row class="mb-3" align="center">
          <v-col cols="12" md="8">
            <h1 class="text-h4 font-weight-bold mb-1">Annuity Value Calculator</h1>
            <p class="text-medium-emphasis mb-0">Calculate present/future values and browse saved request history.</p>
          </v-col>
          <v-col cols="12" md="4" class="d-flex justify-md-end">
            <v-btn color="secondary" variant="outlined" prepend-icon="mdi-logout" @click="logout"> Log Out </v-btn>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" md="8">
            <v-card rounded="xl" elevation="6" class="h-100">
              <v-card-title class="text-subtitle-1 font-weight-bold">Inputs</v-card-title>
              <v-divider />
              <v-card-text>
                <v-form @submit.prevent="calculate">
                  <v-row>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="form.mode"
                        label="Calculate"
                        :items="modeOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="form.timing"
                        label="Payment timing"
                        :items="timingOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-text-field
                        v-model.number="form.payment"
                        label="Payment each period"
                        type="number"
                        min="0"
                        step="0.01"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-text-field
                        v-model.number="form.annualRate"
                        label="Annual interest rate (%)"
                        type="number"
                        step="0.01"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12">
                      <v-checkbox
                        v-model="form.isPerpetual"
                        label="Perpetual horizon (PV only)"
                        color="primary"
                        hide-details
                      />
                    </v-col>

                    <v-col v-if="!form.isPerpetual" cols="12" sm="6">
                      <v-text-field
                        v-model.number="form.years"
                        label="Number of years"
                        type="number"
                        min="0"
                        step="0.1"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-text-field
                        v-model.number="form.paymentsPerYear"
                        label="Payments per year"
                        type="number"
                        min="1"
                        step="1"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>

                    <v-col cols="12">
                      <v-checkbox v-model="form.useGrowth" label="Use growing annuity" color="primary" hide-details />
                    </v-col>

                    <v-col v-if="form.useGrowth" cols="12" sm="6">
                      <v-text-field
                        v-model.number="form.annualGrowthRate"
                        label="Annual payment growth rate (%)"
                        type="number"
                        step="0.01"
                        variant="outlined"
                        density="comfortable"
                        hint="3 means payments grow by about 3% each year"
                        persistent-hint
                      />
                    </v-col>
                  </v-row>

                  <v-alert v-if="calcError" type="error" variant="tonal" class="mb-3">
                    {{ calcError }}
                  </v-alert>

                  <v-alert v-if="calcWarnings.length" type="warning" variant="tonal" class="mb-3">
                    <ul class="pl-4 mb-0">
                      <li v-for="warning in calcWarnings" :key="warning">
                        {{ warning }}
                      </li>
                    </ul>
                  </v-alert>

                  <v-alert type="info" variant="tonal" class="mb-3">
                    Annual discount is converted as <code>annualRate / 100 / paymentsPerYear</code>. Annual growth is
                    converted as <code>(1 + annualGrowthRate / 100)^(1/paymentsPerYear) - 1</code>. Perpetual PV
                    requires discount strictly above growth.
                  </v-alert>

                  <div class="d-flex flex-wrap ga-3">
                    <v-btn color="primary" type="submit" :loading="calculating">Calculate</v-btn>
                    <v-btn variant="outlined" @click="resetForm">Reset</v-btn>
                  </div>
                </v-form>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="4">
            <v-card rounded="xl" elevation="6" class="h-100">
              <v-card-title class="text-subtitle-1 font-weight-bold">Result</v-card-title>
              <v-divider />
              <v-card-text>
                <template v-if="result">
                  <v-chip color="amber-darken-1" label class="mb-4">
                    {{ result.mode === "fv" ? "Future Value" : "Present Value" }}
                  </v-chip>
                  <p class="text-h4 text-primary font-weight-bold mb-2">{{ formatCurrency(result.value) }}</p>
                  <p class="text-body-2 text-medium-emphasis mb-0">
                    {{ resultSummary }}
                  </p>

                  <v-alert v-if="resultWarnings.length" type="warning" variant="tonal" class="mt-4 mb-0">
                    <ul class="pl-4 mb-0">
                      <li v-for="warning in resultWarnings" :key="warning">
                        {{ warning }}
                      </li>
                    </ul>
                  </v-alert>
                </template>

                <template v-else>
                  <p class="text-medium-emphasis mb-0">Run a calculation to see results.</p>
                </template>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-card rounded="xl" elevation="6" class="mt-6">
          <v-card-title class="d-flex flex-wrap align-center ga-3">
            <span class="text-subtitle-1 font-weight-bold">Past Calculations</span>
            <v-spacer />
            <v-select
              v-model.number="historyPageSize"
              :items="pageSizeOptions"
              label="Rows"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 120px"
              @update:model-value="onPageSizeChange"
            />
            <v-btn variant="outlined" :loading="historyLoading" @click="loadHistory">Refresh</v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-alert v-if="historyError" type="error" variant="tonal" class="mb-3">
              {{ historyError }}
            </v-alert>

            <div class="history-table-wrap">
              <v-table density="comfortable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Inputs</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!historyEntries.length">
                    <td colspan="4" class="text-center text-medium-emphasis py-6">No calculations yet.</td>
                  </tr>
                  <tr v-for="entry in historyEntries" :key="entry.id">
                    <td>{{ formatDate(entry.createdAt) }}</td>
                    <td>{{ typeLabel(entry) }}</td>
                    <td>{{ inputSummary(entry) }}</td>
                    <td>{{ formatCurrency(entry.value) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>

            <div class="d-flex align-center justify-end ga-4 mt-4">
              <p class="text-body-2 text-medium-emphasis mb-0">
                Page {{ historyPage }} of {{ historyTotalPages }} ({{ historyTotal }} total)
              </p>
              <v-btn-group variant="outlined">
                <v-btn :disabled="historyPage <= 1 || historyLoading" @click="goToPreviousPage">Previous</v-btn>
                <v-btn :disabled="historyPage >= historyTotalPages || historyLoading" @click="goToNextPage">Next</v-btn>
              </v-btn-group>
            </div>
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";

const navigate = useNavigate();
const authStore = useAuthStore();
const queryClient = useQueryClient();

const modeOptions = [
  { title: "Future Value (FV)", value: "fv" },
  { title: "Present Value (PV)", value: "pv" }
];

const timingOptions = [
  { title: "End of period (ordinary annuity)", value: "ordinary" },
  { title: "Beginning of period (annuity due)", value: "due" }
];

const pageSizeOptions = [10, 25, 50];

const form = reactive({
  mode: "fv",
  payment: 500,
  annualRate: 6,
  annualGrowthRate: 3,
  isPerpetual: false,
  years: 20,
  paymentsPerYear: 12,
  timing: "ordinary",
  useGrowth: false
});

const calcError = ref("");
const calcWarnings = ref([]);
const result = ref(null);

const historyError = ref("");
const historyPage = ref(1);
const historyPageSize = ref(10);
const historyEnabled = ref(false);

const asCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function redirectToLogin() {
  navigate({ to: "/login", replace: true });
}

function payloadFromForm() {
  return {
    mode: form.mode,
    payment: Number(form.payment),
    annualRate: Number(form.annualRate),
    annualGrowthRate: form.useGrowth ? Number(form.annualGrowthRate) : 0,
    years: form.isPerpetual ? undefined : Number(form.years),
    paymentsPerYear: Number(form.paymentsPerYear),
    timing: form.timing,
    isPerpetual: Boolean(form.isPerpetual)
  };
}

function formatCurrency(value) {
  return asCurrency.format(Number(value) || 0);
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function typeLabel(entry) {
  if (entry.isPerpetual) {
    return `${entry.mode === "fv" ? "FV" : "PV"} · ${entry.timing === "due" ? "Due" : "Ordinary"} · Perpetual`;
  }

  const base = `${entry.mode === "fv" ? "FV" : "PV"} · ${entry.timing === "due" ? "Due" : "Ordinary"}`;
  if (Math.abs(Number(entry.annualGrowthRate) || 0) < 1e-12) {
    return base;
  }
  return `${base} · +${Number(entry.annualGrowthRate).toFixed(2)}% growth`;
}

function inputSummary(entry) {
  const horizonText = entry.isPerpetual ? "perpetual horizon" : `${Number(entry.years)} years`;
  return `${formatCurrency(entry.payment)}, ${Number(entry.annualRate).toFixed(2)}% rate, ${horizonText}, ${entry.paymentsPerYear}/year`;
}

async function loadHistory() {
  await historyQuery.refetch();
}

const historyQuery = useQuery({
  queryKey: computed(() => ["history", historyPage.value, historyPageSize.value]),
  queryFn: () => api.history(historyPage.value, historyPageSize.value),
  enabled: historyEnabled,
  placeholderData: (previous) => previous
});

const calculateMutation = useMutation({
  mutationFn: (payload) => api.calculate(payload)
});

const historyEntries = computed(() => {
  const entries = historyQuery.data.value?.entries;
  return Array.isArray(entries) ? entries : [];
});

const historyTotal = computed(() => Number(historyQuery.data.value?.total) || 0);
const historyTotalPages = computed(() => Number(historyQuery.data.value?.totalPages) || 1);
const historyLoading = computed(() => historyQuery.isPending.value || historyQuery.isFetching.value);

watch(
  () => historyQuery.error.value,
  (error) => {
    if (!error) {
      historyError.value = "";
      return;
    }

    if (error.status === 401) {
      authStore.setSignedOut();
      redirectToLogin();
      return;
    }

    historyError.value = error.message;
  }
);

const calculating = computed(() => calculateMutation.isPending.value);

async function calculate() {
  calcError.value = "";
  calcWarnings.value = [];

  if (form.isPerpetual && form.mode !== "pv") {
    calcError.value = "Perpetual calculations are only supported for present value (PV).";
    return;
  }

  try {
    const data = await calculateMutation.mutateAsync(payloadFromForm());
    result.value = data;
    calcWarnings.value = Array.isArray(data.warnings) ? data.warnings : [];

    historyPage.value = 1;
    await queryClient.invalidateQueries({ queryKey: ["history"] });
  } catch (error) {
    if (error.status === 401) {
      authStore.setSignedOut();
      redirectToLogin();
      return;
    }
    if (error.fieldErrors && typeof error.fieldErrors === "object") {
      const details = Object.values(error.fieldErrors).filter(Boolean);
      calcError.value = details.length ? details.join(" ") : error.message;
    } else {
      calcError.value = error.message;
    }
  }
}

function resetForm() {
  form.mode = "fv";
  form.payment = 500;
  form.annualRate = 6;
  form.annualGrowthRate = 3;
  form.isPerpetual = false;
  form.years = 20;
  form.paymentsPerYear = 12;
  form.timing = "ordinary";
  form.useGrowth = false;
  calcError.value = "";
  calcWarnings.value = [];
  result.value = null;
}

async function logout() {
  try {
    await api.logout();
  } finally {
    api.clearCsrfTokenCache();
    authStore.setSignedOut();
    await authStore.invalidateSession();
    redirectToLogin();
  }
}

function goToPreviousPage() {
  if (historyPage.value <= 1 || historyLoading.value) {
    return;
  }
  historyPage.value -= 1;
}

function goToNextPage() {
  if (historyPage.value >= historyTotalPages.value || historyLoading.value) {
    return;
  }
  historyPage.value += 1;
}

function onPageSizeChange() {
  historyPage.value = 1;
}

const resultSummary = computed(() => {
  if (!result.value) {
    return "";
  }

  const growthText =
    Math.abs(Number(result.value.annualGrowthRate) || 0) < 1e-12
      ? "no payment growth"
      : `${Number(result.value.annualGrowthRate).toFixed(2)}% annual payment growth`;

  const timingText = result.value.timing === "due" ? "annuity due" : "ordinary annuity";
  const horizonText = result.value.isPerpetual
    ? "perpetual horizon"
    : `${Number(result.value.years)} years (${Number(result.value.totalPeriods).toFixed(2)} periods)`;

  return `${result.value.paymentsPerYear} payments/year, ${horizonText}, ${Number(result.value.annualRate).toFixed(
    2
  )}% annual rate, ${growthText}, ${timingText}.`;
});

const resultWarnings = computed(() => {
  if (!result.value || !Array.isArray(result.value.warnings)) {
    return [];
  }
  return result.value.warnings;
});

onMounted(() => {
  historyEnabled.value = true;
});
</script>

<style scoped>
.app-main {
  background:
    radial-gradient(circle at 10% 10%, rgba(240, 180, 41, 0.2), transparent 45%),
    radial-gradient(circle at 90% 90%, rgba(0, 104, 74, 0.2), transparent 35%), #f3f4ee;
}

.history-table-wrap {
  overflow-x: auto;
  border: 1px solid #dce4e2;
  border-radius: 14px;
  background: #fcfdfc;
}
</style>
