import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { telegramDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

function telegramResult(response, validate) {
  if (response?.ok === false) {
    const error = new Error("Telegram rejected the operation.");
    error.status = response.error_code;
    throw error;
  }
  return response?.ok === true && validate(response.result);
}

const chatIdField = { type: "string", required: true, noTrim: true,
  validator: (value) => /^-?[1-9][0-9]{0,15}$/u.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(value) || "Enter a chat ID as a decimal string or @username." };

const telegramProvider = Object.freeze({
  ...telegramDefinition, requestTimeoutMs: 30000,
  apiOrigins: ["https://api.telegram.org"],
  apiKey: { pathPrefix(key) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(key)) {
      throw new ConnectorError("connector_binding_invalid", "Configure a Telegram bot token in the referenced environment variable.");
    }
    return `/bot${key}`;
  } },
  checkOperation: "profile.read",
  operations: {
    "messages.send": jsonOperation("https://api.telegram.org/sendMessage", {
      chat_id: chatIdField,
      text: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 4096 },
      message_thread_id: { type: "integer", min: 1 },
      disable_notification: { type: "boolean", defaultTo: false },
      protect_content: { type: "boolean", defaultTo: false }
    }, (response) => telegramResult(response, (message) => Number.isSafeInteger(message?.message_id) &&
      Number.isSafeInteger(message.chat?.id) && typeof message.text === "string"), "POST"),
    "chats.action": jsonOperation("https://api.telegram.org/sendChatAction", {
      chat_id: chatIdField, message_thread_id: { type: "integer", min: 1 },
      action: { type: "string", required: true, enum: ["typing", "upload_photo", "record_video", "upload_video", "record_voice", "upload_voice", "upload_document", "choose_sticker", "find_location", "record_video_note", "upload_video_note"] }
    }, (response) => telegramResult(response, (value) => value === true), "POST"),
    "updates.poll": jsonOperation("https://api.telegram.org/getUpdates", {
      offset: { type: "integer", min: 0 },
      limit: { type: "integer", min: 1, max: 100, defaultTo: 100 },
      timeout: { type: "integer", min: 0, max: 20, defaultTo: 20 },
      allowed_updates: { type: "array", defaultTo: ["message"],
        validator: (value) => value.length > 0 && value.length <= 4 && value.every((kind) => ["message", "edited_message", "channel_post", "edited_channel_post"].includes(kind)) || "Choose supported message update types explicitly." }
    }, (response) => telegramResult(response, (updates) => Array.isArray(updates) &&
      updates.every((update) => Number.isSafeInteger(update?.update_id) && update.update_id >= 0)), "POST"),
    "profile.read": jsonOperation("https://api.telegram.org/getMe", {}, (response) => telegramResult(response,
      (bot) => Number.isSafeInteger(bot?.id) && bot.id > 0 && bot.is_bot === true && typeof bot.first_name === "string")),
    "webhook.read": jsonOperation("https://api.telegram.org/getWebhookInfo", {}, (response) => telegramResult(response,
      (webhook) => typeof webhook?.url === "string" && typeof webhook.has_custom_certificate === "boolean" &&
        Number.isInteger(webhook.pending_update_count) && webhook.pending_update_count >= 0))
  }
});
export { telegramProvider };
