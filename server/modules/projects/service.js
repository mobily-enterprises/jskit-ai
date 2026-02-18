import { AppError } from "../../lib/errors.js";
import { parsePositiveInteger } from "../../domain/common/integers.js";

const PROJECT_STATUS_SET = new Set(["draft", "active", "archived"]);

function normalizeWorkspaceId(workspaceContext) {
  const workspaceId = parsePositiveInteger(workspaceContext?.id);
  if (!workspaceId) {
    throw new AppError(409, "Workspace selection required.");
  }

  return workspaceId;
}

function normalizeProjectId(value) {
  const projectId = parsePositiveInteger(value);
  if (!projectId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          projectId: "Project id must be a positive integer."
        }
      }
    });
  }

  return projectId;
}

function normalizeStatus(value, { required } = { required: false }) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized && !required) {
    return "";
  }

  if (!PROJECT_STATUS_SET.has(normalized)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          status: "Status must be draft, active, or archived."
        }
      }
    });
  }

  return normalized;
}

function normalizeName(value, { required } = { required: false }) {
  const normalized = String(value || "").trim();
  if (!normalized && !required) {
    return "";
  }

  if (!normalized) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          name: "Project name is required."
        }
      }
    });
  }

  if (normalized.length > 160) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          name: "Project name must be at most 160 characters."
        }
      }
    });
  }

  return normalized;
}

function normalizeOwner(value, { required } = { required: false }) {
  const normalized = String(value || "").trim();
  if (!normalized && !required) {
    return "";
  }

  if (normalized.length > 120) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          owner: "Owner must be at most 120 characters."
        }
      }
    });
  }

  return normalized;
}

function normalizeNotes(value, { required } = { required: false }) {
  const normalized = String(value || "").trim();
  if (!normalized && !required) {
    return "";
  }

  if (normalized.length > 5000) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          notes: "Notes must be at most 5000 characters."
        }
      }
    });
  }

  return normalized;
}

function createService({ projectsRepository }) {
  if (!projectsRepository) {
    throw new Error("projectsRepository is required.");
  }

  async function list(workspaceContext, pagination) {
    const workspaceId = normalizeWorkspaceId(workspaceContext);
    const page = Math.max(1, Number(pagination?.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(pagination?.pageSize) || 10));

    const total = await projectsRepository.countForWorkspace(workspaceId);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const entries = await projectsRepository.listForWorkspace(workspaceId, safePage, pageSize);

    return {
      entries,
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  async function get(workspaceContext, projectIdLike) {
    const workspaceId = normalizeWorkspaceId(workspaceContext);
    const projectId = normalizeProjectId(projectIdLike);
    const project = await projectsRepository.findByIdForWorkspace(workspaceId, projectId);

    if (!project) {
      throw new AppError(404, "Project not found.");
    }

    return {
      project
    };
  }

  async function create(workspaceContext, payload) {
    const workspaceId = normalizeWorkspaceId(workspaceContext);
    const body = payload && typeof payload === "object" ? payload : {};

    const project = await projectsRepository.insert(workspaceId, {
      name: normalizeName(body.name, { required: true }),
      status: normalizeStatus(body.status || "draft", { required: true }),
      owner: normalizeOwner(body.owner),
      notes: normalizeNotes(body.notes)
    });

    return {
      project
    };
  }

  async function update(workspaceContext, projectIdLike, payload) {
    const workspaceId = normalizeWorkspaceId(workspaceContext);
    const projectId = normalizeProjectId(projectIdLike);
    const body = payload && typeof payload === "object" ? payload : {};
    const patch = {};

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      patch.name = normalizeName(body.name, { required: true });
    }

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      patch.status = normalizeStatus(body.status, { required: true });
    }

    if (Object.prototype.hasOwnProperty.call(body, "owner")) {
      patch.owner = normalizeOwner(body.owner, { required: true });
    }

    if (Object.prototype.hasOwnProperty.call(body, "notes")) {
      patch.notes = normalizeNotes(body.notes, { required: true });
    }

    if (Object.keys(patch).length < 1) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            request: "At least one project field must be provided."
          }
        }
      });
    }

    const project = await projectsRepository.updateByIdForWorkspace(workspaceId, projectId, patch);
    if (!project) {
      throw new AppError(404, "Project not found.");
    }

    return {
      project
    };
  }

  async function replace(workspaceContext, projectIdLike, payload) {
    const workspaceId = normalizeWorkspaceId(workspaceContext);
    const projectId = normalizeProjectId(projectIdLike);
    const body = payload && typeof payload === "object" ? payload : {};
    const replacement = {
      name: normalizeName(body.name, { required: true }),
      status: normalizeStatus(body.status || "draft", { required: true }),
      owner: normalizeOwner(body.owner),
      notes: normalizeNotes(body.notes)
    };

    const project = await projectsRepository.updateByIdForWorkspace(workspaceId, projectId, replacement);
    if (!project) {
      throw new AppError(404, "Project not found.");
    }

    return {
      project
    };
  }

  return {
    list,
    get,
    create,
    update,
    replace
  };
}

export { createService };
