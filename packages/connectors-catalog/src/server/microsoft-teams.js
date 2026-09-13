import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { microsoftTeamsDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider } from "./microsoft.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 1024,
  validator: value => /^[A-Za-z0-9_:@.=-]+$/u.test(value) && value !== "." && value !== ".." || "Use the returned Teams resource ID." };
const channel = { teamId: id, channelId: id };
const pageSize = { type: "integer", min: 1, max: 50, defaultTo: 25 };
const channelPath = ({ teamId, channelId }) => `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}`;
function send(scope, fields, path) {
  const schema = createSchema({ ...fields, text: { type: "string", required: true, minLength: 1, maxLength: 20000, noTrim: true } });
  return { scopes: [scope], validateResult: value => typeof value?.id === "string", request(input) {
    const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "POST", url: `https://graph.microsoft.com/v1.0${path(values)}`, body: { body: { contentType: "text", content: values.text } } };
  } };
}
const microsoftTeamsProvider = microsoftProvider(microsoftTeamsDefinition, "organizations", "teams.list", {
  "teams.list": graphRead("Team.ReadBasic.All", {}, () => ({ pathname: "/me/joinedTeams" })),
  "channels.list": graphRead("Channel.ReadBasic.All", { teamId: id }, ({ teamId }) => ({ pathname: `/teams/${encodeURIComponent(teamId)}/channels` })),
  "messages.list": graphRead("ChannelMessage.Read.All", { ...channel, pageSize }, input => ({ pathname: `${channelPath(input)}/messages`, query: { $top: input.pageSize } })),
  "replies.list": graphRead("ChannelMessage.Read.All", { ...channel, messageId: id }, input => ({ pathname: `${channelPath(input)}/messages/${encodeURIComponent(input.messageId)}/replies` })),
  "messages.send": send("ChannelMessage.Send", channel, input => `${channelPath(input)}/messages`),
  "replies.send": send("ChannelMessage.Send", { ...channel, messageId: id }, input => `${channelPath(input)}/messages/${encodeURIComponent(input.messageId)}/replies`),
  "chats.list": graphRead("Chat.ReadWrite", {}, () => ({ pathname: "/me/chats" })),
  "chatMessages.list": graphRead("Chat.ReadWrite", { chatId: id, pageSize }, ({ chatId, pageSize }) => ({ pathname: `/chats/${encodeURIComponent(chatId)}/messages`, query: { $top: pageSize } })),
  "chatMessages.send": send("Chat.ReadWrite", { chatId: id }, ({ chatId }) => `/chats/${encodeURIComponent(chatId)}/messages`)
});
export { microsoftTeamsProvider };
