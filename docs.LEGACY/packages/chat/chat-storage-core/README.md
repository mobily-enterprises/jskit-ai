# @jskit-ai/chat-storage-core

Chat attachment storage primitives for server-side code.

## What this package is for

Use this package when your app needs to:

- save uploaded chat attachments (files) to storage
- read stored attachment bytes later
- delete attachments when they are no longer needed

Today this package supports local filesystem storage (`fs`) through `unstorage`.

## Key terms (plain language)

- `storage driver`: the implementation used to store files (local disk, S3, etc.).
- `storage key`: the unique path-like key that identifies one stored file.
- `Buffer`: Node.js binary data object used for file bytes.

## Exports

- `@jskit-ai/chat-storage-core`
- `@jskit-ai/chat-storage-core/attachmentStorageService`

Public runtime API:

- `createService(options)`

`__testables` exists for tests and should not be used as app runtime API.

## Function reference

### `createService(options)`

Creates an attachment storage service.

- `options.driver`: currently supports only `"fs"`.
- `options.fsBasePath`: optional absolute/relative base directory for stored files.
- `options.rootDir`: fallback root used when `fsBasePath` is not provided.

Returns an object with methods:

- `init()`
  - Creates the base directory if it does not exist.
  - Real-life example: app startup calls this so attachment writes do not fail on first upload.
- `saveAttachment({ threadId, attachmentId, fileName, buffer })`
  - Validates IDs and buffer, sanitizes file name, writes bytes, returns `{ storageKey }`.
  - Real-life example: user uploads `invoice.pdf` in thread `42`; this method stores it and returns the key saved in DB.
- `readAttachment(storageKey)`
  - Reads bytes for a key and returns a `Buffer`, or `null` if missing.
  - Real-life example: when user downloads an attachment, API reads by key from DB row.
- `deleteAttachment(storageKey)`
  - Deletes a stored file by key; no-op for empty keys.
  - Real-life example: when a message/attachment is deleted by retention policy.

## Practical usage example

```js
import { createService as createAttachmentStorageService } from "@jskit-ai/chat-storage-core";

const storage = createAttachmentStorageService({
  driver: "fs",
  rootDir: process.cwd()
});

await storage.init();

const { storageKey } = await storage.saveAttachment({
  threadId: 42,
  attachmentId: 1001,
  fileName: "project-plan.pdf",
  buffer: uploadedBuffer
});

const fileBytes = await storage.readAttachment(storageKey);
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`

Why:

- attachment storage logic is centralized in one reusable service
- app code only wires config and dependencies
- behavior stays consistent across upload/download/delete flows

## Non-goals

- no database writes for attachment metadata
- no authorization checks
- no cloud storage provider abstraction yet (only local `fs` today)
