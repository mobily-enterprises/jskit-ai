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
        <v-alert v-if="state.billingSettingsLoadError" type="warning" variant="tonal" class="mb-3">
          {{ state.billingSettingsLoadError }}
        </v-alert>
        <v-alert v-if="state.billingSettingsError" type="error" variant="tonal" class="mb-3">
          {{ state.billingSettingsError }}
        </v-alert>
        <v-alert v-if="state.billingSettingsSaveMessage" type="success" variant="tonal" class="mb-3">
          {{ state.billingSettingsSaveMessage }}
        </v-alert>

        <v-card rounded="lg" variant="tonal" class="mb-4">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Billing behavior</v-card-title>
            <v-card-subtitle>
              Controls paid-plan changes for workspaces without a default payment method.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div class="d-flex flex-wrap align-center ga-3">
              <v-select
                v-model="state.billingSettingsForm.paidPlanChangePaymentMethodPolicy"
                :items="meta.billingPolicyOptions"
                item-title="title"
                item-value="value"
                label="Paid plan change policy"
                variant="outlined"
                density="compact"
                hide-details
                :loading="state.billingSettingsLoading"
                class="billing-policy-field"
              />
              <v-btn
                color="primary"
                :loading="state.billingSettingsSaving"
                :disabled="state.billingSettingsLoading"
                @click="actions.saveBillingSettings"
              >
                Save setting
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <div class="billing-plans-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Description</th>
                <th>Core price</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.tableRows.length">
                <td colspan="5" class="text-center text-medium-emphasis py-6">No billing plans yet.</td>
              </tr>
              <tr v-for="row in state.tableRows" :key="row.id">
                <td>
                  <div class="d-flex align-center ga-2">
                    <code>{{ row.code }}</code>
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
                <td class="description-cell">{{ row.description || "-" }}</td>
                <td>{{ meta.formatPriceSummary(row.corePrice) }}</td>
                <td class="text-right">
                  <div class="d-inline-flex ga-2">
                    <v-btn size="small" variant="text" @click="actions.openViewDialog(row.id)">View</v-btn>
                    <v-btn size="small" variant="text" color="primary" @click="actions.openEditDialog(row.id)">
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
            <v-col cols="12" md="5">
              <v-text-field
                v-model="state.createForm.name"
                label="Plan name"
                variant="outlined"
                density="compact"
                :error-messages="state.createFieldErrors.name"
              />
            </v-col>
            <v-col cols="12" md="3" class="d-flex align-center">
              <v-switch
                v-model="state.createForm.isActive"
                color="primary"
                label="Plan active"
                hide-details
                density="compact"
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
                :error-messages="state.createFieldErrors.description"
              />
            </v-col>
          </v-row>

          <v-divider class="my-2" />
          <div class="text-body-2 font-weight-medium mb-1">Core price</div>
          <div class="text-caption text-medium-emphasis mb-2">{{ state.ui.corePriceDescription }}</div>

          <v-row dense>
            <v-col cols="12">
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
                :error-messages="state.createFieldErrors['corePrice.providerPriceId']"
              />
            </v-col>
          </v-row>

          <v-sheet v-if="state.createSelectedProviderPriceInfo" color="surface-variant" rounded="md" class="pa-3 mb-3">
            <div class="text-caption text-medium-emphasis mb-2">Selected price details</div>
            <div class="price-grid text-body-2">
              <div><strong>Price ID:</strong> {{ state.createSelectedProviderPriceInfo.providerPriceId }}</div>
              <div>
                <strong>Amount:</strong>
                {{
                  state.createSelectedProviderPriceInfo.hasAmount
                    ? meta.formatMoneyMinor(
                      state.createSelectedProviderPriceInfo.unitAmountMinor,
                      state.createSelectedProviderPriceInfo.currency
                    )
                    : "-"
                }}
              </div>
              <div>
                <strong>Interval:</strong>
                {{
                  state.createSelectedProviderPriceInfo.hasInterval
                    ? meta.formatInterval(
                      state.createSelectedProviderPriceInfo.interval,
                      state.createSelectedProviderPriceInfo.intervalCount
                    )
                    : "-"
                }}
              </div>
              <div><strong>Product:</strong> {{ state.createSelectedProviderPriceInfo.productName || '-' }}</div>
              <div><strong>Product ID:</strong> {{ state.createSelectedProviderPriceInfo.productId || '-' }}</div>
              <div><strong>Usage type:</strong> {{ state.createSelectedProviderPriceInfo.usageType || '-' }}</div>
            </div>
          </v-sheet>

          <v-row dense>
            <v-col cols="12">
              <v-textarea
                v-model="state.createForm.entitlementsJson"
                label="Entitlements JSON array"
                variant="outlined"
                density="compact"
                rows="5"
                auto-grow
                :error-messages="state.createFieldErrors['entitlements[0].valueJson']"
              />
              <v-alert
                v-if="state.createEntitlementErrors.length"
                type="error"
                variant="tonal"
                density="compact"
                class="mt-2"
              >
                <div v-for="(message, index) in state.createEntitlementErrors" :key="`entitlement-error-${index}`">
                  {{ message }}
                </div>
              </v-alert>
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

    <v-dialog v-model="state.viewDialogOpen" max-width="960">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">Plan details</v-card-title>
        <v-divider />
        <v-card-text v-if="state.selectedPlan">
          <div class="plan-details-header mb-4">
            <div>
              <div class="text-subtitle-1 font-weight-bold">
                {{ state.selectedPlan.name || state.selectedPlan.code || "Plan" }}
              </div>
              <div class="text-caption text-medium-emphasis mt-1">
                Code: <code>{{ state.selectedPlan.code }}</code>
              </div>
            </div>
            <v-chip
              size="small"
              label
              :color="state.selectedPlan.isActive ? 'primary' : 'default'"
              :variant="state.selectedPlan.isActive ? 'tonal' : 'outlined'"
            >
              {{ state.selectedPlan.isActive ? "Active" : "Inactive" }}
            </v-chip>
          </div>

          <v-row dense>
            <v-col cols="12" md="7">
              <v-card rounded="lg" variant="tonal" class="h-100">
                <v-card-item>
                  <v-card-title class="plan-section-title">Plan identity</v-card-title>
                </v-card-item>
                <v-card-text>
                  <dl class="kv-grid">
                    <div class="kv-item">
                      <dt>Name</dt>
                      <dd>{{ state.selectedPlan.name || "-" }}</dd>
                    </div>
                    <div class="kv-item">
                      <dt>Code</dt>
                      <dd><code>{{ state.selectedPlan.code }}</code></dd>
                    </div>
                    <div class="kv-item">
                      <dt>Status</dt>
                      <dd>{{ state.selectedPlan.isActive ? "Active" : "Inactive" }}</dd>
                    </div>
                  </dl>

                  <div class="mt-3">
                    <div class="text-caption text-medium-emphasis mb-1">Description</div>
                    <div class="description-block">{{ state.selectedPlan.description || "-" }}</div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="5">
              <v-card rounded="lg" variant="tonal" class="h-100">
                <v-card-item>
                  <v-card-title class="plan-section-title">Core price</v-card-title>
                </v-card-item>
                <v-card-text>
                  <dl v-if="state.selectedPlanCorePriceInfo" class="kv-grid">
                    <div class="kv-item">
                      <dt>Price ID</dt>
                      <dd><code>{{ state.selectedPlanCorePriceInfo.providerPriceId }}</code></dd>
                    </div>
                    <div class="kv-item">
                      <dt>Amount</dt>
                      <dd>
                        {{
                          state.selectedPlanCorePriceInfo.hasAmount
                            ? meta.formatMoneyMinor(
                              state.selectedPlanCorePriceInfo.unitAmountMinor,
                              state.selectedPlanCorePriceInfo.currency
                            )
                            : "-"
                        }}
                      </dd>
                    </div>
                    <div class="kv-item">
                      <dt>Interval</dt>
                      <dd>
                        {{
                          state.selectedPlanCorePriceInfo.hasInterval
                            ? meta.formatInterval(
                              state.selectedPlanCorePriceInfo.interval,
                              state.selectedPlanCorePriceInfo.intervalCount
                            )
                            : "-"
                        }}
                      </dd>
                    </div>
                    <div class="kv-item">
                      <dt>Product</dt>
                      <dd>{{ state.selectedPlanCorePriceInfo.productName || "-" }}</dd>
                    </div>
                    <div class="kv-item">
                      <dt>Product ID</dt>
                      <dd><code>{{ state.selectedPlanCorePriceInfo.productId || "-" }}</code></dd>
                    </div>
                  </dl>
                  <div v-else class="text-body-2 text-medium-emphasis">No core price mapping.</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12">
              <div class="d-flex align-center ga-2 mb-1">
                <div class="text-body-2 font-weight-medium">Entitlements JSON</div>
                <v-chip size="x-small" label>{{ (state.selectedPlan.entitlements || []).length }} entries</v-chip>
              </div>
              <v-sheet color="surface-variant" rounded="md" class="pa-3 code-sheet">
                <pre>{{ JSON.stringify(state.selectedPlan.entitlements || [], null, 2) }}</pre>
              </v-sheet>
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="actions.closeViewDialog">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="state.editDialogOpen" max-width="900">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">Edit billing plan</v-card-title>
        <v-divider />
        <v-card-text>
          <v-alert v-if="state.editError" type="error" variant="tonal" class="mb-3">
            {{ state.editError }}
          </v-alert>

          <v-row dense>
            <v-col cols="12" md="4">
              <v-text-field v-model="state.editForm.code" label="Plan code" variant="outlined" density="compact" readonly />
            </v-col>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="state.editForm.name"
                label="Plan name"
                variant="outlined"
                density="compact"
                :error-messages="state.editFieldErrors.name"
              />
            </v-col>
            <v-col cols="12" md="3" class="d-flex align-center">
              <v-switch
                v-model="state.editForm.isActive"
                color="primary"
                label="Plan active"
                hide-details
                density="compact"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="state.editForm.description"
                label="Description"
                variant="outlined"
                density="compact"
                rows="2"
                auto-grow
                :error-messages="state.editFieldErrors.description"
              />
            </v-col>
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
                :hint="state.ui.catalogPriceHint"
                persistent-hint
                :error-messages="state.editFieldErrors['corePrice.providerPriceId']"
              />
            </v-col>
          </v-row>

          <v-sheet v-if="state.editSelectedProviderPriceInfo" color="surface-variant" rounded="md" class="pa-3 mt-2">
            <div class="text-caption text-medium-emphasis mb-2">Selected price details</div>
            <div class="price-grid text-body-2">
              <div><strong>Price ID:</strong> {{ state.editSelectedProviderPriceInfo.providerPriceId }}</div>
              <div>
                <strong>Amount:</strong>
                {{
                  state.editSelectedProviderPriceInfo.hasAmount
                    ? meta.formatMoneyMinor(
                      state.editSelectedProviderPriceInfo.unitAmountMinor,
                      state.editSelectedProviderPriceInfo.currency
                    )
                    : "-"
                }}
              </div>
              <div>
                <strong>Interval:</strong>
                {{
                  state.editSelectedProviderPriceInfo.hasInterval
                    ? meta.formatInterval(
                      state.editSelectedProviderPriceInfo.interval,
                      state.editSelectedProviderPriceInfo.intervalCount
                    )
                    : "-"
                }}
              </div>
              <div><strong>Product:</strong> {{ state.editSelectedProviderPriceInfo.productName || '-' }}</div>
              <div><strong>Product ID:</strong> {{ state.editSelectedProviderPriceInfo.productId || '-' }}</div>
              <div><strong>Usage type:</strong> {{ state.editSelectedProviderPriceInfo.usageType || '-' }}</div>
            </div>
          </v-sheet>
          <v-alert v-else type="warning" variant="tonal" class="mt-2">
            Price details are unavailable for the current mapping
            <code v-if="state.editInitialProviderPriceId">{{ state.editInitialProviderPriceId }}</code>.
            You can still update name/description/status, or choose a new active price.
          </v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="actions.closeEditDialog">Cancel</v-btn>
          <v-btn color="primary" :loading="state.editSaving" @click="actions.saveEditedPlan">Save</v-btn>
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

.description-cell {
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.billing-policy-field {
  min-width: 260px;
  max-width: 420px;
}

.plan-details-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.kv-grid {
  margin: 0;
  display: grid;
  gap: 10px;
}

.kv-item dt {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}

.kv-item dd {
  margin: 2px 0 0;
  font-size: 15px;
}

.description-block {
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.plan-section-title {
  font-size: 17px;
  font-weight: 700;
}

.price-grid {
  display: grid;
  gap: 6px;
}

.code-sheet pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  overflow-x: auto;
}
</style>
