import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-core/repositories/idempotencyTombstones";

const repository = createRepository(db);

export const {
  insertForDeletedMessage,
  findByClientMessageId,
  deleteExpiredBatch,
  listExpired,
  countActiveByExpiryBucket,
  transaction
} = repository;

export { __testables };
