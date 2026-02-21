<template>
  <section class="workspace-billing-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Workspace billing</v-card-title>
        <v-card-subtitle>Purchase flows and lifecycle timeline for this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-tabs v-model="state.activeTab" density="comfortable" class="px-4 pt-2">
        <v-tab v-for="tab in meta.tabs" :key="tab.value" :value="tab.value">
          {{ tab.title }}
        </v-tab>
      </v-tabs>
      <v-divider />
      <v-window v-model="state.activeTab">
        <v-window-item value="purchase">
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

            <v-card variant="tonal" rounded="lg" class="mb-4">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Subscription checkout</v-card-title>
                <v-card-subtitle>Select plan and optional licensed components.</v-card-subtitle>
              </v-card-item>
              <v-card-text>
                <div class="d-flex flex-wrap ga-3 align-center mb-3">
                  <v-select
                    :model-value="state.selectedPlanCode"
                    :items="state.planOptions"
                    item-title="title"
                    item-value="value"
                    label="Plan"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="filters-field"
                    @update:model-value="(value) => (state.selectedPlanCode = String(value || ''))"
                  />
                  <v-chip v-if="state.selectedPlanBasePrice" size="small" label>
                    Base: {{ meta.formatMoneyMinor(state.selectedPlanBasePrice.unitAmountMinor, state.selectedPlanBasePrice.currency) }}
                  </v-chip>
                </div>

                <div v-if="state.selectedPlanOptionalComponents.length" class="mb-3">
                  <div class="text-body-2 font-weight-medium mb-2">Optional components</div>
                  <div
                    v-for="component in state.selectedPlanOptionalComponents"
                    :key="component.providerPriceId"
                    class="d-flex flex-wrap ga-3 align-center mb-2"
                  >
                    <span class="text-body-2 component-label">{{ component.label }}</span>
                    <v-chip size="x-small" label>
                      {{ meta.formatMoneyMinor(component.amountMinor, component.currency) }}
                    </v-chip>
                    <v-text-field
                      :model-value="state.selectedComponentQuantities[component.providerPriceId]"
                      type="number"
                      min="0"
                      label="Qty"
                      density="compact"
                      variant="outlined"
                      hide-details
                      class="qty-field"
                      @update:model-value="
                        (value) => (state.selectedComponentQuantities[component.providerPriceId] = Number(value || 0))
                      "
                    />
                  </div>
                </div>

                <div class="d-flex flex-wrap ga-3 align-center">
                  <v-btn color="primary" :loading="state.checkoutLoading" @click="actions.startSubscriptionCheckout">
                    Start subscription checkout
                  </v-btn>
                  <a v-if="state.lastCheckoutUrl" :href="state.lastCheckoutUrl" target="_blank" rel="noopener noreferrer">
                    Open checkout
                  </a>
                </div>
              </v-card-text>
            </v-card>

            <v-card variant="tonal" rounded="lg">
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
        </v-window-item>

        <v-window-item value="timeline">
          <v-card-text>
            <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
              {{ state.error }}
            </v-alert>

            <div class="d-flex flex-wrap ga-3 align-center mb-3">
              <v-select
                :model-value="state.sourceFilter"
                :items="meta.sourceOptions"
                item-title="title"
                item-value="value"
                label="Source"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="(value) => (state.sourceFilter = String(value || ''))"
              />
              <v-text-field
                v-model="state.operationKeyFilter"
                label="Operation key"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
              />
              <v-text-field
                v-model="state.providerEventIdFilter"
                label="Provider event id"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
              />
              <v-select
                :model-value="state.pageSize"
                :items="meta.pageSizeOptions"
                label="Rows"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="actions.setPageSize"
              />
              <v-btn color="primary" :loading="state.loading" @click="actions.applyFilters">Apply</v-btn>
              <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
            </div>

            <v-timeline v-if="state.entries.length" density="compact" side="end" class="billing-timeline">
              <v-timeline-item v-for="entry in state.entries" :key="entry.id" size="small" dot-color="primary" fill-dot>
                <template #opposite>
                  <span class="text-caption text-medium-emphasis">{{ meta.formatDateTime(entry.occurredAt) }}</span>
                </template>
                <div class="d-flex align-center ga-2 mb-1">
                  <strong class="text-body-2">{{ entry.title }}</strong>
                  <v-chip size="x-small" label>{{ meta.toTitleCase(entry.status) || entry.status }}</v-chip>
                </div>
                <div class="text-body-2">{{ entry.description }}</div>
                <div class="text-caption text-medium-emphasis mt-1">
                  <span v-if="entry.operationKey">operation_key: {{ entry.operationKey }}</span>
                  <span v-if="entry.operationKey && entry.providerEventId"> • </span>
                  <span v-if="entry.providerEventId">provider_event_id: {{ entry.providerEventId }}</span>
                </div>
              </v-timeline-item>
            </v-timeline>
            <div v-else class="text-body-2 text-medium-emphasis">No billing activity found for this workspace yet.</div>

            <div class="d-flex align-center justify-space-between mt-3">
              <span class="text-body-2 text-medium-emphasis">Page {{ state.page }}</span>
              <div class="d-flex ga-2">
                <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="actions.goPreviousPage">
                  Previous
                </v-btn>
                <v-btn variant="outlined" :disabled="!state.hasMore || state.loading" @click="actions.goNextPage">
                  Next
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-window-item>
      </v-window>
    </v-card>
  </section>
</template>

<script setup>
import { useWorkspaceBillingView } from "./useWorkspaceBillingView.js";

const { meta, state, actions } = useWorkspaceBillingView();
</script>

<style scoped>
.filters-field {
  min-width: 150px;
  max-width: 220px;
}

.catalog-field {
  min-width: 240px;
  max-width: 420px;
}

.qty-field {
  width: 120px;
}

.component-label {
  min-width: 220px;
}

.billing-timeline {
  max-height: 560px;
  overflow-y: auto;
}
</style>
