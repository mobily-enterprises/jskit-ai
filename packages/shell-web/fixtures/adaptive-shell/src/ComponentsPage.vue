<script setup>
import { nextTick, ref } from "vue";
import { usePaths } from "../../../src/client/navigation/usePaths.js";

// Material 3 components as JSKIT's defaults draw them: a segmented button, filter chips (in a chip group and toggled
// with aria-pressed), fixed tabs that share a phone's width or scroll, a menu's own list beside a list in a rich menu
// panel, dialog actions, a disabled filled button, a card and expansion panels at rest, a pagination's current page,
// placeholders, a button to the page above this one, which isn't active here, and a segmented button and a button
// group in the narrow `auto` column of a filter row, beside wide fields, and a dialog holding a virtual-scroll list
// that jumps to its last item as the expansion panel around it re-renders.
const paths = usePaths();
const page = ref(2);
const view = ref("day");
const target = ref("pet");
const statuses = ref(["open"]);
const starred = ref(true);
const tab = ref("mon");
const longTab = ref("everything");
const dialog = ref(false);
const bookingsDialog = ref(false);
const bookings = Array.from({ length: 40 }, (_, index) => `Booking ${index + 1}`);
const bookingsScroll = ref(null);
const pageRenders = ref(0);
// The panel around the dialog re-renders first (as a form does when a field changes), then the list scrolls to its
// last item.
function jumpToLastBooking() {
  pageRenders.value += 1;
  nextTick(() => bookingsScroll.value?.scrollToIndex(bookings.length - 1));
}
</script>

<template>
  <section class="d-flex flex-column align-start ga-6 py-4">
    <v-btn-toggle v-model="view" mandatory data-testid="fixture-segmented">
      <v-btn value="day">Day</v-btn>
      <v-btn value="week">Week</v-btn>
      <v-btn value="month" prepend-icon="$calendar">Month</v-btn>
    </v-btn-toggle>

    <div class="fixture-filter-row align-self-stretch" data-testid="fixture-filter-row">
      <v-btn-toggle v-model="target" mandatory color="primary" divided data-testid="fixture-segmented-two">
        <v-btn value="pet">Pet</v-btn>
        <v-btn value="contact">Customer</v-btn>
      </v-btn-toggle>
      <v-text-field label="Customer" hide-details />
      <v-text-field label="Search history" hide-details />
      <v-text-field label="From" hide-details />
      <v-text-field label="To" hide-details />
      <v-text-field label="Kind" hide-details />
      <v-btn-group divided data-testid="fixture-button-group">
        <v-btn>Day</v-btn>
        <v-btn>Week</v-btn>
        <v-btn>Month</v-btn>
      </v-btn-group>
    </div>

    <v-chip-group v-model="statuses" multiple column data-testid="fixture-chip-group">
      <v-chip value="open" data-testid="fixture-chip-open">Open</v-chip>
      <v-chip value="closed" data-testid="fixture-chip-closed">Closed</v-chip>
    </v-chip-group>
    <div class="d-flex ga-2">
      <v-chip
        tag="button"
        type="button"
        :aria-pressed="starred ? 'true' : 'false'"
        data-testid="fixture-pressed-chip"
        @click="starred = !starred"
      >
        Starred
      </v-chip>
      <v-chip variant="outlined" data-testid="fixture-outlined-chip">Assist</v-chip>
    </div>

    <v-tabs v-model="tab" grow class="align-self-stretch" data-testid="fixture-grow-tabs">
      <v-tab value="mon">Mon</v-tab>
      <v-tab value="tue">Tue</v-tab>
      <v-tab value="wed">Wed</v-tab>
      <v-tab value="thu">Thu</v-tab>
      <v-tab value="fri">Fri</v-tab>
    </v-tabs>
    <v-tabs v-model="longTab" grow class="align-self-stretch" data-testid="fixture-long-tabs">
      <v-tab value="everything">Everything on the account</v-tab>
      <v-tab value="bookings">Bookings and their invoices</v-tab>
      <v-tab value="team">Settings for the whole team</v-tab>
      <v-tab value="alerts">Notifications</v-tab>
    </v-tabs>

    <div class="d-flex ga-2">
      <v-menu>
        <template #activator="{ props: menu }">
          <v-btn variant="text" v-bind="menu">Plain menu</v-btn>
        </template>
        <v-list data-testid="fixture-menu-list">
          <v-list-item title="First" />
        </v-list>
      </v-menu>
      <v-menu>
        <template #activator="{ props: menu }">
          <v-btn variant="text" v-bind="menu">Rich menu</v-btn>
        </template>
        <v-card data-testid="fixture-menu-panel">
          <v-card-text>A rich menu panel.</v-card-text>
          <v-list data-testid="fixture-panel-list">
            <v-list-item title="Inside the panel" />
          </v-list>
        </v-card>
      </v-menu>
    </div>

    <v-btn disabled data-testid="fixture-disabled-button">Update password</v-btn>
    <v-btn :to="paths.page('/')" data-testid="fixture-home-button">Start your first session</v-btn>
    <v-pagination v-model="page" :length="5" data-testid="fixture-pagination" />
    <v-text-field placeholder="Search contacts" class="align-self-stretch" data-testid="fixture-placeholder" />
    <v-text-field label="Name" placeholder="Ada Lovelace" class="align-self-stretch" data-testid="fixture-labelled" />
    <v-card class="align-self-stretch" data-testid="fixture-card">
      <v-card-text>A card at rest.</v-card-text>
    </v-card>
    <v-expansion-panels data-testid="fixture-expansion-panels">
      <v-expansion-panel title="Delivery" text="Delivered on Tuesdays." />
      <v-expansion-panel title="Returns" text="Returned within 30 days." />
    </v-expansion-panels>

    <v-btn variant="text" @click="dialog = true">Open dialog</v-btn>
    <!-- An expansion panel draws its content in a defaults provider it rebuilds whenever it re-renders, here when its
         title changes, so the dialog inside it receives new defaults, and the list its items anew, as a list mapped
         or filtered in a template does. -->
    <v-expansion-panels :model-value="['bookings']" multiple>
      <v-expansion-panel value="bookings" :title="`Bookings, changed ${pageRenders} times`">
        <v-expansion-panel-text>
          <v-btn variant="text" @click="bookingsDialog = true">Open bookings</v-btn>
          <output data-testid="fixture-page-renders">{{ pageRenders }}</output>
          <v-dialog v-model="bookingsDialog" max-width="400">
            <v-virtual-scroll
              ref="bookingsScroll"
              :items="bookings.map((title) => ({ title }))"
              height="240"
              data-testid="fixture-bookings-scroll"
            >
              <template #default="{ item }">
                <v-list-item :title="item.title" />
              </template>
            </v-virtual-scroll>
            <v-btn @click="jumpToLastBooking">Last booking</v-btn>
          </v-dialog>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-dialog v-model="dialog" max-width="400">
      <v-card title="Discard draft?" text="The draft is not saved." data-testid="fixture-dialog">
        <v-card-actions>
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn @click="dialog = false">Discard</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
/* A filter row as an app lays one out: the segmented button and the button group in `auto` columns beside wide
   fields, so their segments get only the room their own padding and labels need. At 1440 the row is 1032px and the
   fields' minimums (34rem) leave the two auto columns 416px: whole labels need 381px with 12dp segments and 501px
   with a common button's 24dp sides. One column on a narrow window. */
.fixture-filter-row {
  align-items: end;
  display: grid;
  gap: 12px;
  grid-template-columns: auto minmax(8rem, 1.2fr) minmax(8rem, 1.2fr) minmax(6rem, 0.7fr) minmax(6rem, 0.7fr) minmax(6rem, 1fr) auto;
  max-width: 1100px;
}

@media (max-width: 1279px) {
  .fixture-filter-row {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }
}
</style>
