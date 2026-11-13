// JSKIT's Material 3 component defaults, on top of Vuetify's md3 blueprint: full-shape filled buttons, cards that rest
// flat on surface-container-low, flat expansion panels, outlined fields, 8dp chips that close with $close, segmented buttons and
// filter chips that select in secondary-container, the inverse-surface snackbar, the Material switch, Material 3's
// slider (Vuetify's pill variant) with a secondary-container inactive track, and the 16dp primary-container FAB. A
// number for `rounded` is an exact corner in dp. Card, dialog and bottom sheet corners and colours, a menu's own list,
// and the sizes and states props cannot set, are in material.css. No VMenu sub-component
// defaults: under them, in Vuetify 4.2.1 to 4.3.2, an ancestor's re-render makes the menu's virtual list lose its item
// heights, so a v-select's typeahead never scrolls to its match (https://github.com/vuetifyjs/vuetify/issues/23366;
// README, Upstream workarounds).
const materialDefaults = Object.freeze({
  VAppBar: {
    color: "surface",
    flat: true,
    height: 64
  },
  // `exact`: a button with `to` is active (its selected state layer) only on exactly its route, not on the pages under
  // it; navigation that marks a section, such as tabs, keeps its own.
  VBtn: {
    color: "primary",
    exact: true,
    rounded: "pill",
    variant: "flat"
  },
  // Cards rest flat. `variant="elevated"` is Material 3's elevated card, with its level-1 shadow; no default
  // elevation, which would lift flat, tonal and outlined cards too. Their 12dp corners are in material.css, so a
  // dialog's card can have 28dp ones: a `rounded` number would be an inline style no rule can outrank, and the md3
  // blueprint's `rounded: "lg"` goes too.
  VCard: {
    color: "surface-container-low",
    rounded: undefined,
    variant: "flat"
  },
  VChip: {
    closeIcon: "$close",
    rounded: 8
  },
  // Material 3 segmented buttons: an outlined pill divided into segments, the selected one in secondary-container.
  VBtnToggle: {
    border: true,
    color: "secondary-container",
    divided: true,
    rounded: "pill",
    variant: "flat"
  },
  // Material 3 filter chips: a selected chip is secondary-container with a check; material.css draws the outline.
  VChipGroup: {
    color: "secondary-container",
    filter: true,
    variant: "flat"
  },
  // A dialog's and a bottom sheet's card are drawn by material.css. Nothing goes under VDialog, Vuetify's other root
  // defaults provider: with any default there, a virtual-scroll list in a dialog loses its item heights whenever an
  // ancestor re-renders, as a select's list does under VMenu defaults (README, Upstream workarounds). Under
  // VBottomSheet, a VCard default never reached the card: the dialog it renders starts again from the app's defaults.
  VBottomSheet: {
    contentClass: "jskit-material-bottom-sheet"
  },
  // Expansion panels rest flat, as Material 3's lists and cards do.
  VExpansionPanels: {
    flat: true
  },
  VFab: {
    color: "primary-container",
    rounded: 16,
    variant: "elevated"
  },
  VList: {
    bgColor: "transparent"
  },
  VSnackbar: {
    color: "inverse-surface",
    rounded: 4,
    VBtn: {
      color: "inverse-primary",
      variant: "text"
    }
  },
  // Material 3 sliders: Vuetify's pill variant, Material 3's slider at its default (extra-small) size, with a 16dp track,
  // a 4x44dp handle bar set apart from the track by a gap, and a stop indicator at the end of the track. The active
  // track and the handle follow `color`, so an app's color prop still sets them, and the inactive track is
  // secondary-container, which material.css draws at full strength: on Vuetify's 4dp track that pale role all but
  // vanished on a light container. The md3 blueprint gives a range slider no colour at all.
  VSlider: {
    color: "primary",
    trackColor: "secondary-container",
    variant: "pill"
  },
  VRangeSlider: {
    color: "primary",
    trackColor: "secondary-container",
    variant: "pill"
  },
  VSwitch: {
    color: "primary",
    inset: "material"
  },
  // Outlined fields keep Vuetify's line for their supporting text, as a Material 3 text field does, so an error or
  // hint appears in place without moving what is below it. A field outside a form (a search box, a filter, a
  // composer) sets `hide-details` itself.
  VAutocomplete: {
    variant: "outlined"
  },
  VCombobox: {
    variant: "outlined"
  },
  VFileInput: {
    variant: "outlined"
  },
  VSelect: {
    variant: "outlined"
  },
  VTextarea: {
    variant: "outlined"
  },
  VTextField: {
    variant: "outlined"
  },
  VCheckbox: {
    color: "primary"
  },
  VRadioGroup: {
    color: "primary"
  },
  VTabs: {
    color: "primary"
  },
  VToolbar: {
    color: "surface"
  },
  VTooltip: {
    location: "bottom"
  }
});

export { materialDefaults };
