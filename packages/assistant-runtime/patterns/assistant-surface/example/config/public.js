const config = {
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: false
    }
  },
  assistantSurfaces: {
    admin: {
      settingsSurfaceId: "admin",
      configScope: "global"
    }
  }
};

export default config;
