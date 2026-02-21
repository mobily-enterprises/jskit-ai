<template>
  <section class="console-billing-plans-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Billing plans</span>
        <v-spacer />
        <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
        <v-btn color="primary" @click="actions.openCreateDialog">Add plan</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.plansLoadError" type="error" variant="tonal" class="mb-3">
          {{ state.plansLoadError }}
        </v-alert>
        <v-alert v-if="state.providerPricesLoadError" type="warning" variant="tonal" class="mb-3">
          {{ state.providerPricesLoadError }}
        </v-alert>
        <v-alert v-if="state.submitError" type="error" variant="tonal" class="mb-3">
          {{ state.submitError }}
        </v-alert>
        <v-alert v-if="state.submitMessage" type="success" variant="tonal" class="mb-3">
          {{ state.submitMessage }}
        </v-alert>

        <div class="billing-plans-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Family / Version</th>
                <th>Pricing model</th>
                <th>Base price</th>
                <th>Prices</th>
                <th>Entitlements</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.tableRows.length">
                <td colspan="8" class="text-center text-medium-emphasis py-6">No billing plans yet.</td>
              </tr>
              <tr v-for="row in state.tableRows" :key="row.id">
                <td>
                  <div class="d-flex align-center ga-2">
                    <span>{{ row.code }}</span>
                    <v-chip
                      size="x-small"
                      label
                      :color="row.isActive ? 'primary' : 'default'"
                      :variant="row.isActive ? 'tonal' : 'outlined'"
                    >
                      {{ row.isActive ? "Active" : "Inactive" }}
                    </v-chip>
                  </div>
                </td>
                <td>{{ row.name || "-" }}</td>
                <td>{{ row.planFamilyCode || "-" }} / v{{ row.version || "-" }}</td>
                <td>{{ row.pricingModel || "-" }}</td>
                <td>{{ meta.formatPriceSummary(row.basePrice) }}</td>
                <td>{{ row.pricesCount }}</td>
                <td>{{ row.entitlementsCount }}</td>
                <td class="text-right">
                  <div class="d-inline-flex ga-2">
                    <v-btn size="small" variant="text" @click="actions.openViewDialog(row.id)">View</v-btn>
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      :disabled="!row.basePrice"
                      @click="actions.openEditDialog(row.id, row.basePrice?.id)"
                    >
                      Edit
                    </v-btn>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="state.createDialogOpen" max-width="980">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">Create billing plan</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="state.createForm.code"
                label="Plan code"
                variant="outlined"
                density="compact"
                :error-messages="state.createFieldErrors.code"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="state.createForm.planFamilyCode"
                label="Plan family code"
                variant="outlined"
                density="compact"
                :error-messages="state.createFieldErrors.planFamilyCode"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="state.createForm.version"
                label="Version"
                variant="outlined"
                density="compact"
                type="number"
                min="1"
                :error-messages="state.createFieldErrors.version"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="state.createForm.name"
                label="Plan name"
                variant="outlined"
                density="compact"
                :error-messages="state.createFieldErrors.name"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="state.createForm.pricingModel"
                :items="meta.pricingModelOptions"
                item-title="title"
                item-value="value"
                label="Pricing model"
                variant="outlined"
                density="compact"
                :error-messages="state.createFieldErrors.pricingModel"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="state.createForm.description"
                label="Description"
                variant="outlined"
                density="compact"
                rows="2"
                auto-grow
              />
            </v-col>
          </v-row>

          <v-divider class="my-2" />
          <div class="text-body-2 font-weight-medium mb-1">Base price</div>
          <div class="text-caption text-medium-emphasis mb-2">
            {{ state.ui.basePriceDescription }}
          </div>
          <v-row dense>
            <v-col cols="12" md="6">
              <v-select
                v-model="state.createForm.providerPriceId"
                :items="state.providerPriceOptions"
                item-title="title"
                item-value="value"
                :label="state.ui.catalogPriceLabel"
                variant="outlined"
                density="compact"
                :loading="state.providerPricesLoading"
                :no-data-text="
                  state.providerPricesLoading ? state.ui.catalogPriceNoDataLoading : state.ui.catalogPriceNoDataEmpty
                "
                :hint="state.ui.catalogPriceHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.providerPriceId']"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="state.createForm.providerProductId"
                :label="state.ui.productLabel"
                variant="outlined"
                density="compact"
                :readonly="state.isCreatePriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.providerProductId']"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="state.createForm.currency"
                label="Currency"
                variant="outlined"
                density="compact"
                maxlength="3"
                :readonly="state.isCreatePriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.currency']"
              />
            </v-col>
            <v-col v-if="state.ui.showUnitAmountField !== false" cols="12" md="4">
              <v-text-field
                v-model.number="state.createForm.unitAmountMinor"
                :label="state.ui.amountLabel"
                variant="outlined"
                density="compact"
                type="number"
                min="0"
                :readonly="state.isCreatePriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.unitAmountMinor']"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="state.createForm.interval"
                :items="meta.intervalOptions"
                item-title="title"
                item-value="value"
                :label="state.ui.intervalLabel"
                variant="outlined"
                density="compact"
                :disabled="state.isCreatePriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.interval']"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="state.createForm.intervalCount"
                :label="state.ui.intervalCountLabel"
                variant="outlined"
                density="compact"
                type="number"
                min="1"
                :readonly="state.isCreatePriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.createFieldErrors['basePrice.intervalCount']"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="state.createForm.entitlementsJson"
                label="Entitlements JSON array"
                variant="outlined"
                density="compact"
                rows="4"
                auto-grow
                :error-messages="state.createFieldErrors['entitlements[0].valueJson']"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="actions.closeCreateDialog">Cancel</v-btn>
          <v-btn color="primary" :loading="state.isSavingCreate" @click="actions.submitCreatePlan">Create plan</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="state.viewDialogOpen" max-width="980">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">Plan details</v-card-title>
        <v-divider />
        <v-card-text v-if="state.selectedPlan">
          <div class="text-body-2 mb-3">
            <div><strong>Code:</strong> {{ state.selectedPlan.code }}</div>
            <div><strong>Name:</strong> {{ state.selectedPlan.name || "-" }}</div>
            <div><strong>Family / version:</strong> {{ state.selectedPlan.planFamilyCode || "-" }} / v{{ state.selectedPlan.version || "-" }}</div>
            <div><strong>Pricing model:</strong> {{ state.selectedPlan.pricingModel || "-" }}</div>
            <div><strong>Description:</strong> {{ state.selectedPlan.description || "-" }}</div>
          </div>

          <div class="text-body-2 font-weight-medium mb-1">Prices</div>
          <div class="billing-plans-table-wrap mb-3">
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Provider price</th>
                  <th>Component</th>
                  <th>Usage</th>
                  <th>Interval</th>
                  <th>Amount</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!state.selectedPlanPrices.length">
                  <td colspan="6" class="text-center text-medium-emphasis py-6">No prices on this plan.</td>
                </tr>
                <tr v-for="price in state.selectedPlanPrices" :key="price.id">
                  <td>{{ meta.shortenProviderPriceId(price.providerPriceId) }}</td>
                  <td>{{ price.billingComponent }}</td>
                  <td>{{ price.usageType }}</td>
                  <td>{{ meta.formatInterval(price.interval, price.intervalCount) }}</td>
                  <td>{{ meta.formatMoneyMinor(price.unitAmountMinor, price.currency) }}</td>
                  <td class="text-right">
                    <v-btn size="small" variant="text" color="primary" @click="actions.openEditDialog(state.selectedPlan.id, price.id)">
                      Edit
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div class="text-body-2 font-weight-medium mb-1">Entitlements</div>
          <v-sheet color="surface-variant" rounded="md" class="pa-3 code-sheet">
            <pre>{{ JSON.stringify(state.selectedPlan.entitlements || [], null, 2) }}</pre>
          </v-sheet>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="actions.closeViewDialog">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="state.editDialogOpen" max-width="760">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">Edit plan price</v-card-title>
        <v-divider />
        <v-card-text>
          <v-alert v-if="state.editError" type="error" variant="tonal" class="mb-3">
            {{ state.editError }}
          </v-alert>

          <v-row dense>
            <v-col cols="12">
              <v-select
                v-model="state.editForm.providerPriceId"
                :items="state.providerPriceOptions"
                item-title="title"
                item-value="value"
                :label="state.ui.catalogPriceLabel"
                variant="outlined"
                density="compact"
                :loading="state.providerPricesLoading"
                :no-data-text="
                  state.providerPricesLoading ? state.ui.catalogPriceNoDataLoading : state.ui.catalogPriceNoDataEmpty
                "
                :error-messages="state.editFieldErrors.providerPriceId"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="state.editForm.providerProductId"
                :label="state.ui.productLabel"
                variant="outlined"
                density="compact"
                :readonly="state.isEditPriceAutofilled"
                :hint="state.ui.autoFillHint"
                persistent-hint
                :error-messages="state.editFieldErrors.providerProductId"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="actions.closeEditDialog">Cancel</v-btn>
          <v-btn color="primary" :loading="state.editSaving" @click="actions.saveEditedPrice">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { useConsoleBillingPlansView } from "./useConsoleBillingPlansView.js";

const { meta, state, actions } = useConsoleBillingPlansView();
</script>

<style scoped>
.billing-plans-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}

.code-sheet pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  overflow-x: auto;
}
</style>
