import { schema } from "./schemas.js";
import { withStandardErrorResponses } from "../api/schemas.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/workspace/projects",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.read",
      schema: {
        tags: ["projects"],
        summary: "List projects for active workspace",
        querystring: schema.query,
        response: withStandardErrorResponses(
          {
            200: schema.response.list
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.list || missingHandler
    },
    {
      path: "/api/workspace/projects/:projectId",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.read",
      schema: {
        tags: ["projects"],
        summary: "Get project by id for active workspace",
        params: schema.params,
        response: withStandardErrorResponses({
          200: schema.response.single
        })
      },
      handler: controllers.projects?.get || missingHandler
    },
    {
      path: "/api/workspace/projects",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.write",
      schema: {
        tags: ["projects"],
        summary: "Create project for active workspace",
        body: schema.body.create,
        response: withStandardErrorResponses(
          {
            200: schema.response.single
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.create || missingHandler
    },
    {
      path: "/api/workspace/projects/:projectId",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.write",
      schema: {
        tags: ["projects"],
        summary: "Update project for active workspace",
        params: schema.params,
        body: schema.body.update,
        response: withStandardErrorResponses(
          {
            200: schema.response.single
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.update || missingHandler
    },
    {
      path: "/api/workspace/projects/:projectId",
      method: "PUT",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.write",
      schema: {
        tags: ["projects"],
        summary: "Replace project for active workspace",
        params: schema.params,
        body: schema.body.replace,
        response: withStandardErrorResponses(
          {
            200: schema.response.single
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.replace || missingHandler
    }
  ];
}

export { buildRoutes };
