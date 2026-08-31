<script setup>
import CrudAddEditScreen from "@jskit-ai/http-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/http-web/client/composables/useCrudAddEditScreen";
import { bookResource } from "@local/books/shared";
import BookFormFields from "./BookFormFields.vue";
import { bookFormFields } from "./formFields.js";

const screen = useCrudAddEditScreen({
  mode: "new",
  saveLabel: "Save book",
  cancelTo: "/books",
  resource: bookResource,
  operationName: "create",
  formFields: bookFormFields,
  addEditOptions: {
    apiSuffix: "/books",
    placementSource: "crud.books.new",
    readEnabled: false,
    writeMethod: "POST",
    recordIdParam: "bookId",
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
