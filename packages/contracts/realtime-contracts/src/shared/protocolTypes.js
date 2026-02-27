const REALTIME_MESSAGE_TYPES = Object.freeze({
  SUBSCRIBE: "subscribe",
  SUBSCRIBED: "subscribed",
  UNSUBSCRIBE: "unsubscribe",
  UNSUBSCRIBED: "unsubscribed",
  PING: "ping",
  PONG: "pong",
  EVENT: "event",
  ERROR: "error"
});

const REALTIME_ERROR_CODES = Object.freeze({
  INVALID_MESSAGE: "invalid_message",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  UNSUPPORTED_TOPIC: "unsupported_topic",
  UNSUPPORTED_SURFACE: "unsupported_surface",
  WORKSPACE_REQUIRED: "workspace_required",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  INTERNAL_ERROR: "internal_error"
});

export { REALTIME_MESSAGE_TYPES, REALTIME_ERROR_CODES };
