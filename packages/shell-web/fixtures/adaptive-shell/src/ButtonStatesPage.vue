<script setup>
// Buttons by variant and pressable chips, at rest, selected and disabled, for the state-layer baselines: every
// layer (a tonal underlay, a disabled or selected state layer, hover, focus and pressed) stays inside the control's
// shape. A pagination shows its selected page. The last rows are auth-web's: reset password's large block Update password while the form is incomplete,
// and the profile menu's avatar trigger, with the name and, as on phones, as an icon button.
const VARIANTS = Object.freeze(["flat", "tonal", "elevated", "outlined", "text"]);
const STATES = Object.freeze(["rest", "active", "disabled"]);
</script>

<template>
  <section class="d-flex flex-column ga-4 pa-4">
    <div v-for="state in STATES" :key="state" class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="variant in VARIANTS"
        :key="variant"
        :variant="variant"
        :active="state === 'active'"
        :disabled="state === 'disabled'"
        :data-testid="`state-${variant}-${state}`"
      >
        {{ variant }}
      </v-btn>
      <v-btn
        icon="$edit"
        variant="tonal"
        :active="state === 'active'"
        :disabled="state === 'disabled'"
        :aria-label="`Edit, ${state}`"
        :data-testid="`state-icon-${state}`"
      />
    </div>
    <v-pagination :length="5" :model-value="2" data-testid="state-pagination" />
    <v-btn block color="primary" size="large" disabled data-testid="state-block-disabled">Update password</v-btn>
    <div class="d-flex align-center ga-2">
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-btn v-bind="menu" variant="text" class="text-none pl-1 pr-2" data-testid="state-profile">
            <v-avatar size="32" color="primary" variant="tonal">
              <span class="text-body-small font-weight-medium">AL</span>
            </v-avatar>
            <span class="ml-2 text-body-medium">Ada Lovelace</span>
          </v-btn>
        </template>
        <v-list><v-list-item title="Account" /></v-list>
      </v-menu>
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-btn v-bind="menu" icon variant="text" aria-label="Ada Lovelace" data-testid="state-profile-icon">
            <v-avatar size="32" color="primary" variant="tonal">
              <span class="text-body-small font-weight-medium">AL</span>
            </v-avatar>
          </v-btn>
        </template>
        <v-list><v-list-item title="Account" /></v-list>
      </v-menu>
    </div>
    <div class="d-flex flex-wrap ga-2">
      <v-chip link variant="tonal" data-testid="state-chip-tonal">Tonal chip</v-chip>
      <v-chip link data-testid="state-chip-link">Assist chip</v-chip>
      <v-chip link disabled data-testid="state-chip-disabled">Disabled chip</v-chip>
    </div>
  </section>
</template>
