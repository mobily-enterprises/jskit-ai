import {
  querySchema,
  paramsSchema,
  listResponseSchema,
  singleResponseSchema,
  createBodySchema,
  updateBodySchema
} from "./projects.schemas.js";
import { withStandardErrorResponses } from "../common.schemas.js";

function buildProjectsRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/workspace/projects",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.read",
      schema: {
        tags: ["workspace"],
        summary: "List projects for active workspace",
        querystring: querySchema,
        response: withStandardErrorResponses(
          {
            200: listResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.listWorkspaceProjects || missingHandler
    },
    {
      path: "/api/workspace/projects/:projectId",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.read",
      schema: {
        tags: ["workspace"],
        summary: "Get project by id for active workspace",
        params: paramsSchema,
        response: withStandardErrorResponses({
          200: singleResponseSchema
        })
      },
      handler: controllers.projects?.getWorkspaceProject || missingHandler
    },
    {
      path: "/api/workspace/projects",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.write",
      schema: {
        tags: ["workspace"],
        summary: "Create project for active workspace",
        body: createBodySchema,
        response: withStandardErrorResponses(
          {
            200: singleResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.createWorkspaceProject || missingHandler
    },
    {
      path: "/api/workspace/projects/:projectId",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "projects.write",
      schema: {
        tags: ["workspace"],
        summary: "Update project for active workspace",
        params: paramsSchema,
        body: updateBodySchema,
        response: withStandardErrorResponses(
          {
            200: singleResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.updateWorkspaceProject || missingHandler
    }
  ];
}

export { buildProjectsRoutes };
