<script setup>
import { ref } from "vue";
import { amazonRedshiftDefinition } from "../../../connectors-catalog/src/shared/amazon-redshift.js";
import { useJskitText } from "../../src/client/i18n.js";

// Vuetify's bug on its own (https://github.com/vuetifyjs/vuetify/issues/23366), for the upstream check in
// selectTypeahead.browser.test.js: the panel's attribute follows the select, so each letter typed re-renders the panel.
const { text } = useJskitText();
const regions = amazonRedshiftDefinition.settingsFields.find((field) => field.name === "region").items
  .map((item) => ({ value: item.value, title: text(item.title) }));
const region = ref("us-east-1");
</script>

<template>
  <v-app>
    <v-main>
      <v-container style="max-width: 900px">
        <v-expansion-panels :model-value="['region']">
          <v-expansion-panel value="region" title="Region" :data-region="region">
            <v-expansion-panel-text>
              <v-select v-model="region" label="AWS Region" :items="regions" />
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-container>
    </v-main>
  </v-app>
</template>
