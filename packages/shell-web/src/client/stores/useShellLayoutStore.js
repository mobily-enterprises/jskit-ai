import { ref } from "vue";
import { defineStore } from "pinia";
import {
  readDrawerDefaultOpenPreference,
  writeDrawerDefaultOpenPreference
} from "../composables/shellLayoutDrawerPreference.js";

export const useShellLayoutStore = defineStore("jskit.shell-web.layout", () => {
  const drawerDefaultOpen = ref(readDrawerDefaultOpenPreference());
  const drawerOpen = ref(drawerDefaultOpen.value);
  const supportingContentOpen = ref(false);
  const supportingContentTitle = ref("");

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

  function openSupportingContent({ title = "" } = {}) {
    supportingContentTitle.value = String(title || "").trim();
    supportingContentOpen.value = true;
  }

  function closeSupportingContent() {
    supportingContentOpen.value = false;
  }

  function setSupportingContentOpen(open) {
    supportingContentOpen.value = Boolean(open);
  }

  return {
    drawerDefaultOpen,
    drawerOpen,
    supportingContentOpen,
    supportingContentTitle,
    setDrawerDefaultOpen,
    setDrawerOpen,
    toggleDrawer,
    openSupportingContent,
    closeSupportingContent,
    setSupportingContentOpen
  };
});
