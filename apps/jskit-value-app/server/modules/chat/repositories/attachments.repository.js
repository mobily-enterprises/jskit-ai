import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-knex-mysql/repositories/attachments";

const repository = createRepository(db);

export const {
  insertReserved,
  findById,
  findByClientAttachmentId,
  listByMessageId,
  listByMessageIds,
  listStagedByUserIdAndThreadId,
  markUploading,
  markUploaded,
  attachToMessage,
  markFailed,
  markExpired,
  markDeleted,
  listExpiredUnattached,
  deleteExpiredUnattachedBatch,
  deleteDetachedOlderThan,
  transaction
} = repository;

export { __testables };
