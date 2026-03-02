const CLIENT_ROUTE_MOUNT_REGISTRY = Object.freeze([
  {
    moduleId: "ai",
    surface: "app",
    key: "ai.workspace",
    defaultPath: "/assistant"
  },
  {
    moduleId: "ai",
    surface: "admin",
    key: "ai.workspace",
    defaultPath: "/assistant"
  },
  {
    moduleId: "chat",
    surface: "app",
    key: "chat.workspace",
    defaultPath: "/chat"
  },
  {
    moduleId: "chat",
    surface: "admin",
    key: "chat.workspace",
    defaultPath: "/chat"
  },
  {
    moduleId: "social",
    surface: "app",
    key: "social.workspace",
    defaultPath: "/social"
  },
  {
    moduleId: "social",
    surface: "admin",
    key: "social.workspace",
    defaultPath: "/social"
  },
  {
    moduleId: "projects",
    surface: "admin",
    key: "projects.workspace",
    defaultPath: "/projects"
  }
]);

function listClientRouteMounts() {
  return CLIENT_ROUTE_MOUNT_REGISTRY;
}

export { CLIENT_ROUTE_MOUNT_REGISTRY, listClientRouteMounts };
