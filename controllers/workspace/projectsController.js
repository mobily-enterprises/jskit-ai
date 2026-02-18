function createProjectsController({ projectsService }) {
  if (!projectsService) {
    throw new Error("projectsService is required.");
  }

  async function listWorkspaceProjects(request, reply) {
    const query = request.query || {};
    const response = await projectsService.listProjects(request.workspace, {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 10)
    });
    reply.code(200).send(response);
  }

  async function getWorkspaceProject(request, reply) {
    const response = await projectsService.getProject(request.workspace, request.params?.projectId);
    reply.code(200).send(response);
  }

  async function createWorkspaceProject(request, reply) {
    const response = await projectsService.createProject(request.workspace, request.body || {});
    reply.code(200).send(response);
  }

  async function updateWorkspaceProject(request, reply) {
    const response = await projectsService.updateProject(
      request.workspace,
      request.params?.projectId,
      request.body || {}
    );
    reply.code(200).send(response);
  }

  return {
    listWorkspaceProjects,
    getWorkspaceProject,
    createWorkspaceProject,
    updateWorkspaceProject
  };
}

export { createProjectsController };
