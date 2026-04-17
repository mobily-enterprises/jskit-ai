import { ref } from "vue";
import { defineStore } from "pinia";
import {
  readDrawerDefaultOpenPreference,
  writeDrawerDefaultOpenPreference
} from "../composables/shellLayoutDrawerPreference.js";

export const useShellLayoutStore = defineStore("jskit.shell-web.layout", () => {
  const drawerDefaultOpen = ref(readDrawerDefaultOpenPreference());
  const drawerOpen = ref(drawerDefaultOpen.value);

  function setDrawerDefaultOpen(open) {
    const normalized = Boolean(open);
    drawerDefaultOpen.value = normalized;
    drawerOpen.value = normalized;
    writeDrawerDefaultOpenPreference(normalized);
  }

  function setDrawerOpen(open) {
    drawerOpen.value = Boolean(open);
  }

  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value;
  }

  return {
    drawerDefaultOpen,
    drawerOpen,
    setDrawerDefaultOpen,
    setDrawerOpen,
    toggleDrawer
  };
});
