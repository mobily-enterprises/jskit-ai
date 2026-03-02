const REDIS_NAMESPACE_MAX_LENGTH = 96;
const REDIS_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9:_-]{0,94}[a-z0-9])?$/;
const REDIS_KEY_SEGMENT_MAX_LENGTH = 192;
const REDIS_KEY_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9:._-]{0,190}[a-z0-9])?$/;

function normalizeRedisNamespace(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error("REDIS_NAMESPACE is required.");
  }
  if (normalized.length > REDIS_NAMESPACE_MAX_LENGTH) {
    throw new Error(`REDIS_NAMESPACE must be at most ${REDIS_NAMESPACE_MAX_LENGTH} characters.`);
  }
  if (!REDIS_NAMESPACE_PATTERN.test(normalized)) {
    throw new Error(
      "REDIS_NAMESPACE must use only lowercase letters, digits, colons, hyphens, and underscores."
    );
  }

  return normalized;
}

function normalizeRedisKeySegment(value, { label = "Redis key segment" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > REDIS_KEY_SEGMENT_MAX_LENGTH) {
    throw new Error(`${label} must be at most ${REDIS_KEY_SEGMENT_MAX_LENGTH} characters.`);
  }
  if (!REDIS_KEY_SEGMENT_PATTERN.test(normalized)) {
    throw new Error(`${label} must use only lowercase letters, digits, colons, dots, hyphens, and underscores.`);
  }

  return normalized;
}

function buildRedisScopedKey(redisNamespace, segment, options = {}) {
  const normalizedNamespace = normalizeRedisNamespace(redisNamespace);
  const normalizedSegment = normalizeRedisKeySegment(segment, options);
  return `${normalizedNamespace}:${normalizedSegment}`;
}

const __testables = {
  REDIS_NAMESPACE_MAX_LENGTH,
  REDIS_NAMESPACE_PATTERN,
  REDIS_KEY_SEGMENT_MAX_LENGTH,
  REDIS_KEY_SEGMENT_PATTERN,
  normalizeRedisKeySegment
};

export { normalizeRedisNamespace, buildRedisScopedKey, __testables };
