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
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Current plan</v-card-title>
                <v-card-subtitle v-if="state.currentPlan">
                  <template v-if="state.currentPlanHasNoExpiry">This plan does not expire.</template>
                  <template v-else>
                    Current plan remains active until {{ meta.formatDateOnly(state.currentPeriodEndAt) }}.
                  </template>
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
                  Current period ends:
                  <strong>{{
                    state.currentPlanHasNoExpiry ? "No expiry" : meta.formatDateOnly(state.currentPeriodEndAt)
                  }}</strong>
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
                <div v-else class="text-body-2 text-medium-emphasis">
                  Core price: <strong>Free</strong>
                </div>
                <div v-if="state.canCancelCurrentPlan" class="mt-3">
                  <v-btn
                    variant="outlined"
                    color="error"
                    :loading="state.cancelCurrentPlanLoading"
                    @click="actions.cancelCurrentPlan"
                  >
                    Cancel plan
                  </v-btn>
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
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Scheduled change</v-card-title>
                <v-card-subtitle v-if="state.pendingChange && state.nextPlan">
                  The downgrade will take effect on {{ meta.formatDateOnly(state.nextEffectiveAt) }}.
                </v-card-subtitle>
                <v-card-subtitle v-else>No scheduled plan change.</v-card-subtitle>
              </v-card-item>

              <v-card-text v-if="state.pendingChange && state.nextPlan">
                <div class="text-body-1 font-weight-medium mb-1">
                  {{ state.nextPlan.name || state.nextPlan.code }}
                </div>
                <div class="text-body-2 text-medium-emphasis mb-3">
                  Effective {{ meta.formatDateOnly(state.nextEffectiveAt) }}
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

        <v-card rounded="lg" border class="mt-4">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Usage limits</v-card-title>
            <v-card-subtitle>
              Effective entitlement balances for this workspace.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div v-if="state.limitationsError" class="text-body-2 text-error mb-2">
              {{ state.limitationsError }}
            </div>
            <div v-if="state.limitationsLoading" class="text-body-2 text-medium-emphasis">
              Loading limits...
            </div>
            <div v-else-if="state.limitationItems.length > 0" class="limit-grid">
              <v-card
                v-for="limit in state.limitationItems"
                :key="limit.code"
                rounded="lg"
                variant="tonal"
                class="limit-card"
              >
                <v-card-item class="pb-1">
                  <div class="d-flex align-center ga-2">
                    <code>{{ limit.code }}</code>
                    <v-chip
                      size="x-small"
                      label
                      :color="limit.overLimit ? 'error' : 'primary'"
                      :variant="limit.overLimit ? 'tonal' : 'outlined'"
                    >
                      {{ limit.overLimit ? "Over limit" : "Within limit" }}
                    </v-chip>
                  </div>
                </v-card-item>
                <v-card-text class="pt-1">
                  <div class="text-body-2">
                    <strong>{{ limit.consumedAmount }}</strong>
                    <span class="text-medium-emphasis"> used</span>
                    <span class="text-medium-emphasis">
                      /
                      <strong>{{ limit.hardLimitAmount ?? limit.grantedAmount }}</strong>
                    </span>
                    <span v-if="limit.unit" class="text-medium-emphasis"> {{ limit.unit }}</span>
                  </div>
                  <v-progress-linear
                    v-if="limit.usagePercent != null"
                    :model-value="limit.usagePercent"
                    :color="limit.overLimit ? 'error' : 'primary'"
                    height="8"
                    rounded
                    class="mt-2"
                  />
                  <div class="text-caption text-medium-emphasis mt-2">
                    Remaining: {{ limit.effectiveAmount }} · Lock: {{ limit.lockState || "none" }}
                  </div>
                  <div v-if="limit.nextChangeAt" class="text-caption text-medium-emphasis">
                    Next change: {{ meta.formatDateOnly(limit.nextChangeAt) }}
                  </div>
                </v-card-text>
              </v-card>
            </div>
            <div v-else class="text-body-2 text-medium-emphasis">No limitations are configured.</div>
            <div v-if="state.limitationsGeneratedAt" class="text-caption text-medium-emphasis mt-3">
              Generated {{ meta.formatDateOnly(state.limitationsGeneratedAt) }}
              <span v-if="state.limitationsStale"> (stale)</span>
            </div>
          </v-card-text>
        </v-card>

        <v-card rounded="lg" border class="mt-4">
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

        <v-row dense class="mt-4">
          <v-col cols="12" lg="7">
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">One-off purchases</v-card-title>
                <v-card-subtitle>Click a product to open checkout.</v-card-subtitle>
              </v-card-item>
              <v-card-text>
                <div v-if="state.catalogItems.length > 0" class="one-off-grid mb-3">
                  <button
                    v-for="item in state.catalogItems"
                    :key="item.value"
                    type="button"
                    class="one-off-tile"
                    :disabled="state.paymentLinkLoading"
                    @click="actions.buyCatalogItem(item)"
                  >
                    <span class="one-off-tile__name">{{ item.title }}</span>
                    <span class="one-off-tile__price">{{ item.subtitle }}</span>
                    <span class="one-off-tile__meta">
                      <template v-if="state.buyingCatalogPriceId === item.value && state.paymentLinkLoading">
                        Opening checkout...
                      </template>
                      <template v-else>
                        Buy now
                      </template>
                    </span>
                  </button>
                </div>
                <div v-else class="text-body-2 text-medium-emphasis mb-3">
                  No one-off products are available yet.
                </div>

                <a v-if="state.lastPaymentLinkUrl" :href="state.lastPaymentLinkUrl" target="_blank" rel="noopener noreferrer">
                  Open payment link
                </a>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" lg="5">
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Purchase history</v-card-title>
                <v-card-subtitle>Confirmed charges, including plan invoices and one-off purchases.</v-card-subtitle>
              </v-card-item>
              <v-card-text>
                <div v-if="state.purchasesError" class="text-body-2 text-error mb-2">
                  {{ state.purchasesError }}
                </div>
                <div v-if="state.purchasesLoading" class="text-body-2 text-medium-emphasis">
                  Loading purchases...
                </div>
                <v-list v-else-if="state.purchaseItems.length > 0" density="compact" lines="two" class="pa-0">
                  <v-list-item v-for="purchase in state.purchaseItems" :key="purchase.id">
                    <template #title>{{ purchase.title }}</template>
                    <template #subtitle>
                      {{ meta.formatDateOnly(purchase.purchasedAt) }} · {{ purchase.kindLabel }}
                    </template>
                    <template #append>
                      <div class="purchase-amount">
                        {{
                          meta.formatMoneyMinor(
                            Number(purchase.amountMinor || 0) * Number(purchase.quantity || 1),
                            purchase.currency
                          )
                        }}
                      </div>
                    </template>
                  </v-list-item>
                </v-list>
                <div v-else class="text-body-2 text-medium-emphasis">
                  No confirmed purchases yet.
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
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

.one-off-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 0.9rem;
}

.one-off-tile {
  aspect-ratio: 1 / 1;
  width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 14px;
  background: transparent;
  color: inherit;
  padding: 0.9rem;
  display: grid;
  grid-template-rows: 1fr auto auto;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    transform 140ms ease;
}

.one-off-tile:hover:not(:disabled),
.one-off-tile:focus-visible:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.05);
  transform: translateY(-1px);
  outline: none;
}

.one-off-tile:disabled {
  cursor: wait;
  opacity: 0.7;
}

.one-off-tile__name {
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.2;
  align-self: start;
}

.one-off-tile__price {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.1;
}

.one-off-tile__meta {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.purchase-amount {
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
}

.limit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.9rem;
}

.limit-card {
  min-height: 168px;
}
</style>
