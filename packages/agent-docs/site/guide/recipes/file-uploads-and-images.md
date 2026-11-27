---
title: "Recipe: file uploads and images"
description: Let people attach photos and files to records in a JSKIT app, edited and compressed in the browser, stored through runtime.storage and served only to people allowed to see them.
---

# Let people add photos and files to `<APP_NAME>`

People attach photos and files to the records they work on. A photo is cropped
and compressed in the browser before it uploads; every file is checked by its
real bytes and size, stored in the app's storage (a folder on one server, a
bucket when there are several), shown or downloaded only by people allowed to
see its record, and removed with it. Every refusal says what was wrong.

## When to propose it

- "Upload photos", "attach files", "add documents", "receipts", "a picture
  for each product".
- "Profile pictures" beyond the account's avatar, "a gallery".
- "Where do the files go when we have two servers?"

## How to answer the person

Propose the simple way first: "People pick a photo or file on the record; a
photo can be cropped and is made smaller before it uploads. The files live in
the app's own storage, a folder on the server today and a storage bucket once
the app runs on more than one server, and only people who can see the record
can open them."

Then say: "There are other options if you want to discuss." They are uploads
straight from the browser to a bucket with short-lived signed addresses for
very large files (app-owned; JSKIT has no piece for it), an image service or
CDN that makes sizes on the fly, and video, which needs its own processing.

## Product decisions (defaults)

- What attaches to what: files on the app's main record; photos only
  (JPEG, PNG, WebP) unless documents are asked for, then PDF too.
- Size: 5 MB a photo (`DEFAULT_IMAGE_UPLOAD_MAX_BYTES`), 10 MB a document;
  at most 10 files a record.
- Who sees: whoever may see the record; who deletes: its author and those who
  may edit the record.
- Photos are edited (crop, rotate) and compressed before upload.
- A file goes when its record goes.

## Make a careful saved plan first

Write a careful saved plan first, then implement it item by item, proving each
one:

1. Choose the storage driver per environment: `fs` on one server, `s3` where
   copies run on more than one.
2. Add an attachments table resource holding each file's storage key and
   facts, never its bytes.
3. Add the upload route and its action: read the multipart file, check its
   size and real type, save it under a key the server makes, write the row.
4. Add the read route that checks access before sending the bytes, and the
   delete action; remove files with their record.
5. Add the upload control: the image runtime for photos, a file input for
   documents.
6. Word every refusal (too large, wrong type, too many) and the empty state.

## Technical details

- **Storage:** `@jskit-ai/storage-runtime` provides `runtime.storage`; the
  driver is `JSKIT_STORAGE_DRIVER` (`fs` by default, `s3` with the
  `JSKIT_STORAGE_S3_*` settings), and copies on several servers share files
  only through `s3`
  ([Run on more than one server, Files](/guide/app-setup/more-than-one-server#files)).
- **The table:** a file people upload goes to storage and the table keeps its
  key; a `blob` field is only for a few bytes the record itself needs
  ([Layer 1](/guide/framework/data-access#layer-1-the-table-resource)). The
  attachments table resource has the record's ownership, the record id, the
  storage key, the original name, the detected type, the size and the author.
- **Upload:** a feature requiring `runtime.uploads` (from
  `@jskit-ai/uploads-runtime`, whose provider registers multipart support) and
  `runtime.storage`. Its route reads the file with
  `uploads.readSingleMultipartFile(request, options)` (`fieldName`,
  `required`, `label`, `maxBytes`) and runs an action with the stream; the
  action reads it with `readUploadBuffer(stream, { maxBytes, fieldName, label })`,
  checks the real bytes with `detectCommonMimeTypeFromBuffer` and
  `validateUploadMimeType(mimeType, policy, { fieldName, label })`, and saves
  with `saveFile({ storageKey, buffer })` of
  `createUploadStorageService({ storage })`. The server makes the key from the owner, the record and a random
  id, never from the file's name. users-core's avatar upload
  (`/api/settings/profile/avatar`) is the working example to follow.
- **Read and delete:** a `GET` route runs an action that reads the
  attachment through its handle in the request's context, so a file of a
  record the caller can't see answers 404 like a missing one; it sends the
  bytes from `readFile(storageKey)` with the stored type, as an attachment
  for anything but images. Deleting the row and the file happen in one action;
  remove the file after the row's transaction commits.
- **Client, photos:** `createManagedImageAssetRuntime` (or
  `createImageUploadRuntime`) from `@jskit-ai/uploads-image-web`, with
  `allowedMimeTypes`, `maxUploadBytes` and `resolveRequestHeaders` sending the
  session's `csrf-token`, as users-web's account avatar does.
- **Client, documents:** a file input whose `FormData` goes through the app's
  JSKIT HTTP client, which sends a `FormData` body as it is; the list of
  attachments is an ordinary `useList()` or CRUD list.
- **Refusals** carry their field error from `buildUploadFieldError`, shown
  beside the control; a lost connection is reported through JSKIT's request
  recovery.

## Proof

Prove each behaviour at the cheapest level, never against development data
and never against a real bucket: tests use `JSKIT_STORAGE_DRIVER=memory`.

- **Server tests** (`jskit test`, on `TEST_DB_NAME`, through `app.inject`):
  upload, read and delete as the author; a reader without access gets 404;
  too large and wrong-type files refused with their field error, a file whose
  name says `.jpg` but whose bytes are not refused; a key from a crafted name
  cannot leave its folder; the file goes with its record; listing a record's
  attachments takes the same number of queries at 3 and 300 files
  (`expectFlatQueries()`).
- **Client tests:** the upload control's states (pending, refused, done).
- **Browser tests** (`npm run test:e2e`): attach a photo with
  `setInputFiles`, crop it, see it on the record; at 390 and 1280 px.

## Leftovers for the person

- The bucket and its access key for staging and production when the app runs
  on more than one server.
- Uploading real photos from their own phones.
