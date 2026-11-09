import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { selectionField } from "../plugin/rules/selectionField.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const components = new RuleTester({
  settings: { jskit: { client: true } },
  languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" }
});

const component = (script, template) => ({ filename: "Page.vue", code: `<script setup>\n${script}\n</script>\n<template>\n${template}\n</template>\n` });
const raw = (tag, items) => ({ messageId: "rawSelection", data: { tag, items } });
const missingLoading = (items) => ({ messageId: "selectFieldLoading", data: { items } });

components.run("jskit/selection-field", selectionField, {
  valid: [
    // A list written out in the template, of literals or of objects; the model's name says nothing either way.
    component("", "<v-select v-model=\"serviceId\" :items=\"['Small', 'Medium', 'Large']\" />"),
    component("const { t } = useText();", "<v-select v-model=\"size\" :items=\"[{ title: t('size.small'), value: 'small' }]\" />"),
    // A top-level const holding a fixed list: written out, frozen, deep-frozen or Vue's computed() over one.
    component("const SIZES = [\"S\", \"M\"];", "<v-select v-model=\"size\" :items=\"SIZES\" />"),
    component("const SIZES = Object.freeze([{ title: \"Small\", value: \"s\" }]);", "<VSelect v-model=\"size\" :items=\"SIZES\" />"),
    component("import { deepFreeze } from \"@jskit-ai/kernel/shared/support/deepFreeze\";\nconst OPTIONS = deepFreeze({ size: [\"S\"] });", "<v-select :items=\"OPTIONS.size\" />"),
    component("import { computed } from \"vue\";\nconst sizes = computed(() => [{ title: t(\"size.small\"), value: \"s\" }]);", "<v-select v-model=\"size\" :items=\"sizes\" />"),
    // An import from a shared module, used whole or through a member.
    component("import { STATUS_OPTIONS } from \"../shared/statusOptions.js\";", "<VAutocomplete v-model=\"status\" :items=\"STATUS_OPTIONS\" />"),
    component("import { OPTIONS } from \"@local/books/shared\";", "<v-combobox v-model=\"genre\" :items=\"OPTIONS.genres\" />"),
    // A static items attribute names no loaded data; a combobox with no items takes typed entries and loads nothing.
    component("", "<v-select items=\"a\" />"),
    component("const ids = ref([]);", "<v-combobox v-model=\"ids\" multiple chips />"),
    // SelectField binds loading while its options load, or takes fixed options, or a v-bind object that may hold it.
    component("const lookups = useLookups();", "<SelectField v-model=\"serviceId\" :items=\"lookups.items\" :loading=\"lookups.loading\" />"),
    component("const lookups = useLookups();", "<select-field v-model=\"serviceId\" :items=\"lookups.items\" loading />"),
    component("const SIZES = [\"S\"];", "<SelectField v-model=\"size\" :items=\"SIZES\" />"),
    component("", "<SelectField v-model=\"serviceId\" v-bind=\"lookupProps('serviceId')\" />"),
    // A justified case says why above the element.
    component("const modes = useModes();", "<!-- readable-check: allow selection-field - data: the provider definition lists these modes -->\n<v-select :items=\"modes\" />"),
    // A module without a template has nothing to check.
    { filename: "useSizes.js", code: "export const sizes = [];\n" }
  ],
  invalid: [
    { ...component("const services = useServices();", "<v-select v-model=\"serviceId\" :items=\"services\" />"), errors: [{ ...raw("v-select", "services"), line: 5 }] },
    { ...component("const lookups = useLookups();", "<VAutocomplete :items=\"lookups.items\" />"), errors: [raw("VAutocomplete", "lookups.items")] },
    { ...component("const tags = ref([]);", "<v-combobox v-model=\"tag\" :items=\"tags\" />"), errors: [raw("v-combobox", "tags")] },
    // Not fixed: a list that spreads another in, computed() over loaded records, an import from a module that is not
    // shared, and a template variable that shadows a fixed const.
    { ...component("const OPTIONS = [...base, \"x\"];", "<v-select :items=\"OPTIONS\" />"), errors: [raw("v-select", "OPTIONS")] },
    { ...component("import { computed } from \"vue\";\nconst sizes = computed(() => records.value.map(toOption));", "<v-select :items=\"sizes\" />"), errors: [raw("v-select", "sizes")] },
    { ...component("import { STATUSES } from \"../lib/statuses.js\";", "<v-select :items=\"STATUSES\" />"), errors: [raw("v-select", "STATUSES")] },
    {
      ...component("const field = [\"a\"];", "<div v-for=\"field in fields\" :key=\"field.name\">\n  <v-select :items=\"field\" />\n</div>"),
      errors: [raw("v-select", "field")]
    },
    { ...component("", "<v-select v-model=\"x\" v-bind=\"fieldProps\" />"), errors: [raw("v-select", "a v-bind object")] },
    // SelectField over options that load, with no loading binding.
    { ...component("const lookups = useLookups();", "<SelectField v-model=\"serviceId\" :items=\"lookups.items\" />"), errors: [missingLoading("lookups.items")] },
    { ...component("", "<select-field :items=\"resolveLookupItems('serviceId')\" />"), errors: [missingLoading("resolveLookupItems('serviceId')")] },
    // Another rule's exception, or one above an enclosing element, excuses nothing here.
    {
      ...component("const modes = useModes();", "<!-- readable-check: allow optional-call - optional operation: modes may be missing -->\n<v-select :items=\"modes\" />"),
      errors: [raw("v-select", "modes")]
    },
    {
      ...component("const modes = useModes();", "<!-- readable-check: allow selection-field - data: the provider definition lists these modes -->\n<v-col>\n  <v-select :items=\"modes\" />\n</v-col>"),
      errors: [raw("v-select", "modes")]
    }
  ]
});
