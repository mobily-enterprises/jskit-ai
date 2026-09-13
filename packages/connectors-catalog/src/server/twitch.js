import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { twitchDefinition } from "../shared/twitch.js";
import { jsonOperation } from "./jsonOperation.js";
import { createSchema } from "json-rest-schema";

const validationUrl = "https://id.twitch.tv/oauth2/validate";
const userId = (value) => typeof value === "string" && /^[1-9]\d*$/u.test(value);
const scopeList = (value) => Array.isArray(value) && value.every((scope) => typeof scope === "string" && /^[^\s]+$/u.test(scope));
const validToken = (value) => typeof value?.client_id === "string" && value.client_id.length > 0 &&
  userId(value.user_id) && typeof value.login === "string" && value.login.length > 0 &&
  scopeList(value.scopes) && Number.isSafeInteger(value.expires_in) && value.expires_in > 0;
const idField = { type: "string", validator: value => userId(value) || "Enter a numeric Twitch ID." };
const pageFields = { first: { type: "integer", min: 1, max: 100, defaultTo: 20 }, after: { type: "string", minLength: 1, maxLength: 4096 } };
const opaqueId = { type: "string", required: true, minLength: 1, maxLength: 100 };
const eventTypes = {
  "stream.online": ["1", []], "stream.offline": ["1", []], "channel.update": ["2", []],
  "channel.subscribe": ["1", ["channel:read:subscriptions"]],
  "channel.cheer": ["1", ["bits:read"]],
  ...Object.fromEntries(["begin", "progress", "end"].map(phase => [`channel.poll.${phase}`, ["1", ["channel:read:polls", "channel:manage:polls"]]])),
  ...Object.fromEntries(["begin", "progress", "lock", "end"].map(phase => [`channel.prediction.${phase}`, ["1", ["channel:read:predictions", "channel:manage:predictions"]]])),
  ...Object.fromEntries(["add", "update"].map(phase => [`channel.channel_points_custom_reward_redemption.${phase}`, ["1", ["channel:read:redemptions", "channel:manage:redemptions"]]]))
};
const eventSubscriptions = value => Array.isArray(value?.data) && value.data.every(item => typeof item?.id === "string" &&
  typeof item.type === "string" && typeof item.status === "string" && item.transport?.method === "websocket");
const choiceList = max => ({ type: "array", required: true,
  items: { type: "object", schema: createSchema({ title: { type: "string", required: true, minLength: 1, maxLength: 25 } }) },
  validator: values => values.length >= 2 && values.length <= max || `Use between two and ${max} choices.` });
const interactionResult = value => Array.isArray(value?.data) && value.data.every(item =>
  typeof item?.id === "string" && userId(item.broadcaster_id) && typeof item.status === "string");
function helixOperation(path, fields, scopes, validateResult, method = "GET", checkInput) {
  const operation = jsonOperation(`https://api.twitch.tv/helix/${path}`, fields, validateResult, method === "GET" ? "GET" : "POST");
  return { ...operation, scopes, request(input) {
    const request = operation.request(input);
    checkInput?.(request.body);
    return { ...request, method };
  } };
}
const page = (value, record) => Array.isArray(value?.data) && value.data.every(record) &&
  value.pagination && typeof value.pagination === "object" && !Array.isArray(value.pagination) &&
  (value.pagination.cursor === undefined || typeof value.pagination.cursor === "string");
function analyticsOperation(kind, identity) {
  const date = { type: "string", validator: value => /^\d{4}-\d{2}-\d{2}T00:00:00Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace("Z", ".000Z") || "Enter a real UTC date at midnight, YYYY-MM-DDT00:00:00Z." };
  const operation = helixOperation(`analytics/${kind}`, {
    ...pageFields, [identity]: { ...opaqueId, required: false },
    type: { type: "string", enum: ["overview_v2"], defaultTo: "overview_v2" },
    started_at: date, ended_at: date
  }, [`analytics:read:${kind}`], value => page(value, item => {
    if (typeof item?.[identity] !== "string" || !item[identity] || item.type !== "overview_v2" ||
      typeof item.date_range?.started_at !== "string" || typeof item.date_range?.ended_at !== "string") return false;
    try { const url = new URL(item.URL); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  }));
  return { ...operation, request(input) {
    const request = operation.request(input);
    const query = new URL(request.url).searchParams;
    const start = query.get("started_at"), end = query.get("ended_at");
    if (Boolean(start) !== Boolean(end) || (start && start > end)) {
      throw new ConnectorError("connector_input_invalid", "Supply both report dates, with the end on or after the start.", { statusCode: 422 });
    }
    return request;
  } };
}
const broadcastUpdate = jsonOperation("https://api.twitch.tv/helix/channels", {
  title: { type: "string", noTrim: true, minLength: 1, maxLength: 140 },
  game_id: { type: "string", pattern: "^[0-9]*$", maxLength: 30 },
  broadcaster_language: { type: "string", pattern: "^([a-z]{2}|other)$" },
  tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 25, validator: value => /^[\p{L}\p{N}]+$/u.test(value) || "Use letters and numbers in tags." }, validator: values => values.length <= 10 || "Use at most ten tags." },
  is_branded_content: { type: "boolean" }
}, value => value === null, "POST");
const clipCreation = jsonOperation("https://api.twitch.tv/helix/clips", {
  broadcaster_id: { ...idField, required: true }
}, value => Array.isArray(value?.data) && value.data.length === 1 && typeof value.data[0]?.id === "string" &&
  value.data[0].id.length > 0 && typeof value.data[0].edit_url === "string" &&
  /^https:\/\/(?:www\.twitch\.tv|clips\.twitch\.tv)\//u.test(value.data[0].edit_url));
const rewardFields = {
  title: { type: "string", minLength: 1, maxLength: 45 }, cost: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER },
  prompt: { type: "string", maxLength: 200 }, is_enabled: { type: "boolean" },
  is_user_input_required: { type: "boolean" }, background_color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
  is_max_per_stream_enabled: { type: "boolean" }, max_per_stream: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER },
  is_max_per_user_per_stream_enabled: { type: "boolean" }, max_per_user_per_stream: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER },
  is_global_cooldown_enabled: { type: "boolean" }, global_cooldown_seconds: { type: "integer", min: 1, max: 604800 },
  should_redemptions_skip_request_queue: { type: "boolean" }
};
const rewardResult = value => Array.isArray(value?.data) && value.data.every(item =>
  typeof item?.id === "string" && userId(item.broadcaster_id) && typeof item.title === "string" && Number.isSafeInteger(item.cost) && item.cost > 0);
const scheduleTime = { type: "string", maxLength: 40, validator: value =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19) || "Enter a real UTC RFC3339 timestamp." };
const scheduleFields = {
  start_time: scheduleTime, duration: { type: "integer", min: 30, max: 1380 },
  timezone: { type: "string", maxLength: 100, validator: value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Enter an IANA timezone such as Australia/Perth."; }
  } },
  title: { type: "string", maxLength: 140 }, category_id: idField
};
const scheduleResult = value => userId(value?.data?.broadcaster_id) && Array.isArray(value.data.segments) &&
  value.data.segments.every(item => typeof item?.id === "string" && typeof item.start_time === "string" && typeof item.end_time === "string");
const vacationSettings = jsonOperation("https://api.twitch.tv/helix/schedule/settings", {
  is_vacation_enabled: { type: "boolean", required: true }, vacation_start_time: scheduleTime,
  vacation_end_time: scheduleTime, timezone: scheduleFields.timezone
}, value => value === null);
function scheduleWrite(fields, method) {
  const operation = helixOperation("schedule/segment", fields, ["channel:manage:schedule"], method === "DELETE" ? value => value === null : scheduleResult, method);
  return { ...operation, request(input) {
    const request = operation.request(input);
    const url = new URL(request.url);
    if (request.body.id) { url.searchParams.set("id", request.body.id); delete request.body.id; }
    if (method === "PATCH" && !Object.keys(request.body).length) throw new ConnectorError("connector_input_invalid", "Supply at least one schedule change.", { statusCode: 422 });
    if (request.body.duration !== undefined) request.body.duration = String(request.body.duration);
    return { ...request, url: url.href, body: method === "DELETE" ? undefined : request.body };
  } };
}
function rewardWrite(path, fields, method, queryNames, validateResult) {
  const operation = helixOperation(`channel_points/custom_rewards${path}`, fields, ["channel:manage:redemptions"], validateResult, method);
  return { ...operation, request(input) {
    const request = operation.request(input);
    const url = new URL(request.url);
    for (const [enabled, amount] of [["is_max_per_stream_enabled", "max_per_stream"],
      ["is_max_per_user_per_stream_enabled", "max_per_user_per_stream"], ["is_global_cooldown_enabled", "global_cooldown_seconds"]]) {
      if (request.body[enabled] === true && request.body[amount] === undefined) {
        throw new ConnectorError("connector_input_invalid", `Supply ${amount} when enabling this reward limit.`, { statusCode: 422 });
      }
    }
    for (const name of queryNames) { url.searchParams.set(name, request.body[name]); delete request.body[name]; }
    if (method === "PATCH" && Object.keys(request.body).length === 0) throw new ConnectorError("connector_input_invalid", "Supply at least one reward change.", { statusCode: 422 });
    return { ...request, url: url.href, body: method === "DELETE" ? undefined : request.body };
  } };
}

async function normalizeTokenResponse(response) {
  const failure = {
    401: ["connector_reconnect_required", "Connect this Twitch account again."],
    403: ["connector_permission_denied", "Twitch denied the token request."],
    429: ["connector_rate_limited", "Twitch's request limit was reached."]
  }[response.status];
  if (failure) throw new ConnectorError(...failure, { statusCode: response.status });
  let value;
  try { value = await response.clone().json(); } catch {
    if (!response.ok) return response;
    throw new ConnectorError("connector_response_invalid", "Twitch returned an invalid token response.", { statusCode: 502 });
  }
  if (!response.ok) {
    if (response.status === 400 && value?.message === "Invalid refresh token") {
      throw new ConnectorError("connector_reconnect_required", "Connect this Twitch account again.", { statusCode: 401 });
    }
    return response;
  }
  if (typeof value?.scope === "string" && (value.scope === "" || /^[^\s]+(?: [^\s]+)*$/u.test(value.scope))) return response;
  if (!scopeList(value?.scope)) {
    throw new ConnectorError("connector_response_invalid", "Twitch returned an invalid permission grant.", { statusCode: 502 });
  }
  return Response.json({ ...value, scope: value.scope.join(" ") }, { status: response.status });
}

const twitchProvider = Object.freeze({
  ...twitchDefinition,
  oauth: {
    issuer: "https://id.twitch.tv/oauth2",
    authorization_endpoint: "https://id.twitch.tv/oauth2/authorize",
    token_endpoint: "https://id.twitch.tv/oauth2/token"
  },
  normalizeTokenResponse,
  oauthHeaders: ({ clientId }) => ({ "Client-Id": clientId }),
  apiOrigins: ["https://id.twitch.tv", "https://api.twitch.tv"],
  checkOperation: "token.validate",
  grantedScopesFromVerification: (value) => value.scopes,
  async exchange(address, options, { request }) {
    const url = new URL(address);
    const permissions = {
      "GET /helix/users": "user:read:email", "GET /helix/channels/followed": "user:read:follows",
      "GET /helix/streams": null, "GET /helix/channels": null, "GET /helix/search/channels": null,
      "PATCH /helix/channels": "channel:manage:broadcast",
      "GET /helix/polls": ["channel:read:polls", "channel:manage:polls"],
      "POST /helix/polls": "channel:manage:polls", "PATCH /helix/polls": "channel:manage:polls",
      "GET /helix/predictions": ["channel:read:predictions", "channel:manage:predictions"],
      "POST /helix/predictions": "channel:manage:predictions", "PATCH /helix/predictions": "channel:manage:predictions",
      "POST /helix/chat/messages": "user:write:chat",
      "GET /helix/subscriptions": "channel:read:subscriptions",
      "GET /helix/subscriptions/user": "user:read:subscriptions",
      "GET /helix/channels/vips": "channel:read:vips", "GET /helix/channels/editors": "channel:read:editors",
      "GET /helix/moderation/banned": "moderation:read", "GET /helix/moderation/moderators": "moderation:read",
      "GET /helix/channels/followers": "moderator:read:followers", "GET /helix/chat/chatters": "moderator:read:chatters",
      "GET /helix/hypetrain/status": "channel:read:hype_train",
      "GET /helix/bits/leaderboard": "bits:read",
      "GET /helix/analytics/extensions": "analytics:read:extensions",
      "GET /helix/analytics/games": "analytics:read:games",
      "POST /helix/clips": "clips:edit", "GET /helix/clips": null,
      "GET /helix/channel_points/custom_rewards": ["channel:read:redemptions", "channel:manage:redemptions"],
      "POST /helix/channel_points/custom_rewards": "channel:manage:redemptions",
      "PATCH /helix/channel_points/custom_rewards": "channel:manage:redemptions",
      "DELETE /helix/channel_points/custom_rewards": "channel:manage:redemptions",
      "GET /helix/channel_points/custom_rewards/redemptions": ["channel:read:redemptions", "channel:manage:redemptions"],
      "PATCH /helix/channel_points/custom_rewards/redemptions": "channel:manage:redemptions",
      "GET /helix/schedule": null, "POST /helix/schedule/segment": "channel:manage:schedule",
      "PATCH /helix/schedule/segment": "channel:manage:schedule", "DELETE /helix/schedule/segment": "channel:manage:schedule",
      "PATCH /helix/schedule/settings": "channel:manage:schedule",
      "POST /helix/eventsub/subscriptions": null, "GET /helix/eventsub/subscriptions": null,
      "DELETE /helix/eventsub/subscriptions": null
    };
    const operation = `${options.method} ${url.pathname}`;
    if (!(url.href === validationUrl && options.method === "GET") &&
      (url.origin !== "https://api.twitch.tv" || !Object.hasOwn(permissions, operation))) {
      throw new ConnectorError("connector_destination_invalid", "This Twitch operation has an invalid destination.");
    }
    const validation = await request(validationUrl, { ...options, method: "GET", body: undefined });
    if (!validToken(validation)) {
      throw new ConnectorError("connector_response_invalid", "Twitch returned an invalid user-token validation.", { statusCode: 502 });
    }
    if (validation.client_id !== new Headers(options.headers).get("Client-Id")) {
      throw new ConnectorError("connector_reconnect_required", "The Twitch token belongs to a different application.", { statusCode: 401 });
    }
    if (url.href === validationUrl) return validation;
    const requiredScope = permissions[operation];
    if (requiredScope && ![requiredScope].flat().some(scope => validation.scopes.includes(scope))) {
      throw new ConnectorError("connector_reconnect_required", "Connect Twitch again with the permission needed for this operation.", { statusCode: 401 });
    }
    if (operation === "POST /helix/eventsub/subscriptions") {
      const [version, scopes] = eventTypes[options.body.type];
      if (scopes.length && !scopes.some(scope => validation.scopes.includes(scope))) {
        throw new ConnectorError("connector_reconnect_required", "Connect Twitch again with permission for this event.", { statusCode: 401 });
      }
      options = { ...options, body: { type: options.body.type, version,
        condition: { broadcaster_user_id: validation.user_id },
        transport: { method: "websocket", session_id: options.body.session_id } } };
    }
    if (url.pathname === "/helix/channels/followed") url.searchParams.set("user_id", validation.user_id);
    if (operation === "PATCH /helix/channels") url.searchParams.set("broadcaster_id", validation.user_id);
    if (["/helix/polls", "/helix/predictions"].includes(url.pathname)) {
      if (options.method === "GET") url.searchParams.set("broadcaster_id", validation.user_id);
      else options = { ...options, body: { ...options.body, broadcaster_id: validation.user_id } };
    }
    if (operation === "POST /helix/chat/messages") options = { ...options, body: { ...options.body, sender_id: validation.user_id } };
    if (url.pathname.startsWith("/helix/channel_points/custom_rewards")) url.searchParams.set("broadcaster_id", validation.user_id);
    if (["/helix/schedule/segment", "/helix/schedule/settings"].includes(url.pathname)) url.searchParams.set("broadcaster_id", validation.user_id);
    if (["/helix/subscriptions", "/helix/channels/vips", "/helix/channels/editors", "/helix/moderation/banned", "/helix/moderation/moderators", "/helix/hypetrain/status"].includes(url.pathname)) url.searchParams.set("broadcaster_id", validation.user_id);
    if (url.pathname === "/helix/subscriptions/user") url.searchParams.set("user_id", validation.user_id);
    if (url.pathname === "/helix/chat/chatters") url.searchParams.set("moderator_id", validation.user_id);
    if (url.pathname === "/helix/channels/followers" && !url.searchParams.has("broadcaster_id")) url.searchParams.set("broadcaster_id", validation.user_id);
    const result = await request(url.href, options);
    if (url.pathname === "/helix/users" && result?.data?.[0]?.id !== validation.user_id) {
      throw new ConnectorError("connector_response_invalid", "Twitch returned a profile for a different user.", { statusCode: 502 });
    }
    return result;
  },
  operations: {
    "events.subscribe": helixOperation("eventsub/subscriptions", {
      type: { type: "string", required: true, enum: Object.keys(eventTypes) }, session_id: opaqueId
    }, [], eventSubscriptions, "POST"),
    "events.list": helixOperation("eventsub/subscriptions", { after: pageFields.after,
      type: { type: "string", enum: Object.keys(eventTypes) }
    }, [], value => eventSubscriptions(value) && page(value, () => true)),
    "events.delete": { ...helixOperation("eventsub/subscriptions", { id: opaqueId }, [], value => value === null), request(input) {
      const operation = jsonOperation("https://api.twitch.tv/helix/eventsub/subscriptions", { id: opaqueId }, value => value === null);
      return { ...operation.request(input), method: "DELETE" };
    } },
    "schedule.vacation": { ...vacationSettings, scopes: ["channel:manage:schedule"], request(input) {
      const request = vacationSettings.request(input);
      const query = new URL(request.url).searchParams;
      if (query.get("is_vacation_enabled") === "true" && (!query.has("timezone") || !query.has("vacation_start_time") || !query.has("vacation_end_time") ||
        Date.parse(query.get("vacation_end_time")) <= Date.parse(query.get("vacation_start_time")))) {
        throw new ConnectorError("connector_input_invalid", "Enabling vacation requires a timezone and an end after the start.", { statusCode: 422 });
      }
      return { ...request, method: "PATCH" };
    } },
    "schedule.get": helixOperation("schedule", { broadcaster_id: { ...idField, required: true }, id: { ...opaqueId, required: false }, start_time: scheduleTime,
      ...pageFields, first: { type: "integer", min: 1, max: 25, defaultTo: 20 }
    }, [], scheduleResult),
    "schedule.create": scheduleWrite({ ...scheduleFields, start_time: { ...scheduleFields.start_time, required: true },
      timezone: { ...scheduleFields.timezone, required: true }, duration: { ...scheduleFields.duration, required: true },
      is_recurring: { type: "boolean", required: true }
    }, "POST"),
    "schedule.update": scheduleWrite({ id: opaqueId, ...scheduleFields, is_canceled: { type: "boolean" } }, "PATCH"),
    "schedule.delete": scheduleWrite({ id: opaqueId }, "DELETE"),
    "rewards.list": helixOperation("channel_points/custom_rewards", { id: { ...opaqueId, required: false }, only_manageable_rewards: { type: "boolean", defaultTo: false } }, ["channel:read:redemptions", "channel:manage:redemptions"], rewardResult),
    "rewards.create": rewardWrite("", { ...rewardFields, title: { ...rewardFields.title, required: true }, cost: { ...rewardFields.cost, required: true } }, "POST", [], rewardResult),
    "rewards.update": rewardWrite("", { id: opaqueId, ...rewardFields, is_paused: { type: "boolean" } }, "PATCH", ["id"], rewardResult),
    "rewards.delete": rewardWrite("", { id: opaqueId }, "DELETE", ["id"], value => value === null),
    "redemptions.list": helixOperation("channel_points/custom_rewards/redemptions", {
      reward_id: opaqueId, id: { ...opaqueId, required: false },
      status: { type: "string", enum: ["UNFULFILLED", "FULFILLED", "CANCELED"], defaultTo: "UNFULFILLED" },
      sort: { type: "string", enum: ["OLDEST", "NEWEST"], defaultTo: "OLDEST" },
      ...pageFields, first: { type: "integer", min: 1, max: 50, defaultTo: 20 }
    }, ["channel:read:redemptions", "channel:manage:redemptions"], value => page(value, item =>
      typeof item?.id === "string" && userId(item.broadcaster_id) && userId(item.user_id) && ["UNFULFILLED", "FULFILLED", "CANCELED"].includes(item.status))),
    "redemptions.update": rewardWrite("/redemptions", { reward_id: opaqueId, id: opaqueId,
      status: { type: "string", required: true, enum: ["FULFILLED", "CANCELED"] }
    }, "PATCH", ["reward_id", "id"], interactionResult),
    "clips.create": { ...clipCreation, scopes: ["clips:edit"], request(input) {
      return { ...clipCreation.request(input), method: "POST" };
    } },
    "clips.get": helixOperation("clips", { id: opaqueId }, [], value => Array.isArray(value?.data) && value.data.every(item =>
      typeof item?.id === "string" && userId(item.broadcaster_id) && typeof item.url === "string" && typeof item.title === "string")),
    "analytics.extensions": analyticsOperation("extensions", "extension_id"),
    "analytics.games": analyticsOperation("games", "game_id"),
    "bits.leaderboard": helixOperation("bits/leaderboard", {
      count: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      period: { type: "string", enum: ["day", "week", "month", "year", "all"], defaultTo: "all" },
      started_at: { type: "string", maxLength: 40, validator: value =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)) || "Enter an RFC3339 timestamp." },
      user_id: idField
    }, ["bits:read"], value => Array.isArray(value?.data) && value.data.every(item =>
      userId(item?.user_id) && Number.isSafeInteger(item.rank) && item.rank > 0 && Number.isSafeInteger(item.score) && item.score >= 0) &&
      Number.isSafeInteger(value.total) && value.total >= 0 && typeof value.date_range?.started_at === "string" && typeof value.date_range?.ended_at === "string"),
    "subscriptions.list": helixOperation("subscriptions", { ...pageFields, user_id: idField }, ["channel:read:subscriptions"], value => page(value, item => userId(item?.user_id) && typeof item.tier === "string")),
    "subscriptions.check": helixOperation("subscriptions/user", { broadcaster_id: { ...idField, required: true } }, ["user:read:subscriptions"], value => Array.isArray(value?.data) && value.data.every(item => userId(item?.broadcaster_id) && typeof item.tier === "string")),
    "vips.list": helixOperation("channels/vips", { ...pageFields, user_id: idField }, ["channel:read:vips"], value => page(value, item => userId(item?.user_id))),
    "editors.list": helixOperation("channels/editors", {}, ["channel:read:editors"], value => Array.isArray(value?.data) && value.data.every(item => userId(item?.user_id))),
    "bannedUsers.list": helixOperation("moderation/banned", { ...pageFields, user_id: idField }, ["moderation:read"], value => page(value, item => userId(item?.user_id))),
    "moderators.list": helixOperation("moderation/moderators", { ...pageFields, user_id: idField }, ["moderation:read"], value => page(value, item => userId(item?.user_id))),
    "followers.list": helixOperation("channels/followers", { ...pageFields, broadcaster_id: idField, user_id: idField }, ["moderator:read:followers"], value => page(value, item => userId(item?.user_id)) && Number.isSafeInteger(value.total) && value.total >= 0),
    "chatters.list": helixOperation("chat/chatters", { ...pageFields, broadcaster_id: { ...idField, required: true } }, ["moderator:read:chatters"], value => page(value, item => userId(item?.user_id)) && Number.isSafeInteger(value.total) && value.total >= 0),
    "hypeTrain.status": helixOperation("hypetrain/status", {}, ["channel:read:hype_train"], value => Array.isArray(value?.data) && value.data.length === 1 &&
      (value.data[0]?.current === null || typeof value.data[0]?.current?.id === "string")),
    "polls.list": helixOperation("polls", { ...pageFields, first: { type: "integer", min: 1, max: 20, defaultTo: 20 }, id: { ...opaqueId, required: false } }, ["channel:read:polls", "channel:manage:polls"], interactionResult),
    "polls.create": helixOperation("polls", {
      title: { type: "string", required: true, minLength: 1, maxLength: 60 }, choices: choiceList(5),
      duration: { type: "integer", required: true, min: 15, max: 1800 }
    }, ["channel:manage:polls"], interactionResult, "POST"),
    "polls.end": helixOperation("polls", { id: opaqueId, status: { type: "string", required: true, enum: ["TERMINATED", "ARCHIVED"] } }, ["channel:manage:polls"], interactionResult, "PATCH"),
    "predictions.list": helixOperation("predictions", { ...pageFields, first: { type: "integer", min: 1, max: 20, defaultTo: 20 }, id: { ...opaqueId, required: false } }, ["channel:read:predictions", "channel:manage:predictions"], interactionResult),
    "predictions.create": helixOperation("predictions", {
      title: { type: "string", required: true, minLength: 1, maxLength: 45 }, outcomes: choiceList(10),
      prediction_window: { type: "integer", required: true, min: 30, max: 1800 }
    }, ["channel:manage:predictions"], interactionResult, "POST"),
    "predictions.end": helixOperation("predictions", { id: opaqueId,
      status: { type: "string", required: true, enum: ["LOCKED", "CANCELED", "RESOLVED"] }, winning_outcome_id: { ...opaqueId, required: false }
    }, ["channel:manage:predictions"], interactionResult, "PATCH", values => {
      if ((values.status === "RESOLVED") !== Boolean(values.winning_outcome_id)) throw new ConnectorError("connector_input_invalid", "Supply a winning outcome only when resolving the prediction.", { statusCode: 422 });
    }),
    "chat.send": helixOperation("chat/messages", { broadcaster_id: { ...idField, required: true },
      message: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 500 }, reply_parent_message_id: { ...opaqueId, required: false }
    }, ["user:write:chat"], value => Array.isArray(value?.data) && value.data.length === 1 &&
      typeof value.data[0]?.message_id === "string" && typeof value.data[0].is_sent === "boolean", "POST"),
    "streams.list": jsonOperation("https://api.twitch.tv/helix/streams", {
      ...pageFields, user_id: idField, game_id: idField,
      user_login: { type: "string", minLength: 1, maxLength: 25, pattern: "^[A-Za-z0-9_]+$" },
      language: { type: "string", pattern: "^([a-z]{2}|other)$" }, type: { type: "string", enum: ["all", "live"], defaultTo: "all" }
    }, value => page(value, stream => userId(stream?.id) && userId(stream.user_id) &&
      typeof stream.title === "string" && Number.isSafeInteger(stream.viewer_count) && stream.viewer_count >= 0)),
    "channels.read": jsonOperation("https://api.twitch.tv/helix/channels", { broadcaster_id: { ...idField, required: true } },
      value => Array.isArray(value?.data) && value.data.every(channel => userId(channel?.broadcaster_id) && typeof channel.title === "string")),
    "channels.search": jsonOperation("https://api.twitch.tv/helix/search/channels", {
      ...pageFields, query: { type: "string", required: true, minLength: 1, maxLength: 100 }, live_only: { type: "boolean", defaultTo: false }
    }, value => page(value, channel => userId(channel?.id) && typeof channel.display_name === "string" && typeof channel.is_live === "boolean")),
    "broadcast.update": {
      scopes: ["channel:manage:broadcast"], validateResult: broadcastUpdate.validateResult,
      request(input) {
        const request = broadcastUpdate.request(input);
        if (!Object.keys(request.body).length) throw new ConnectorError("connector_input_invalid", "Supply at least one broadcast change.", { statusCode: 422 });
        return { ...request, method: "PATCH" };
      }
    },
    "token.validate": jsonOperation(validationUrl, {}, validToken),
    "profile.read": {
      ...jsonOperation("https://api.twitch.tv/helix/users", {}, (value) => Array.isArray(value?.data) &&
        value.data.length === 1 && userId(value.data[0]?.id) && typeof value.data[0].login === "string"),
      scopes: ["user:read:email"]
    },
    "channels.followed": {
      ...jsonOperation("https://api.twitch.tv/helix/channels/followed", {
        first: { type: "integer", min: 1, max: 100, defaultTo: 20 },
        after: { type: "string", minLength: 1, maxLength: 4096 },
        broadcaster_id: { type: "string", validator: (value) => userId(value) || "Enter a Twitch broadcaster ID." }
      }, (value) => Array.isArray(value?.data) && value.data.every((channel) => userId(channel?.broadcaster_id)) &&
        Number.isSafeInteger(value.total) && value.total >= 0 && value.pagination !== null &&
        typeof value.pagination === "object" && !Array.isArray(value.pagination) &&
        (value.pagination.cursor === undefined || (typeof value.pagination.cursor === "string" && value.pagination.cursor.length > 0))),
      scopes: ["user:read:follows"]
    }
  }
});

function parseTwitchEventSubMessage(raw, { broadcasterId, sessionId, subscriptionIds = [] } = {}) {
  const invalid = () => new ConnectorError("connector_event_invalid", "Twitch returned an invalid or unexpected EventSub message.", { statusCode: 422 });
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1048576 || !userId(broadcasterId)) throw invalid();
  let message;
  try { message = JSON.parse(raw); } catch { throw invalid(); }
  const metadata = message?.metadata, payload = message?.payload;
  if (!metadata || typeof metadata.message_id !== "string" || !metadata.message_id || metadata.message_id.length > 256 ||
    typeof metadata.message_timestamp !== "string" || !Number.isFinite(Date.parse(metadata.message_timestamp)) ||
    !payload || typeof payload !== "object" || Array.isArray(payload)) throw invalid();
  const type = metadata.message_type;
  if (type === "session_welcome" || type === "session_reconnect") {
    const session = payload.session;
    if (!session || typeof session.id !== "string" || !session.id || session.id.length > 256) throw invalid();
    if (type === "session_welcome") {
      if (session.status !== "connected" || !Number.isSafeInteger(session.keepalive_timeout_seconds) || session.keepalive_timeout_seconds < 1) throw invalid();
    } else {
      if (session.id !== sessionId || session.status !== "reconnecting") throw invalid();
      let url;
      try { url = new URL(session.reconnect_url); } catch { throw invalid(); }
      if (url.protocol !== "wss:" || url.hostname !== "eventsub.wss.twitch.tv" || url.port || url.username || url.password || url.hash) throw invalid();
    }
  } else if (type === "notification" || type === "revocation") {
    const subscription = payload.subscription;
    if (!subscription || !Array.isArray(subscriptionIds) || !subscriptionIds.includes(subscription.id) ||
      !sessionId || subscription.transport?.method !== "websocket" || subscription.transport.session_id !== sessionId ||
      subscription.condition?.broadcaster_user_id !== broadcasterId || !Object.hasOwn(eventTypes, subscription.type) ||
      subscription.version !== eventTypes[subscription.type][0] || metadata.subscription_type !== subscription.type ||
      metadata.subscription_version !== subscription.version) throw invalid();
    if (type === "notification") {
      if (subscription.status !== "enabled" || !payload.event || typeof payload.event !== "object" || Array.isArray(payload.event) ||
        payload.event.broadcaster_user_id !== broadcasterId) throw invalid();
    } else if (!["authorization_revoked", "user_removed", "version_removed"].includes(subscription.status)) throw invalid();
  } else if (type !== "session_keepalive") throw invalid();
  return message;
}

export { twitchProvider, parseTwitchEventSubMessage };
