<template>
  <section class="projects-add-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Add project</span>
        <v-spacer />
        <v-btn variant="outlined" @click="actions.goBack">Cancel</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-form @submit.prevent="actions.save" novalidate>
          <v-row>
            <v-col cols="12" md="8">
              <v-text-field
                v-model="state.form.name"
                label="Name"
                variant="outlined"
                density="comfortable"
                maxlength="160"
                required
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="state.form.status"
                label="Status"
                :items="meta.projectStatusOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="state.form.owner"
                label="Owner"
                variant="outlined"
                density="comfortable"
                maxlength="120"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="state.form.notes"
                label="Notes"
                variant="outlined"
                density="comfortable"
                rows="5"
                auto-grow
                maxlength="5000"
              />
            </v-col>
            <v-col cols="12" class="d-flex flex-wrap justify-end ga-3">
              <v-btn variant="outlined" @click="actions.reset">Reset</v-btn>
              <v-btn color="primary" type="submit" :loading="state.saving">Create project</v-btn>
            </v-col>
          </v-row>
        </v-form>

        <v-alert v-if="state.error" type="error" variant="tonal" class="mt-4">
          {{ state.error }}
        </v-alert>
        <v-alert v-if="state.message" type="success" variant="tonal" class="mt-4">
          {{ state.message }}
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useProjectsAdd } from "./useProjectsAdd";

const { meta, state, actions } = useProjectsAdd();
</script>
