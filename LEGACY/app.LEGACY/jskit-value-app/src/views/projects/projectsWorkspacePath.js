function workspacePathForProjects(workspaceStore, suffix) {
  return workspaceStore.workspacePath(suffix, {
    surface: "admin"
  });
}

export { workspacePathForProjects };
