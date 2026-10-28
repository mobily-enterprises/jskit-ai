import { ThemeSymbol } from "vuetify/lib/composables/theme.js";

function createVuetifyThemeController(initialTheme = "light") {
  let themeName = initialTheme;
  return {
    global: {
      name: {
        get value() {
          return themeName;
        },
        set value(_themeName) {
          throw new Error("Vuetify deprecates assigning theme.global.name.value; use theme.change().");
        }
      }
    },
    change(nextThemeName) {
      themeName = nextThemeName;
    },
    themes: {
      value: {
        light: {
          dark: false,
          colors: {
            primary: "#0f6b54",
            secondary: "#3f5150",
            background: "#eef3ee",
            surface: "#f7fbf6",
            "surface-variant": "#dfe8df"
          }
        },
        dark: {
          dark: true,
          colors: {
            primary: "#6fd0b5",
            secondary: "#9db2af",
            background: "#0f1715",
            surface: "#16211e",
            "surface-variant": "#253430"
          }
        }
      }
    },
    _context: {
      provides: {
        [ThemeSymbol]: null
      }
    }
  };
}

export { createVuetifyThemeController };
