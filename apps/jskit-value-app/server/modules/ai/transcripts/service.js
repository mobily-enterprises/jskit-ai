import {
  createService as createAssistantTranscriptsCoreService,
  __testables as assistantTranscriptsCoreTestables
} from "../../../../../../packages/ai-agent/assistant-transcripts-core/src/service.js";
import { AppError } from "../../../lib/errors.js";
import {
  CONSOLE_AI_TRANSCRIPTS_PERMISSIONS,
  hasPermission,
  resolveRolePermissions
} from "../../../domain/console/policies/roles.js";

function createService(options = {}) {
  return createAssistantTranscriptsCoreService({
    ...(options || {}),
    appErrorClass: AppError,
    hasPermissionFn: hasPermission,
    resolveRolePermissionsFn: resolveRolePermissions,
    consoleReadPermission: CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL,
    consoleExportPermission: CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.EXPORT_ALL
  });
}

const __testables = assistantTranscriptsCoreTestables;

export { createService, __testables };
