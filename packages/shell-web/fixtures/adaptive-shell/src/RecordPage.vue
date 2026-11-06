<script setup>
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";
import { records } from "./records.js";

const route = useRoute();
const kind = computed(() => String(route.meta.kind));
const record = computed(() => (records[kind.value] || []).find((item) => item.id === route.params.id) || null);
const related = computed(() => {
  if (!record.value) {
    return null;
  }
  return kind.value === "contacts"
    ? { label: "Supplier", to: `/home/suppliers/${record.value.supplier}` }
    : { label: "Contact", to: `/home/contacts/${record.value.contact}` };
});

useShellPageTitle(() => record.value?.name || "Not found");
</script>

<template>
  <section>
    <p v-if="related">
      <RouterLink :to="related.to">{{ related.label }}</RouterLink>
    </p>
  </section>
</template>
