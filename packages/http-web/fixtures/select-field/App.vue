<script setup>
import { ref } from "vue";
import SelectField from "../../src/client/components/SelectField.vue";

const bath = { value: 7, label: "Bath" };
const daycare = { value: 53, label: "Daycare - One Day" };
const loading = ref(true);
const services = ref([]);
const extras = ref([bath]);
const service = ref(53);
const retired = ref(99);
const serviceIds = ref([7, 53]);

// The test releases the delayed options request deterministically.
window.releaseOptions = () => {
  services.value = [bath, daycare];
  extras.value = [bath, daycare];
  loading.value = false;
};
</script>

<template>
  <v-app>
    <v-main class="pa-4">
      <SelectField
        v-model="service"
        label="Service"
        :items="services"
        item-title="label"
        item-value="value"
        :loading="loading"
      />
      <SelectField
        v-model="retired"
        searchable
        label="Retired service"
        :items="services"
        item-title="label"
        item-value="value"
        :loading="loading"
      />
      <SelectField
        v-model="serviceIds"
        label="Extras"
        multiple
        chips
        closable-chips
        :items="extras"
        item-title="label"
        item-value="value"
        :loading="loading"
      />
      <pre data-testid="select-field-models">{{ JSON.stringify({ service, retired, serviceIds }) }}</pre>
    </v-main>
  </v-app>
</template>
