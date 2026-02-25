import * as threadsRepositoryModule from "./threads.repository.js";
import * as participantsRepositoryModule from "./participants.repository.js";
import * as messagesRepositoryModule from "./messages.repository.js";
import * as idempotencyTombstonesRepositoryModule from "./idempotencyTombstones.repository.js";
import * as attachmentsRepositoryModule from "./attachments.repository.js";
import * as reactionsRepositoryModule from "./reactions.repository.js";
import * as userSettingsRepositoryModule from "./userSettings.repository.js";
import * as blocksRepositoryModule from "./blocks.repository.js";

const threadsRepository = { ...threadsRepositoryModule };
delete threadsRepository.__testables;
const participantsRepository = { ...participantsRepositoryModule };
delete participantsRepository.__testables;
const messagesRepository = { ...messagesRepositoryModule };
delete messagesRepository.__testables;
const idempotencyTombstonesRepository = { ...idempotencyTombstonesRepositoryModule };
delete idempotencyTombstonesRepository.__testables;
const attachmentsRepository = { ...attachmentsRepositoryModule };
delete attachmentsRepository.__testables;
const reactionsRepository = { ...reactionsRepositoryModule };
delete reactionsRepository.__testables;
const userSettingsRepository = { ...userSettingsRepositoryModule };
delete userSettingsRepository.__testables;
const blocksRepository = { ...blocksRepositoryModule };
delete blocksRepository.__testables;

function createRepository() {
  return {
    threadsRepository,
    participantsRepository,
    messagesRepository,
    idempotencyTombstonesRepository,
    attachmentsRepository,
    reactionsRepository,
    userSettingsRepository,
    blocksRepository
  };
}

export { createRepository };
