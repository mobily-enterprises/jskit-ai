import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/assistant-transcripts-core/repositories/messages";

const repository = createRepository(db);

export const {
  insert,
  findById,
  listByConversationId,
  listByConversationIdForWorkspace,
  countByConversationId,
  countByConversationIdForWorkspace,
  exportByFilters,
  deleteOlderThan,
  transaction
} = repository;

export { __testables };
