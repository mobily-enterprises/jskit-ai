<template>
  <section class="complete-calendar-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Calendar</v-card-title>
            <v-card-subtitle class="px-0">Weekly appointment calendar with drag and drop scheduling.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-select
            v-model="filterContactId"
            :items="contactOptions"
            item-title="label"
            item-value="id"
            density="comfortable"
            variant="outlined"
            label="Contact"
            class="calendar-contact-filter"
            hide-details
          />
          <v-btn variant="outlined" :loading="isRefreshing" @click="refreshWeek">Refresh</v-btn>
          <v-btn color="primary" @click="openCreateDialog">New appointment</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <FullCalendar ref="calendarRef" :options="calendarOptions" />
      </v-card-text>
    </v-card>

    <v-dialog v-model="createDialog" max-width="640">
      <v-card>
        <v-card-title>Create appointment</v-card-title>
        <v-card-text class="pt-3">
          <v-select
            v-model="createForm.contactId"
            :items="contactOptionsWithoutAll"
            item-title="label"
            item-value="id"
            label="Contact"
            variant="outlined"
            density="comfortable"
            :error-messages="createCommand.fieldErrors.contactId || ''"
          />
          <v-text-field
            v-model="createForm.title"
            label="Title"
            variant="outlined"
            density="comfortable"
            :error-messages="createCommand.fieldErrors.title || ''"
          />
          <v-textarea
            v-model="createForm.notes"
            label="Notes"
            variant="outlined"
            density="comfortable"
            rows="3"
            :error-messages="createCommand.fieldErrors.notes || ''"
          />
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="createForm.startsAt"
                type="datetime-local"
                label="Starts at"
                variant="outlined"
                density="comfortable"
                :error-messages="createCommand.fieldErrors.startsAt || ''"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="createForm.endsAt"
                type="datetime-local"
                label="Ends at"
                variant="outlined"
                density="comfortable"
                :error-messages="createCommand.fieldErrors.endsAt || ''"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="createCommand.isRunning" @click="submitCreate">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import FullCalendar from "@fullcalendar/vue3";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useRouter } from "vue-router";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import { useWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useWorkspaceRouteContext";
import {
  buildCalendarEventPayload,
  calendarWeekQueryKey,
  completeCalendarResource,
  createCalendarEventForm,
  parseCreateCalendarEventInput,
  parsePatchCalendarEventInput,
  resolveAdminCalendarEventViewPath,
  resolveCalendarContactsListApiSuffix,
  resolveWeekStartDateIso,
  toContactOption,
  toDateOnlyIso
} from "./completeCalendarClientSupport.js";

const router = useRouter();
const calendarRef = ref(null);
const createDialog = ref(false);
const filterContactId = ref(0);
const weekStart = ref(resolveWeekStartDateIso());
const { workspaceSlugFromRoute, placementContext } = useWorkspaceRouteContext();

const weekModel = reactive({
  weekStart: "",
  weekEnd: "",
  items: []
});

const createForm = reactive(createCalendarEventForm());
const moveState = reactive({
  eventId: 0,
  startsAt: "",
  endsAt: ""
});
const contactsListApiSuffix = resolveCalendarContactsListApiSuffix();

const weekView = useView({
  visibility: "workspace",
  apiSuffix: () => {
    const search = new URLSearchParams();
    search.set("weekStart", weekStart.value);
    if (Number(filterContactId.value) > 0) {
      search.set("contactId", String(filterContactId.value));
    }

    return `/calendar/events?${search.toString()}`;
  },
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    calendarWeekQueryKey(surfaceId, workspaceSlug, weekStart.value, filterContactId.value),
  placementSource: "calendar.completeCalendar.week-view",
  fallbackLoadError: "Unable to load calendar week.",
  model: weekModel,
  mapLoadedToModel: (model, payload = {}) => {
    model.weekStart = String(payload.weekStart || "");
    model.weekEnd = String(payload.weekEnd || "");
    model.items = Array.isArray(payload.items) ? payload.items : [];
  }
});

const contactsList = useList({
  visibility: "workspace",
  apiSuffix: contactsListApiSuffix,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "calendar",
    "completeCalendar",
    "contacts",
    surfaceId,
    workspaceSlug
  ],
  placementSource: "calendar.completeCalendar.contact-list",
  fallbackLoadError: "Unable to load contacts."
});

const createCommand = useCommand({
  visibility: "workspace",
  apiSuffix: "/calendar/events",
  writeMethod: "POST",
  placementSource: "calendar.completeCalendar.create",
  fallbackRunError: String(completeCalendarResource.messages?.saveError || "Unable to create appointment."),
  fieldErrorKeys: ["contactId", "title", "notes", "startsAt", "endsAt", "status"],
  model: createForm,
  parseInput: parseCreateCalendarEventInput,
  buildRawPayload: (model) => buildCalendarEventPayload(model),
  messages: {
    success: "Appointment created.",
    error: "Unable to create appointment."
  },
  onRunSuccess: async (_, { queryClient }) => {
    createDialog.value = false;
    resetCreateForm();
    await queryClient.invalidateQueries({
      queryKey: ["calendar", "completeCalendar", "week"]
    });
    await weekView.refresh();
  }
});

const moveCommand = useCommand({
  visibility: "workspace",
  apiSuffix: () => `/calendar/events/${moveState.eventId}`,
  writeMethod: "PATCH",
  placementSource: "calendar.completeCalendar.move",
  fallbackRunError: String(completeCalendarResource.messages?.moveError || "Unable to move appointment."),
  fieldErrorKeys: ["startsAt", "endsAt"],
  model: moveState,
  parseInput: parsePatchCalendarEventInput,
  buildRawPayload: (model) => ({
    startsAt: model.startsAt,
    endsAt: model.endsAt
  }),
  messages: {
    success: String(completeCalendarResource.messages?.moveSuccess || "Appointment moved."),
    error: String(completeCalendarResource.messages?.moveError || "Unable to move appointment.")
  },
  onRunSuccess: async (_, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["calendar", "completeCalendar", "week"]
    });
    await weekView.refresh();
  }
});

const contactOptions = computed(() => {
  const options = [
    {
      id: 0,
      label: "All contacts"
    }
  ];

  for (const entry of contactsList.items.value) {
    const option = toContactOption(entry);
    if (option) {
      options.push(option);
    }
  }

  return options;
});

const contactOptionsWithoutAll = computed(() => contactOptions.value.filter((entry) => entry.id > 0));

const isRefreshing = computed(() => Boolean(weekView.isLoading.value || contactsList.isLoading.value));
const BUSINESS_START_TIME = "09:00:00";
const BUSINESS_END_TIME = "17:00:00";

function formatCalendarEventTitle(eventRecord = {}) {
  const title = String(eventRecord.title || "").trim();
  const contactName = String(eventRecord?.contact?.name || "").trim();
  const contactSurname = String(eventRecord?.contact?.surname || "").trim();
  const contactLabel = `${contactName} ${contactSurname}`.trim();

  if (!contactLabel) {
    return title || "Appointment";
  }

  return `${title || "Appointment"} (${contactLabel})`;
}

const calendarOptions = computed(() => ({
  plugins: [timeGridPlugin, interactionPlugin],
  initialView: "timeGridWeek",
  firstDay: 1,
  headerToolbar: {
    left: "prev,next today",
    center: "title",
    right: "timeGridWeek"
  },
  views: {
    timeGridWeek: {
      buttonText: "Week",
      slotMinTime: BUSINESS_START_TIME,
      slotMaxTime: BUSINESS_END_TIME
    }
  },
  initialDate: weekStart.value,
  allDaySlot: false,
  slotMinTime: BUSINESS_START_TIME,
  slotMaxTime: BUSINESS_END_TIME,
  scrollTime: BUSINESS_START_TIME,
  nowIndicator: true,
  editable: true,
  eventStartEditable: true,
  eventDurationEditable: true,
  selectable: true,
  selectMirror: true,
  eventOverlap: true,
  height: "auto",
  events: weekModel.items.map((eventRecord) => ({
    id: String(eventRecord.id),
    title: formatCalendarEventTitle(eventRecord),
    start: eventRecord.startsAt,
    end: eventRecord.endsAt,
    extendedProps: {
      eventId: eventRecord.id
    }
  })),
  datesSet: onDatesSet,
  eventClick: onEventClick,
  eventDrop: onEventMove,
  eventResize: onEventMove,
  select: onSelectRange
}));

function resetCreateForm() {
  createForm.contactId = 0;
  createForm.title = "";
  createForm.notes = "";
  createForm.startsAt = "";
  createForm.endsAt = "";
  createForm.status = "scheduled";
}

function openCreateDialog() {
  resetCreateForm();
  createDialog.value = true;
}

async function submitCreate() {
  await createCommand.run();
}

async function refreshWeek() {
  await weekView.refresh();
}

function onDatesSet(info) {
  const nextWeekStart = toDateOnlyIso(info.start);
  if (nextWeekStart && nextWeekStart !== weekStart.value) {
    weekStart.value = nextWeekStart;
  }
}

function onSelectRange(selectionInfo) {
  resetCreateForm();
  createForm.startsAt = selectionInfo.startStr ? selectionInfo.startStr.slice(0, 16) : "";
  createForm.endsAt = selectionInfo.endStr ? selectionInfo.endStr.slice(0, 16) : "";
  createDialog.value = true;
}

async function onEventMove(changeInfo) {
  const eventId = Number(changeInfo.event.id);
  const start = changeInfo.event.start;
  const end = changeInfo.event.end;

  if (!Number.isInteger(eventId) || eventId < 1 || !(start instanceof Date) || Number.isNaN(start.getTime())) {
    changeInfo.revert();
    return;
  }

  const resolvedEnd =
    end instanceof Date && !Number.isNaN(end.getTime()) ? end : new Date(start.getTime() + 60 * 60 * 1000);

  moveState.eventId = eventId;
  moveState.startsAt = start.toISOString();
  moveState.endsAt = resolvedEnd.toISOString();

  try {
    await moveCommand.run();
  } catch {
    changeInfo.revert();
  }
}

async function onEventClick(clickInfo) {
  const eventId = Number(clickInfo.event.id);
  const path = resolveAdminCalendarEventViewPath(eventId, placementContext.value, workspaceSlugFromRoute.value);

  if (path) {
    await router.push(path);
  }
}
</script>

<style scoped>
.complete-calendar-client-element :deep(.fc) {
  --fc-border-color: rgba(var(--v-theme-on-surface), 0.12);
  --fc-now-indicator-color: rgb(var(--v-theme-primary));
}

.complete-calendar-client-element :deep(.fc .fc-timegrid-slot) {
  height: 2.2rem;
}

.complete-calendar-client-element :deep(.fc .fc-event) {
  cursor: grab;
}

.complete-calendar-client-element :deep(.fc .fc-event:active) {
  cursor: grabbing;
}

.calendar-contact-filter {
  min-width: 220px;
}
</style>
