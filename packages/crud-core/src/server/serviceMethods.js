import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import { requireCrudNamespace } from "../shared/crudNamespaceSupport.js";
import { createCrudFieldAccessRuntime } from "./fieldAccess.js";

function createCrudServiceRuntime(resource = {}, { context = "crudService" } = {}) {
  const namespace = requireCrudNamespace(resource?.namespace, { context: `${context} resource.namespace` });
  const fieldAccessRuntime = createCrudFieldAccessRuntime(resource, { context });

  return Object.freeze({
    context,
    namespace,
    resource,
    fieldAccessRuntime
  });
}

function requireCrudServiceRepository(runtime = {}, repository = null) {
  if (!repository) {
    throw new Error(`${runtime?.context || "crudService"} requires repository.`);
  }
  return repository;
}

function splitCrudListRepositoryCall(query = {}, options = {}) {
  const normalizedQuery = normalizeObjectInput(query);
  const repositoryQuery = {
    ...normalizedQuery
  };
  delete repositoryQuery.include;

  const normalizedInclude = Object.hasOwn(normalizedQuery, "include")
    ? normalizeText(normalizedQuery.include)
    : undefined;

  return {
    query: repositoryQuery,
    options: normalizedInclude === undefined
      ? options
      : {
          ...options,
          include: options?.include === undefined ? normalizedInclude : options.include
        }
  };
}

async function crudServiceListRecords(runtime, repository, fieldAccess = {}, query = {}, options = {}) {
  const resolvedRepository = requireCrudServiceRepository(runtime, repository);
  const repositoryCall = splitCrudListRepositoryCall(query, options);
  const result = await resolvedRepository.list(repositoryCall.query, repositoryCall.options);
  return runtime.fieldAccessRuntime.filterReadableListResult(result, fieldAccess, {
    action: "list",
    query,
    options,
    context: options?.context
  });
}

async function crudServiceGetRecord(runtime, repository, fieldAccess = {}, recordId, options = {}) {
  const resolvedRepository = requireCrudServiceRepository(runtime, repository);
  const record = await resolvedRepository.findById(recordId, options);
  if (!record) {
    throw new AppError(404, "Record not found.");
  }

  return runtime.fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
    action: "view",
    recordId,
    options,
    context: options?.context
  });
}

async function crudServiceCreateRecord(runtime, repository, fieldAccess = {}, payload = {}, options = {}) {
  const resolvedRepository = requireCrudServiceRepository(runtime, repository);
  const writablePayload = await runtime.fieldAccessRuntime.enforceWritablePayload(payload, fieldAccess, {
    action: "create",
    payload,
    options,
    context: options?.context
  });
  const record = await resolvedRepository.create(writablePayload, options);
  if (!record) {
    throw new Error(`${runtime.namespace}Service could not load the created record.`);
  }
  return runtime.fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
    action: "create",
    options,
    context: options?.context
  });
}

async function crudServiceUpdateRecord(runtime, repository, fieldAccess = {}, recordId, payload = {}, options = {}) {
  const resolvedRepository = requireCrudServiceRepository(runtime, repository);
  const existingRecord = await resolvedRepository.findById(recordId, options);
  if (!existingRecord) {
    throw new AppError(404, "Record not found.");
  }

  const writablePayload = await runtime.fieldAccessRuntime.enforceWritablePayload(payload, fieldAccess, {
    action: "update",
    recordId,
    payload,
    options,
    context: options?.context,
    existingRecord
  });

  const patchBodyValidator = runtime.resource?.operations?.patch?.bodyValidator;
  let normalizedPatch = writablePayload;
  if (patchBodyValidator && typeof patchBodyValidator.normalize === "function") {
    try {
      normalizedPatch = await patchBodyValidator.normalize(writablePayload, {
        phase: "crudPatch",
        action: "update",
        recordId,
        existingRecord,
        context: options?.context
      });
    } catch (error) {
      const explicitFieldErrors = isRecord(error?.fieldErrors)
        ? error.fieldErrors
        : (
            isRecord(error?.details?.fieldErrors)
              ? error.details.fieldErrors
              : null
          );
      if (explicitFieldErrors) {
        throw createValidationError(explicitFieldErrors);
      }
      throw error;
    }
  }

  const record = await resolvedRepository.updateById(recordId, normalizedPatch, options);
  if (!record) {
    throw new AppError(404, "Record not found.");
  }
  return runtime.fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
    action: "update",
    recordId,
    options,
    context: options?.context
  });
}

async function crudServiceDeleteRecord(runtime, repository, fieldAccess = {}, recordId, options = {}) {
  const resolvedRepository = requireCrudServiceRepository(runtime, repository);
  const deleted = await resolvedRepository.deleteById(recordId, options);
  if (!deleted) {
    throw new AppError(404, "Record not found.");
  }
  return deleted;
}

export {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord,
  crudServiceCreateRecord,
  crudServiceUpdateRecord,
  crudServiceDeleteRecord
};
