<script setup>
import CrudAddEditScreen from "@jskit-ai/users-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/users-web/client/composables/useCrudAddEditScreen";
import BookFormFields from "./BookFormFields.vue";
import { bookFormFields, bookResource } from "./bookFixture.js";

const screen = useCrudAddEditScreen({
  mode: "new",
  title: "New Book",
  subtitle: "Create a Book record.",
  saveLabel: "Save Book",
  cancelTo: "/books",
  resource: bookResource,
  operationName: "create",
  formFields: bookFormFields,
  addEditOptions: {
    apiSuffix: "/books",
    queryKeyFactory: () => ["ui-generator", "books", "create"],
    placementSource: "ui-generator.books.new",
    readEnabled: false,
    writeMethod: "POST",
    recordIdParam: "bookId",
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
