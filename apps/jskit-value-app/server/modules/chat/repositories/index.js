import * as threadsRepositoryModule from "./threads.repository.js";
import * as participantsRepositoryModule from "./participants.repository.js";
import * as messagesRepositoryModule from "./messages.repository.js";
import * as idempotencyTombstonesRepositoryModule from "./idempotencyTombstones.repository.js";
import * as attachmentsRepositoryModule from "./attachments.repository.js";
import * as reactionsRepositoryModule from "./reactions.repository.js";
import * as userSettingsRepositoryModule from "./userSettings.repository.js";
import * as blocksRepositoryModule from "./blocks.repository.js";

const { __testables: _threadsTestables, ...threadsRepository } = threadsRepositoryModule;
const { __testables: _participantsTestables, ...participantsRepository } = participantsRepositoryModule;
const { __testables: _messagesTestables, ...messagesRepository } = messagesRepositoryModule;
const { __testables: _idempotencyTombstonesTestables, ...idempotencyTombstonesRepository } =
  idempotencyTombstonesRepositoryModule;
const { __testables: _attachmentsTestables, ...attachmentsRepository } = attachmentsRepositoryModule;
const { __testables: _reactionsTestables, ...reactionsRepository } = reactionsRepositoryModule;
const { __testables: _userSettingsTestables, ...userSettingsRepository } = userSettingsRepositoryModule;
const { __testables: _blocksTestables, ...blocksRepository } = blocksRepositoryModule;

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
