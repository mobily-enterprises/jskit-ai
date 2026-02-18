import {
  querySchema,
  paramsSchema,
  listResponseSchema,
  singleResponseSchema,
  createBodySchema,
  updateBodySchema,
  replaceBodySchema
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
        tags: ["projects"],
        summary: "List projects for active workspace",
        querystring: querySchema,
        response: withStandardErrorResponses(
          {
            200: listResponseSchema
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
        params: paramsSchema,
        response: withStandardErrorResponses({
          200: singleResponseSchema
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
        body: createBodySchema,
        response: withStandardErrorResponses(
          {
            200: singleResponseSchema
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
        params: paramsSchema,
        body: updateBodySchema,
        response: withStandardErrorResponses(
          {
            200: singleResponseSchema
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
        params: paramsSchema,
        body: replaceBodySchema,
        response: withStandardErrorResponses(
          {
            200: singleResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.projects?.replace || missingHandler
    }
  ];
}

export { buildProjectsRoutes };
