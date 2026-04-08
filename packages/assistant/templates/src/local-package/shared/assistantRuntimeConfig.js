const assistantRuntimeConfig = Object.freeze({
  runtimeSurfaceId: "__ASSISTANT_RUNTIME_SURFACE_ID__",
  settingsSurfaceId: "__ASSISTANT_SETTINGS_SURFACE_ID__",
  runtimeSurfaceRequiresWorkspace: __ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__,
  settingsSurfaceRequiresWorkspace: __ASSISTANT_SETTINGS_SURFACE_REQUIRES_WORKSPACE__,
  settingsSurfaceRequiresConsoleOwner: __ASSISTANT_SETTINGS_SURFACE_REQUIRES_CONSOLE_OWNER__,
  configScope: "__ASSISTANT_CONFIG_SCOPE__",
  configTable: "__ASSISTANT_CONFIG_TABLE__",
  conversationsTable: "__ASSISTANT_CONVERSATIONS_TABLE__",
  messagesTable: "__ASSISTANT_MESSAGES_TABLE__"
});

export { assistantRuntimeConfig };
