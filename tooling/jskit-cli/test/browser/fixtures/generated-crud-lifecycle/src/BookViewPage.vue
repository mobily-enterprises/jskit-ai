<script setup>
import CrudDeleteAction from "@jskit-ai/users-web/client/components/CrudDeleteAction";
import CrudViewScreen from "@jskit-ai/users-web/client/components/CrudViewScreen";
import { useCrudDeleteAction } from "@jskit-ai/users-web/client/composables/useCrudDeleteAction";
import { useCrudViewScreen } from "@jskit-ai/users-web/client/composables/useCrudViewScreen";
import { bookResource } from "./bookFixture.js";

const screen = useCrudViewScreen({
  resource: bookResource,
  resourceNamespace: "books",
  apiUrlTemplate: "/books/:bookId",
  recordIdParam: "bookId",
  titleFallbackFieldKey: "title",
  listUrlTemplate: "/books",
  editUrlTemplate: "/books/:bookId/edit",
  requestRecoveryLabel: "Book",
  fallbackLoadError: "Unable to load book."
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
    description="Review this Book record."
  >
    <template #actions>
      <CrudDeleteAction
        :action="deleteAction"
        resource-singular-title="Book"
      />
    </template>

    <template #fields="{ view }">
      <v-col cols="12" md="6">
        <div class="text-caption text-medium-emphasis">Title</div>
        <div class="text-body-1">{{ view.record?.title }}</div>
      </v-col>
    </template>
  </CrudViewScreen>
</template>
