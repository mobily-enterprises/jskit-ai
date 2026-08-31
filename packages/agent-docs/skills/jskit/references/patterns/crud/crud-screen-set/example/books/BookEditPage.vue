<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import CrudAddEditScreen from "@jskit-ai/http-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/http-web/client/composables/useCrudAddEditScreen";
import { bookResource } from "@local/books/shared";
import BookFormFields from "./BookFormFields.vue";
import { bookFormFields } from "./formFields.js";

const route = useRoute();
const routeRecordId = computed(() => String(route.params.bookId || "").trim());

const screen = useCrudAddEditScreen({
  mode: "edit",
  saveLabel: "Save changes",
  cancelTo: "/books/:bookId",
  preserveCancelQuery: true,
  resource: bookResource,
  operationName: "patch",
  formFields: bookFormFields,
  addEditOptions: {
    apiUrlTemplate: "/books/:bookId",
    placementSource: "crud.books.edit",
    writeMethod: "PATCH",
    requestRecoveryLabel: "Book",
    fallbackLoadError: "Unable to load this book.",
    fallbackSaveError: "Unable to save this book.",
    recordIdParam: "bookId",
    routeRecordId,
    viewUrlTemplate: "/books/:bookId",
    listUrlTemplate: "/books"
  },
  saveSuccess: {
    invalidateQueryKey: ["crud", "books"],
    listUrlTemplate: "/books"
  }
});
</script>

<template>
  <CrudAddEditScreen :screen="screen">
    <template #fields="fieldRuntime">
      <BookFormFields
        v-model:title="fieldRuntime.formState.title"
        v-model:author="fieldRuntime.formState.author"
        v-model:notes="fieldRuntime.formState.notes"
        :readonly="fieldRuntime.addEdit.isFieldLocked"
        :resolve-field-errors="fieldRuntime.resolveFieldErrors"
      />
    </template>
  </CrudAddEditScreen>
</template>
