<template>
  <section class="social-moderation-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex align-center flex-wrap ga-2">
        <span class="text-subtitle-1 font-weight-bold">Social moderation</span>
        <v-spacer />
        <v-btn size="small" variant="outlined" :loading="state.rulesQuery.isFetching" @click="actions.refresh">Refresh</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.formError" type="error" variant="tonal" class="mb-3">
          {{ state.formError }}
        </v-alert>
        <v-alert v-if="state.noticeMessage" type="info" variant="tonal" class="mb-3">
          {{ state.noticeMessage }}
        </v-alert>

        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <v-select
            v-model="state.ruleScopeFilter"
            :items="[{ title: 'All', value: '' }, ...meta.ruleScopeOptions]"
            hide-details
            density="comfortable"
            variant="outlined"
            label="Filter scope"
            class="social-moderation-filter"
            @update:model-value="actions.refresh"
          />
        </div>

        <v-card rounded="lg" border class="mb-4">
          <v-card-title class="text-subtitle-2 font-weight-bold">Create rule</v-card-title>
          <v-divider />
          <v-card-text>
            <v-row class="ga-0">
              <v-col cols="12" md="4" class="pe-md-2">
                <v-select
                  v-model="state.ruleScope"
                  :items="meta.ruleScopeOptions"
                  label="Scope"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col cols="12" md="4" class="pe-md-2">
                <v-select
                  v-model="state.decision"
                  :items="meta.decisionOptions"
                  label="Decision"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field
                  v-if="state.ruleScope === 'domain'"
                  v-model="state.domain"
                  label="Domain"
                  placeholder="bad.example"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
                <v-text-field
                  v-else
                  v-model="state.actorUri"
                  label="Actor URI"
                  placeholder="https://remote.example/users/alice"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
            </v-row>

            <v-text-field
              v-model="state.reason"
              label="Reason (optional)"
              class="mt-3"
              hide-details
              variant="outlined"
              density="comfortable"
            />

            <div class="mt-3 d-flex justify-end">
              <v-btn
                color="primary"
                :loading="state.createRuleMutation.isPending"
                :disabled="state.createRuleMutation.isPending"
                @click="actions.submitRule"
              >
                Save rule
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <div class="social-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Target</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>Created</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="state.rules.length < 1">
                <td colspan="6" class="text-medium-emphasis text-center py-4">No moderation rules configured.</td>
              </tr>
              <tr v-for="rule in state.rules" :key="rule.id">
                <td>{{ rule.ruleScope }}</td>
                <td>{{ rule.domain || rule.actorUri || "n/a" }}</td>
                <td>
                  <v-chip size="x-small" label>{{ rule.decision }}</v-chip>
                </td>
                <td>{{ rule.reason || "—" }}</td>
                <td>{{ new Date(rule.createdAt).toLocaleString() }}</td>
                <td class="text-right">
                  <v-btn
                    size="small"
                    color="error"
                    variant="text"
                    :loading="state.deleteRuleMutation.isPending"
                    @click="actions.deleteRule(rule.id)"
                  >
                    Delete
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useSocialModerationView } from "./useSocialModerationView.js";

const { meta, state, actions } = useSocialModerationView();
</script>

<style scoped>
.social-moderation-view {
  width: 100%;
}

.social-moderation-filter {
  width: 220px;
}

.social-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}
</style>
