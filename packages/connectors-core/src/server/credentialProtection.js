import { CompactEncrypt, compactDecrypt } from "jose";
import { ConnectorError } from "./errors.js";

function createCredentialProtection({ keys, activeKeyId }) {
  const keyring = new Map(Object.entries(keys || {}));
  if (!keyring.has(activeKeyId) || [...keyring.values()].some((key) => !(key instanceof Uint8Array) || key.length !== 32)) {
    throw new TypeError("Credential protection requires named 32-byte keys and an active key ID.");
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return Object.freeze({
    async seal(value, binding) {
      return new CompactEncrypt(encoder.encode(JSON.stringify({ binding, value })))
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: activeKeyId })
        .encrypt(keyring.get(activeKeyId));
    },
    async open(ciphertext, binding) {
      try {
        const { plaintext } = await compactDecrypt(ciphertext, (header) => {
          const key = keyring.get(header.kid);
          if (!key) throw new Error("Unknown key.");
          return key;
        }, { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
        const envelope = JSON.parse(decoder.decode(plaintext));
        if (envelope.binding !== binding) throw new Error("Incorrect record binding.");
        return envelope.value;
      } catch {
        throw new ConnectorError("connector_credentials_unavailable", "Stored credentials could not be opened.", { statusCode: 500 });
      }
    }
  });
}

export { createCredentialProtection };
