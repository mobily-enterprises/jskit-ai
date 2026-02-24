import * as threadsRepository from "./threads.repository.js";
import * as participantsRepository from "./participants.repository.js";
import * as messagesRepository from "./messages.repository.js";
import * as idempotencyTombstonesRepository from "./idempotencyTombstones.repository.js";
import * as attachmentsRepository from "./attachments.repository.js";
import * as reactionsRepository from "./reactions.repository.js";
import * as userSettingsRepository from "./userSettings.repository.js";
import * as blocksRepository from "./blocks.repository.js";
import * as sharedRepositoryUtils from "./shared.js";

function createRepositories() {
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

export {
  createRepositories,
  threadsRepository,
  participantsRepository,
  messagesRepository,
  idempotencyTombstonesRepository,
  attachmentsRepository,
  reactionsRepository,
  userSettingsRepository,
  blocksRepository,
  sharedRepositoryUtils
};
