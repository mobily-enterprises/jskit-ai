<script setup>
import CrudDeleteAction from "@jskit-ai/http-web/client/components/CrudDeleteAction";
import CrudViewScreen from "@jskit-ai/http-web/client/components/CrudViewScreen";
import { useCrudDeleteAction } from "@jskit-ai/http-web/client/composables/useCrudDeleteAction";
import { useCrudViewScreen } from "@jskit-ai/http-web/client/composables/useCrudViewScreen";
import { bookResource } from "@local/books/shared";

// Up returns to the page the book was opened from, or else to the list.
definePage({ meta: { jskit: { title: "Book", parent: "/books" } } });

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
  >
    <template #actions>
      <CrudDeleteAction :action="deleteAction" resource-singular-title="Book" />
    </template>

    <template #fields="{ view }">
      <v-list-item :title="view.record?.author" subtitle="Author" />
      <v-list-item :title="view.record?.notes || 'No notes'" subtitle="Notes" />
    </template>
  </CrudViewScreen>
</template>
