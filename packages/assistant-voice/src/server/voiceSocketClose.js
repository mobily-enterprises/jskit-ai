const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);

function proxyCloseCode(code) {
  const numericCode = Number(code);
  const isStandardCode = Number.isInteger(numericCode)
    && numericCode >= 1000
    && numericCode <= 1014
    && !RESERVED_CLOSE_CODES.has(numericCode);
  const isApplicationCode = Number.isInteger(numericCode)
    && numericCode >= 3000
    && numericCode <= 4999;
  return isStandardCode || isApplicationCode ? numericCode : 1000;
}

function proxyCloseReason(reason) {
  const encoded = Buffer.from(String(reason || ""), "utf8");
  return encoded.byteLength <= 123
    ? encoded.toString("utf8")
    : encoded.subarray(0, 120).toString("utf8");
}

function normalizeVoiceCloseMetadata(code, reason) {
  return Object.freeze({
    code: proxyCloseCode(code),
    reason: proxyCloseReason(reason)
  });
}

export {
  normalizeVoiceCloseMetadata
};
