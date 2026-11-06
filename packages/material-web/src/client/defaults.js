// JSKIT's Material 3 component defaults, on top of Vuetify's md3 blueprint: full-shape filled buttons, elevated cards
// on surface-container-low with 12dp corners, outlined fields, 8dp chips that close with $close, 4dp menus and the
// inverse-surface snackbar, the Material switch, and the 16dp primary-container FAB. A number for `rounded` is an exact
// corner in dp. Dialog and bottom sheet corners, and the sizes props cannot set, are in material.css.
const materialDefaults = Object.freeze({
  VAppBar: {
    color: "surface",
    flat: true,
    height: 64
  },
  VBtn: {
    color: "primary",
    rounded: "pill",
    variant: "flat"
  },
  VCard: {
    color: "surface-container-low",
    elevation: 1,
    rounded: 12
  },
  VChip: {
    closeIcon: "$close",
    rounded: 8
  },
  // material.css gives the dialog's card 28dp corners, and none when the dialog is full-screen.
  VDialog: {
    VCard: {
      color: "surface-container-high",
      elevation: 3,
      rounded: undefined
    }
  },
  VBottomSheet: {
    contentClass: "jskit-material-bottom-sheet",
    VCard: {
      color: "surface-container-low",
      elevation: 1,
      rounded: 0
    }
  },
  VFab: {
    color: "primary-container",
    rounded: 16,
    variant: "elevated"
  },
  VList: {
    bgColor: "transparent"
  },
  VMenu: {
    VList: {
      bgColor: "surface-container",
      elevation: 2,
      rounded: 4
    }
  },
  VSnackbar: {
    color: "inverse-surface",
    rounded: 4,
    VBtn: {
      color: "inverse-primary",
      variant: "text"
    }
  },
  VSwitch: {
    color: "primary",
    inset: "material"
  },
  VAutocomplete: {
    hideDetails: "auto",
    variant: "outlined"
  },
  VCombobox: {
    hideDetails: "auto",
    variant: "outlined"
  },
  VFileInput: {
    hideDetails: "auto",
    variant: "outlined"
  },
  VSelect: {
    hideDetails: "auto",
    variant: "outlined"
  },
  VTextarea: {
    hideDetails: "auto",
    variant: "outlined"
  },
  VTextField: {
    hideDetails: "auto",
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
