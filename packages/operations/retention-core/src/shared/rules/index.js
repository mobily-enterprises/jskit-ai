import { createConsoleErrorRetentionRules } from "./consoleErrors.rules.js";
import { createInviteRetentionRules } from "./invites.rules.js";
import { createAuditRetentionRules } from "./audit.rules.js";
import { createAiTranscriptRetentionRules } from "./aiTranscripts.rules.js";
import { createChatRetentionRules } from "./chat.rules.js";
import { createBillingRetentionRules } from "./billing.rules.js";

function createRetentionRulePack({ repositories, retentionConfig }) {
  const policy = retentionConfig && typeof retentionConfig === "object" ? retentionConfig : {};

  return [
    ...createConsoleErrorRetentionRules({
      consoleErrorLogsRepository: repositories.consoleErrorLogsRepository
    }),
    ...createInviteRetentionRules({
      workspaceInvitesRepository: repositories.workspaceInvitesRepository,
      consoleInvitesRepository: repositories.consoleInvitesRepository
    }),
    ...createAuditRetentionRules({
      auditEventsRepository: repositories.auditEventsRepository
    }),
    ...createAiTranscriptRetentionRules({
      aiTranscriptMessagesRepository: repositories.aiTranscriptMessagesRepository,
      aiTranscriptConversationsRepository: repositories.aiTranscriptConversationsRepository
    }),
    ...createChatRetentionRules(
      {
        chatThreadsRepository: repositories.chatThreadsRepository,
        chatParticipantsRepository: repositories.chatParticipantsRepository,
        chatMessagesRepository: repositories.chatMessagesRepository,
        chatIdempotencyTombstonesRepository: repositories.chatIdempotencyTombstonesRepository,
        chatAttachmentsRepository: repositories.chatAttachmentsRepository
      },
      {
        chatEmptyThreadCleanupEnabled: policy.chatEmptyThreadCleanupEnabled
      }
    ),
    ...createBillingRetentionRules({
      billingRepository: repositories.billingRepository || null
    })
  ];
}

export { createRetentionRulePack };
