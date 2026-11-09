import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { searchOnServer } from "../plugin/rules/searchOnServer.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const CLIENT = Object.freeze({ settings: { jskit: { client: true } } });
const modules = new RuleTester({ ...CLIENT, languageOptions: { ecmaVersion: "latest", sourceType: "module" } });
const components = new RuleTester({ ...CLIENT, languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" } });

const IMPORTS = "import { computed, ref } from \"vue\";\nimport { useList } from \"@jskit-ai/http-web/client\";\n";

modules.run("jskit/search-on-server (computed)", searchOnServer, {
  valid: [
    // The list's own search sends q to the server.
    `${IMPORTS}export function useServices() {\n  const list = useList({ apiSuffix: "/services", search: { enabled: true } });\n  return { list };\n}`,
    // Filtering a list's items by something other than a search ref, or a search over items no list holds.
    `${IMPORTS}export function useServices() {\n  const list = useList({ apiSuffix: "/services" });\n  const visible = computed(() => list.items.filter((service) => service.active));\n  return { visible };\n}`,
    `${IMPORTS}export function useColours() {\n  const search = ref("");\n  const colours = ["red", "green"];\n  return computed(() => colours.filter((colour) => colour.includes(search.value)));\n}`,
    // The exception.
    `${IMPORTS}export function useServices() {\n  const search = ref("");\n  const list = useList({ apiSuffix: "/services" });\n  // readable-check: allow search-on-server - every row: the endpoint answers the five fixed service kinds in one page\n  return computed(() => list.items.filter((service) => service.name.includes(search.value)));\n}`
  ],
  invalid: [
    {
      code: `${IMPORTS}export function useServices() {\n  const search = ref("");\n  const list = useList({ apiSuffix: "/services" });\n  return computed(() => list.items.filter((service) => service.name.includes(search.value)));\n}`,
      errors: [{ messageId: "computedFilter", data: { items: "list.items", search: "search.value" } }]
    },
    {
      // Through a const the getter holds the items in, and items destructured from the composable.
      code: `${IMPORTS}export function useServices() {\n  const searchText = ref("");\n  const { items } = useList({ apiSuffix: "/services" });\n  return computed(() => {\n    const source = Array.isArray(items.value) ? items.value : [];\n    const term = searchText.value.toLowerCase();\n    return source.filter((service) => service.name.toLowerCase().includes(term));\n  });\n}`,
      errors: [{ messageId: "computedFilter", data: { items: "source", search: "searchText.value" } }]
    },
    {
      code: `${IMPORTS}export function useServices() {\n  const list = useList({ apiSuffix: "/services", search: { enabled: true } });\n  return computed(() => list.items.filter((service) => service.name.includes(list.searchQuery)));\n}`,
      errors: [{ messageId: "computedFilter", data: { items: "list.items", search: "list.searchQuery" } }]
    }
  ]
});

const SCRIPT = "<script setup>\nimport { useList } from \"@jskit-ai/http-web/client\";\nconst services = useList({ apiSuffix: \"/services\", search: { enabled: true } });\n</script>\n";
const lookupField = (attributes) => `<template>\n  <CrudAddEditScreen :screen="screen">\n    <template #fields="{ formState, resolveLookupItems, resolveLookupSearch, setLookupSearch }">\n      <SelectField\n        v-model="formState.serviceId"\n        searchable\n${attributes}\n        :items="resolveLookupItems('serviceId', { selectedValue: formState.serviceId })"\n      />\n    </template>\n  </CrudAddEditScreen>\n</template>`;

components.run("jskit/search-on-server (autocomplete)", searchOnServer, {
  valid: [
    lookupField("        no-filter\n        :search=\"resolveLookupSearch('serviceId')\"\n        @update:search=\"setLookupSearch('serviceId', $event)\""),
    `${SCRIPT}<template>\n  <v-autocomplete v-model="serviceId" :items="services.items" no-filter v-model:search="services.searchQuery" />\n</template>`,
    // A select lists the options; only a search filters them. Fixed options are no resource's records.
    `${SCRIPT}<template>\n  <v-select v-model="serviceId" :items="services.items" />\n  <SelectField v-model="serviceId" :items="services.items" />\n  <v-autocomplete v-model="colour" :items="['red', 'green']" />\n</template>`,
    `${SCRIPT}<template>\n  <!-- readable-check: allow search-on-server - every row: the endpoint answers the five fixed service kinds in one page -->\n  <v-autocomplete v-model="serviceId" :items="services.items" />\n</template>`
  ],
  invalid: [
    {
      code: lookupField("        :search=\"resolveLookupSearch('serviceId')\"\n        @update:search=\"setLookupSearch('serviceId', $event)\""),
      errors: [{ messageId: "localAutocomplete", data: { items: "resolveLookupItems", missing: "has no no-filter" } }]
    },
    {
      code: `${SCRIPT}<template>\n  <v-autocomplete v-model="serviceId" :items="services.items" />\n</template>`,
      errors: [{ messageId: "localAutocomplete", data: { items: "services.items", missing: "has no no-filter and sends no typed text (@update:search)" } }]
    },
    {
      code: `${SCRIPT}<template>\n  <VAutocomplete v-model="serviceId" :items="services.items" no-filter />\n</template>`,
      errors: [{ messageId: "localAutocomplete", data: { items: "services.items", missing: "sends no typed text (@update:search)" } }]
    }
  ]
});
