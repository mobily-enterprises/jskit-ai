<script setup>
import CrudDeleteAction from "@jskit-ai/http-web/client/components/CrudDeleteAction";
import CrudViewScreen from "@jskit-ai/http-web/client/components/CrudViewScreen";
import { useCrudDeleteAction } from "@jskit-ai/http-web/client/composables/useCrudDeleteAction";
import { useCrudViewScreen } from "@jskit-ai/http-web/client/composables/useCrudViewScreen";
import { bookResource } from "@local/books/shared";

const screen = useCrudViewScreen({
  resource: bookResource,
  resourceNamespace: "books",
  apiUrlTemplate: "/books/:bookId",
  recordIdParam: "bookId",
  titleFallbackFieldKey: "title",
  listUrlTemplate: "/books",
  editUrlTemplate: "/books/:bookId/edit",
  requestRecoveryLabel: "Book",
  fallbackLoadError: "Unable to load this book."
});

const deleteAction = useCrudDeleteAction({
  screen,
  resource: bookResource,
  resourceNamespace: "books",
  apiUrlTemplate: "/books/:bookId"
});
</script>

<template>
  <CrudViewScreen
    :screen="screen"
    resource-singular-title="Book"
    resource-plural-title="Books"
  >
    <template #actions>
      <CrudDeleteAction :action="deleteAction" resource-singular-title="Book" />
    </template>

    <template #fields="{ view }">
      <v-col cols="12" md="6">
        <div class="text-caption text-medium-emphasis">Author</div>
        <div class="text-body-1">{{ view.record?.author }}</div>
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-medium-emphasis">Notes</div>
        <div class="text-body-1 text-pre-wrap">{{ view.record?.notes || "No notes" }}</div>
      </v-col>
    </template>
  </CrudViewScreen>
</template>
