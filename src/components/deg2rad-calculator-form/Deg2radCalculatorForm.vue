<template>
  <v-row>
    <v-col cols="12">
      <v-card class="panel-card h-100" rounded="lg" elevation="1" border>
        <v-card-item>
          <v-card-title class="panel-title">DEG2RAD Calculator</v-card-title>
          <v-card-subtitle>One input, one output. Server-side DEG2RAD conversion only.</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-5">
          <v-form @submit.prevent="actions.calculate">
            <v-row>
              <v-col cols="12" sm="8" md="6">
                <v-text-field
                  v-model.number="state.form.DEG2RAD_degrees"
                  label="DEG2RAD_degrees"
                  type="number"
                  step="0.000001"
                  variant="outlined"
                  density="comfortable"
                  hint="Enter degrees. The server returns radians using DEG2RAD(x) = x * PI / 180."
                  persistent-hint
                />
              </v-col>
            </v-row>

            <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
              {{ state.error }}
            </v-alert>

            <v-expansion-panels variant="accordion" class="mb-3">
              <v-expansion-panel>
                <v-expansion-panel-title>DEG2RAD operation</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <ul class="assumption-list">
                    <li>DEG2RAD converts degrees to radians with x * PI / 180.</li>
                    <li>Conversion is always processed on the server.</li>
                  </ul>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div class="d-flex flex-wrap ga-3">
              <v-btn color="primary" type="submit" :loading="state.calculating">Calculate</v-btn>
              <v-btn variant="text" @click="actions.resetForm">Reset</v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <v-card class="panel-card h-100" rounded="lg" elevation="1" border>
        <v-card-item>
          <v-card-title class="panel-title">DEG2RAD Result</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <template v-if="state.result">
            <v-chip color="primary" label class="mb-4">DEG2RAD</v-chip>
            <p class="text-h4 text-primary font-weight-bold mb-2">{{ state.result.DEG2RAD_radians }} rad</p>
            <p class="text-body-2 text-medium-emphasis mb-0">{{ state.resultSummary }}</p>
          </template>
          <template v-else>
            <p class="text-medium-emphasis mb-0">Run DEG2RAD conversion to see radians.</p>
          </template>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup>
import { useDeg2radCalculatorForm } from "./useDeg2radCalculatorForm";

const emit = defineEmits(["calculated"]);

const { state, actions } = useDeg2radCalculatorForm({
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
