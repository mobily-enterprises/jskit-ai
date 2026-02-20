const REDACTION_VERSION = 1;
const REDACTED_TOKEN = "[REDACTED]";

const SECRET_PATTERNS = Object.freeze([
  {
    type: "private_key_pem",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  {
    type: "bearer_token",
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi
  },
  {
    type: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
  },
  {
    type: "openai_key",
    regex: /\b(?:sk|rk)(?:-proj)?-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    type: "aws_access_key_id",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  }
]);

const ASSIGNMENT_PATTERN =
  /\b(password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization)\s*([:=])\s*([^\s,;]+)/gi;

function redactSecrets(value) {
  const sourceText = String(value ?? "");
  if (!sourceText) {
    return {
      text: "",
      redacted: false,
      hitTypes: [],
      hitCount: 0,
      version: REDACTION_VERSION
    };
  }

  let output = sourceText;
  const hitTypeCounts = new Map();

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern.regex, () => {
      const previous = hitTypeCounts.get(pattern.type) || 0;
      hitTypeCounts.set(pattern.type, previous + 1);
      if (pattern.type === "bearer_token") {
        return "Bearer [REDACTED]";
      }

      return REDACTED_TOKEN;
    });
  }

  output = output.replace(ASSIGNMENT_PATTERN, (_match, key, separator) => {
    const previous = hitTypeCounts.get("credential_assignment") || 0;
    hitTypeCounts.set("credential_assignment", previous + 1);
    return `${key}${separator}${REDACTED_TOKEN}`;
  });

  const hitTypes = [...hitTypeCounts.keys()].sort();
  const hitCount = [...hitTypeCounts.values()].reduce((sum, count) => sum + Number(count || 0), 0);

  return {
    text: output,
    redacted: hitCount > 0,
    hitTypes,
    hitCount,
    version: REDACTION_VERSION
  };
}

const __testables = {
  REDACTION_VERSION,
  REDACTED_TOKEN,
  SECRET_PATTERNS,
  ASSIGNMENT_PATTERN
};

export { REDACTION_VERSION, redactSecrets, __testables };
