<template>
  <v-row>
    <v-col cols="12" lg="8">
      <v-card class="panel-card h-100" rounded="lg" elevation="1" border>
        <v-card-item>
          <v-card-title class="panel-title">Calculator</v-card-title>
          <v-card-subtitle>Present and future value, including growth assumptions.</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-5">
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
                <v-checkbox v-model="form.isPerpetual" label="Perpetual horizon (PV only)" color="primary" hide-details />
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

            <v-expansion-panels variant="accordion" class="mb-3">
              <v-expansion-panel>
                <v-expansion-panel-title>Assumptions and conversions</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <ul class="assumption-list">
                    <li>Periodic discount = annualRate / 100 / paymentsPerYear.</li>
                    <li>Periodic growth = (1 + annualGrowthRate / 100)^(1/paymentsPerYear) - 1.</li>
                    <li>Ordinary annuity means end-of-period payments; due means start-of-period payments.</li>
                    <li>Perpetual PV requires discount strictly greater than growth.</li>
                  </ul>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div class="d-flex flex-wrap ga-3">
              <v-btn color="primary" type="submit" :loading="calculating">Calculate</v-btn>
              <v-btn variant="text" @click="resetForm">Reset</v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card class="panel-card h-100" rounded="lg" elevation="1" border>
        <v-card-item>
          <v-card-title class="panel-title">Result</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <template v-if="result">
            <v-chip color="primary" label class="mb-4">
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
</template>

<script setup>
import { useAnnuityCalculatorForm } from "./useAnnuityCalculatorForm";

const emit = defineEmits(["calculated"]);

const {
  modeOptions,
  timingOptions,
  form,
  calcError,
  calcWarnings,
  result,
  calculating,
  calculate,
  resetForm,
  formatCurrency,
  resultSummary,
  resultWarnings
} = useAnnuityCalculatorForm({
  onCalculated: async (data) => {
    emit("calculated", data);
  }
});
</script>

<style scoped>
.panel-card {
  background-color: rgb(var(--v-theme-surface));
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.assumption-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.6;
}
</style>
