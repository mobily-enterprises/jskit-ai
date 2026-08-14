<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import CrudAddEditScreen from "@jskit-ai/users-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/users-web/client/composables/useCrudAddEditScreen";
import BookFormFields from "./BookFormFields.vue";
import { bookFormFields, bookResource } from "./bookFixture.js";

const route = useRoute();
const routeRecordId = computed(() => String(route.params.bookId || "").trim());

const screen = useCrudAddEditScreen({
  mode: "edit",
  title: "Edit Book",
  subtitle: "Update the selected Book.",
  saveLabel: "Save changes",
  cancelTo: "/books/:bookId",
  resource: bookResource,
  operationName: "patch",
  formFields: bookFormFields,
  addEditOptions: {
    apiUrlTemplate: "/books/:bookId",
    queryKeyFactory: () => ["ui-generator", "books", "edit", routeRecordId.value],
    placementSource: "ui-generator.books.edit",
    writeMethod: "PATCH",
    recordIdParam: "bookId",
    routeRecordId,
    viewUrlTemplate: "/books/:bookId",
    listUrlTemplate: "/books"
  },
  saveSuccess: {
    invalidateQueryKey: ["ui-generator", "books"],
    listUrlTemplate: "/books"
  }
});
</script>

<template>
  <CrudAddEditScreen :screen="screen">
    <template #fields="fieldRuntime">
      <BookFormFields
        v-model="fieldRuntime.formState.title"
        :readonly="fieldRuntime.addEdit.isFieldLocked"
        :error-messages="fieldRuntime.resolveFieldErrors('title')"
      />
    </template>
  </CrudAddEditScreen>
</template>
