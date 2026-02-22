<template>
  <section class="workspace-billing-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Workspace billing</v-card-title>
        <v-card-subtitle>Current plan, upcoming changes, and one-off extras.</v-card-subtitle>
      </v-card-item>
      <v-divider />

      <v-card-text>
        <v-alert v-if="state.actionError" type="error" variant="tonal" class="mb-3">
          {{ state.actionError }}
        </v-alert>
        <v-alert v-if="state.actionSuccess" type="success" variant="tonal" class="mb-3">
          {{ state.actionSuccess }}
        </v-alert>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <v-row dense>
          <v-col cols="12" lg="7">
            <v-card rounded="lg" variant="tonal" class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Current plan</v-card-title>
                <v-card-subtitle v-if="state.currentPlan">
                  Current plan remains active until {{ meta.formatDateOnly(state.currentPlanExpiresAt) }}.
                </v-card-subtitle>
                <v-card-subtitle v-else>No active plan assigned yet.</v-card-subtitle>
              </v-card-item>

              <v-card-text v-if="state.currentPlan">
                <div class="d-flex flex-wrap align-center ga-2 mb-2">
                  <span class="text-h6 font-weight-bold">{{ state.currentPlan.name || state.currentPlan.code }}</span>
                  <v-chip size="small" label>
                    {{ state.currentPlan.code }}
                  </v-chip>
                </div>
                <div class="text-body-2 mb-2">{{ state.currentPlan.description || "No description." }}</div>
                <div class="text-body-2 text-medium-emphasis mb-2">
                  Current period ends: <strong>{{ meta.formatDateOnly(state.currentPlanExpiresAt) }}</strong>
                </div>
                <div v-if="state.currentPlan.corePrice" class="text-body-2 text-medium-emphasis">
                  Core price:
                  {{
                    meta.formatMoneyMinor(
                      state.currentPlan.corePrice.unitAmountMinor,
                      state.currentPlan.corePrice.currency
                    )
                  }}
                  / {{ state.currentPlan.corePrice.interval }}
                </div>
              </v-card-text>

              <v-card-text v-else>
                <div class="text-body-2 text-medium-emphasis">
                  Choose a plan below. Free plans apply immediately, paid plans can require checkout.
                </div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" lg="5">
            <v-card rounded="lg" variant="tonal" class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Scheduled change</v-card-title>
                <v-card-subtitle v-if="state.nextPlanChange">
                  The downgrade will take effect on {{ meta.formatDateOnly(state.nextPlanChange.effectiveAt) }}.
                </v-card-subtitle>
                <v-card-subtitle v-else>No scheduled plan change.</v-card-subtitle>
              </v-card-item>

              <v-card-text v-if="state.nextPlanChange">
                <div class="text-body-1 font-weight-medium mb-1">
                  {{ state.nextPlanChange.targetPlan.name || state.nextPlanChange.targetPlan.code }}
                </div>
                <div class="text-body-2 text-medium-emphasis mb-3">
                  Effective {{ meta.formatDateOnly(state.nextPlanChange.effectiveAt) }}
                </div>
                <v-btn
                  variant="outlined"
                  color="primary"
                  :loading="state.cancelPlanChangeLoading"
                  @click="actions.cancelPendingPlanChange"
                >
                  Cancel scheduled change
                </v-btn>
              </v-card-text>

              <v-card-text v-else>
                <div class="text-body-2 text-medium-emphasis">
                  Downgrades are scheduled to your period end; upgrades apply immediately.
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-card rounded="lg" variant="tonal" class="mt-4">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Change core plan</v-card-title>
            <v-card-subtitle>
              Select a different plan. Current plan is excluded from options.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div class="d-flex flex-wrap ga-3 align-center mb-2">
              <v-select
                :model-value="state.selectedPlanCode"
                :items="state.planOptions"
                item-title="title"
                item-value="value"
                label="Target plan"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="(value) => (state.selectedPlanCode = String(value || ''))"
              />

              <v-btn color="primary" :loading="state.planChangeLoading" @click="actions.submitPlanChange">
                Change plan
              </v-btn>

              <a v-if="state.lastCheckoutUrl" :href="state.lastCheckoutUrl" target="_blank" rel="noopener noreferrer">
                Open checkout
              </a>
            </div>

            <div v-if="state.selectedTargetPlan" class="text-body-2 text-medium-emphasis">
              {{ state.selectedTargetPlan.description || "No description." }}
            </div>
            <div class="text-caption text-medium-emphasis mt-2">
              Paid-plan payment-method policy: <strong>{{ state.paymentPolicy }}</strong>
            </div>
          </v-card-text>
        </v-card>

        <v-card rounded="lg" variant="tonal" class="mt-4">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Effective change history</v-card-title>
            <v-card-subtitle>Only changes that actually took effect are listed.</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Effective at</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!state.historyEntries.length">
                  <td colspan="4" class="text-medium-emphasis">No effective plan changes yet.</td>
                </tr>
                <tr v-for="entry in state.historyEntries" :key="entry.id">
                  <td>{{ meta.formatDateTime(entry.effectiveAt) }}</td>
                  <td>{{ entry.fromPlan?.name || entry.fromPlan?.code || "-" }}</td>
                  <td>{{ entry.toPlan?.name || entry.toPlan?.code || "-" }}</td>
                  <td>{{ entry.changeKind }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>

        <v-card variant="tonal" rounded="lg" class="mt-4">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">One-off purchases</v-card-title>
            <v-card-subtitle>Create payment links from catalog items or ad-hoc pricing.</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-radio-group v-model="state.oneOffMode" inline hide-details class="mb-3">
              <v-radio
                v-for="entry in meta.oneOffModeOptions"
                :key="entry.value"
                :label="entry.title"
                :value="entry.value"
              />
            </v-radio-group>

            <div v-if="state.oneOffMode === 'catalog'" class="d-flex flex-wrap ga-3 align-center mb-3">
              <v-select
                :model-value="state.selectedCatalogPriceId"
                :items="state.catalogItems"
                item-title="title"
                item-value="value"
                label="Catalog item"
                density="compact"
                variant="outlined"
                hide-details
                class="catalog-field"
                @update:model-value="(value) => (state.selectedCatalogPriceId = String(value || ''))"
              />
              <v-text-field
                v-model="state.selectedCatalogQuantity"
                type="number"
                min="1"
                label="Qty"
                density="compact"
                variant="outlined"
                hide-details
                class="qty-field"
              />
              <v-btn color="primary" :loading="state.paymentLinkLoading" @click="actions.createCatalogPaymentLink">
                Create catalog payment link
              </v-btn>
            </div>

            <div v-else class="d-flex flex-wrap ga-3 align-center mb-3">
              <v-text-field
                v-model="state.adHocName"
                label="Item name"
                density="compact"
                variant="outlined"
                hide-details
                class="catalog-field"
              />
              <v-text-field
                v-model="state.adHocAmountMinor"
                type="number"
                min="1"
                label="Amount (minor units)"
                density="compact"
                variant="outlined"
                hide-details
                class="qty-field"
              />
              <v-text-field
                v-model="state.adHocQuantity"
                type="number"
                min="1"
                label="Qty"
                density="compact"
                variant="outlined"
                hide-details
                class="qty-field"
              />
              <v-btn color="primary" :loading="state.paymentLinkLoading" @click="actions.createAdHocPaymentLink">
                Create ad-hoc payment link
              </v-btn>
            </div>

            <a v-if="state.lastPaymentLinkUrl" :href="state.lastPaymentLinkUrl" target="_blank" rel="noopener noreferrer">
              Open payment link
            </a>
          </v-card-text>
        </v-card>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useWorkspaceBillingView } from "./useWorkspaceBillingView.js";

const { meta, state, actions } = useWorkspaceBillingView();
</script>

<style scoped>
.filters-field {
  min-width: 220px;
  max-width: 340px;
}

.catalog-field {
  min-width: 240px;
  max-width: 420px;
}

.qty-field {
  width: 120px;
}
</style>
