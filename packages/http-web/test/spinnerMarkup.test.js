import assert from "node:assert/strict";
import test from "node:test";
import { findSpinnerMarkup } from "./support/spinnerMarkup.js";

test("a control's own loading line is not a spinner", () => {
  const source = `
    <SelectField v-model="form.serviceId" :items="services.items" :loading="services.loading" />
    <v-autocomplete v-model="form.roomId" :items="rooms" :loading="roomsLoading" />
    <v-combobox v-model="form.tags" :items="tags" loading />
    <v-data-table :items="rows" :loading="isLoading" />
    <v-btn v-pending="saving">{{ saving ? "Saving…" : "Save" }}</v-btn>
    <BookSaveBar :loading="saving" />
  `;
  assert.deepEqual(findSpinnerMarkup(source), []);
});

test("a circular indicator and a button's loading are spinners", () => {
  const source = `
    <v-progress-circular indeterminate />
    <VProgressCircular />
    <v-btn color="primary" :loading="saving">Save</v-btn>
    <v-btn
      @click="() => save(count > 0)"
      loading
    >Save</v-btn>
    <ShellPageAction icon="$save" :loading="saving" />
  `;
  assert.deepEqual(findSpinnerMarkup(source), [
    "<v-progress-circular",
    "<VProgressCircular",
    "<v-btn loading>",
    "<v-btn loading>",
    "<ShellPageAction loading>"
  ]);
});
