<script setup>
import { computed } from "vue";
import CrudListFilterSurface from "../../src/client/components/CrudListFilterSurface.vue";
import { useCrudListFilters } from "../../src/client/composables/useCrudListFilters.js";

const filters = {
  status: {
    key: "status",
    queryKey: "status",
    type: "enum",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived" }
    ]
  },
  submittedOn: {
    key: "submittedOn",
    queryKey: "submittedOn",
    type: "date",
    label: "Submitted date"
  },
  arrivalDate: {
    key: "arrivalDate",
    queryKey: "arrivalDate",
    type: "dateRange",
    label: "Arrival"
  },
  assignment: {
    key: "assignment",
    queryKey: "assignment",
    type: "presence",
    label: "Assignment",
    options: [
      { value: "present", label: "Assigned" },
      { value: "missing", label: "Unassigned" }
    ]
  }
};
const runtime = useCrudListFilters(filters);
const query = new URLSearchParams(window.location.search);

for (const [key, param] of Object.entries(runtime.queryParams)) {
  if (query.has(key)) {
    param.value = query.get(key);
  }
}

const contractSnapshot = computed(() => JSON.stringify({
  values: {
    submittedOn: runtime.values.submittedOn,
    arrivalDate: {
      from: runtime.values.arrivalDate.from,
      to: runtime.values.arrivalDate.to
    }
  },
  query: {
    submittedOn: runtime.queryParams.submittedOn.value,
    arrivalDate: runtime.queryParams.arrivalDate.value
  }
}));
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="date-filter-fixture py-8">
        <div class="mb-6">
          <div class="text-overline text-primary">JSKIT users-web</div>
          <h1 class="text-h4 mb-2">Date filter controls</h1>
          <p class="text-body-1 text-medium-emphasis mb-0">
            Date and date-range filters beside ordinary Vuetify selects.
          </p>
        </div>

        <CrudListFilterSurface :filters="filters" :runtime="runtime" />

        <output data-testid="date-filter-contract" class="date-filter-fixture__contract">
          {{ contractSnapshot }}
        </output>
      </v-container>
    </v-main>
  </v-app>
</template>

<style>
html {
  overflow-x: hidden;
}

body {
  background: rgb(var(--v-theme-background));
}

.date-filter-fixture {
  max-width: 90rem;
}

.date-filter-fixture__contract {
  display: block;
  font-family: monospace;
  height: 1px;
  overflow: hidden;
  position: absolute;
  width: 1px;
}
</style>
