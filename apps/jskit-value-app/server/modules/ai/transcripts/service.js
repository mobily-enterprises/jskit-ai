import {
  createAssistantTranscriptsService as createAssistantTranscriptsCoreService,
  assistantTranscriptsServiceTestables as assistantTranscriptsCoreTestables
} from "@jskit-ai/assistant-transcripts-core";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import {
  CONSOLE_AI_TRANSCRIPTS_PERMISSIONS,
  hasPermission,
  resolveRolePermissions
} from "@jskit-ai/workspace-console-core/consoleRoles";

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
