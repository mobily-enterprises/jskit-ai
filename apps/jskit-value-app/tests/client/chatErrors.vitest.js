import { describe, expect, it } from "vitest";
import { mapChatError } from "@jskit-ai/chat-contracts/client";

describe("mapChatError", () => {
  it("maps known chat attachment error codes to deterministic copy", () => {
    expect(
      mapChatError({
        details: {
          code: "CHAT_ATTACHMENT_NOT_FOUND"
        }
      }).message
    ).toBe("Attachment is unavailable.");

    expect(
      mapChatError({
        details: {
          code: "CHAT_ATTACHMENT_CONFLICT"
        }
      }).message
    ).toBe("Attachment state changed. Try uploading again.");

    expect(
      mapChatError({
        details: {
          code: "CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS"
        }
      }).message
    ).toBe("Upload already in progress for this attachment.");
  });

  it("prefers field error summaries over error-code messages", () => {
    const mapped = mapChatError({
      fieldErrors: {
        file: "File too large.",
        mimeType: "Unsupported mime type."
      },
      details: {
        code: "CHAT_ATTACHMENT_CONFLICT"
      }
    });

    expect(mapped.message).toBe("File too large. Unsupported mime type.");
    expect(mapped.errorCode).toBe("CHAT_ATTACHMENT_CONFLICT");
    expect(mapped.fieldErrorSummary).toBe("File too large. Unsupported mime type.");
  });

  it("falls back to explicit error message and then fallback copy", () => {
    expect(
      mapChatError({
        message: "Custom failure."
      }).message
    ).toBe("Custom failure.");

    expect(
      mapChatError(
        {
          details: {
            code: "CHAT_UNKNOWN"
          }
        },
        "Fallback failure."
      ).message
    ).toBe("Fallback failure.");
  });
});
