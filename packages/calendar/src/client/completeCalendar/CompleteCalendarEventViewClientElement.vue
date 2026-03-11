<template>
  <section class="complete-calendar-event-view-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">View and edit this appointment.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath || undefined">Back to calendar</v-btn>
          <v-btn color="error" variant="tonal" :loading="deleteCommand.isRunning" @click="confirmDelete">Delete</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="addEdit.loadError" type="error" variant="tonal" class="mb-4">{{ addEdit.loadError }}</v-alert>

        <v-alert v-if="addEdit.message" :type="addEdit.messageType" variant="tonal" class="mb-4">
          {{ addEdit.message }}
        </v-alert>

        <v-alert v-if="deleteCommand.message" :type="deleteCommand.messageType" variant="tonal" class="mb-4">
          {{ deleteCommand.message }}
        </v-alert>

        <v-form @submit.prevent="submit">
          <v-select
            v-model="form.contactId"
            :items="contactOptions"
            item-title="label"
            item-value="id"
            label="Contact"
            variant="outlined"
            density="comfortable"
            :error-messages="addEdit.fieldErrors.contactId || ''"
          />

          <v-text-field
            v-model="form.title"
            label="Title"
            variant="outlined"
            density="comfortable"
            :error-messages="addEdit.fieldErrors.title || ''"
          />

          <v-textarea
            v-model="form.notes"
            label="Notes"
            variant="outlined"
            density="comfortable"
            rows="4"
            :error-messages="addEdit.fieldErrors.notes || ''"
          />

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.startsAt"
                type="datetime-local"
                label="Starts at"
                variant="outlined"
                density="comfortable"
                :error-messages="addEdit.fieldErrors.startsAt || ''"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.endsAt"
                type="datetime-local"
                label="Ends at"
                variant="outlined"
                density="comfortable"
                :error-messages="addEdit.fieldErrors.endsAt || ''"
              />
            </v-col>
          </v-row>

          <v-select
            v-model="form.status"
            :items="statusOptions"
            label="Status"
            variant="outlined"
            density="comfortable"
            :error-messages="addEdit.fieldErrors.status || ''"
          />

          <div class="d-flex justify-end">
            <v-btn color="primary" type="submit" :loading="addEdit.isSaving">Save</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspaceAddEdit } from "@jskit-ai/users-web/client/composables/useWorkspaceAddEdit.js";
import { useWorkspaceCommand } from "@jskit-ai/users-web/client/composables/useWorkspaceCommand.js";
import { useWorkspaceList } from "@jskit-ai/users-web/client/composables/useWorkspaceList.js";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext.js";
import {
  assignCalendarEventToForm,
  buildCalendarEventPayload,
  calendarEventQueryKey,
  completeCalendarResource,
  parsePatchCalendarEventInput,
  resolveAdminCalendarWeekPath,
  toContactOption,
  toRouteEventId
} from "./completeCalendarClientSupport.js";

const route = useRoute();
const router = useRouter();
const { placementContext, workspaceSlugFromRoute } = useUsersWebWorkspaceRouteContext();

const form = reactive({
  contactId: 0,
  title: "",
  notes: "",
  startsAt: "",
  endsAt: "",
  status: "scheduled"
});

const eventId = computed(() => toRouteEventId(route.params.eventId));
const listPath = computed(() => resolveAdminCalendarWeekPath(placementContext.value, workspaceSlugFromRoute.value));
const title = computed(() => String(form.title || "").trim() || "Calendar event");

const contactsList = useWorkspaceList({
  apiSuffix: "/contacts?limit=200",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "calendar",
    "completeCalendar",
    "contacts",
    surfaceId,
    workspaceSlug
  ],
  placementSource: "calendar.completeCalendar.event.contact-list",
  fallbackLoadError: "Unable to load contacts."
});

const addEdit = useWorkspaceAddEdit({
  resource: completeCalendarResource,
  apiSuffix: () => `/calendar/events/${eventId.value}`,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    calendarEventQueryKey(surfaceId, workspaceSlug, eventId.value),
  placementSource: "calendar.completeCalendar.event-view",
  fallbackLoadError: "Unable to load event.",
  fallbackSaveError: "Unable to save event.",
  fieldErrorKeys: ["contactId", "title", "notes", "startsAt", "endsAt", "status"],
  model: form,
  parseInput: parsePatchCalendarEventInput,
  mapLoadedToModel: (model, payload = {}) => assignCalendarEventToForm(model, payload),
  buildRawPayload: (model) => buildCalendarEventPayload(model),
  messages: {
    saveSuccess: "Event saved.",
    saveError: "Unable to save event."
  }
});

const deleteCommand = useWorkspaceCommand({
  apiSuffix: () => `/calendar/events/${eventId.value}`,
  writeMethod: "DELETE",
  placementSource: "calendar.completeCalendar.event-delete",
  fallbackRunError: "Unable to delete event.",
  messages: {
    success: "Event deleted.",
    error: "Unable to delete event."
  },
  onRunSuccess: async (_, { queryClient }) => {
    await queryClient.invalidateQueries({ queryKey: ["calendar", "completeCalendar"] });
    if (listPath.value) {
      await router.push(listPath.value);
    }
  }
});

const contactOptions = computed(() => {
  const options = [];

  for (const entry of contactsList.items.value) {
    const option = toContactOption(entry);
    if (option) {
      options.push(option);
    }
  }

  return options;
});

const statusOptions = Object.freeze([
  { title: "Scheduled", value: "scheduled" },
  { title: "Completed", value: "completed" },
  { title: "Cancelled", value: "cancelled" }
]);

async function submit() {
  await addEdit.submit();
}

async function confirmDelete() {
  if (!window.confirm("Delete this event?")) {
    return;
  }

  await deleteCommand.run();
}
</script>
