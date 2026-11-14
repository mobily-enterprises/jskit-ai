# @jskit-ai/storage-runtime

Provides `runtime.storage`: an [unstorage](https://unstorage.unjs.io) storage
over the driver the environment selects. Uploads and avatars
(`@jskit-ai/uploads-runtime`, `@jskit-ai/users-core`) keep their files in it,
through `setItemRaw`, `getItemRaw` and `removeItem`.

## Drivers

`JSKIT_STORAGE_DRIVER` selects one; any other value refuses at startup.

| Driver | Files live | Settings |
| --- | --- | --- |
| `fs` (default) | in a folder on this machine | `JSKIT_STORAGE_FS_BASE_PATH`, `data/storage` under the app by default |
| `memory` | in the process, gone when it stops | none; for tests |
| `s3` | in an S3 bucket or an S3-compatible store (R2, MinIO) | below |

`s3` passes its settings to unstorage's own `s3` driver:

| Setting | Required | Meaning |
| --- | --- | --- |
| `JSKIT_STORAGE_S3_BUCKET` | yes | the bucket's name |
| `JSKIT_STORAGE_S3_REGION` | yes | its region; `auto` for Cloudflare R2 |
| `JSKIT_STORAGE_S3_ENDPOINT` | no | the store's address, for R2, MinIO or another S3-compatible store; AWS's `https://s3.<region>.amazonaws.com` when empty |
| `JSKIT_STORAGE_S3_ACCESS_KEY_ID` | yes | the access key's id |
| `JSKIT_STORAGE_S3_SECRET_ACCESS_KEY` | yes | the access key's secret |

A required setting that is missing refuses at startup with
`JSKIT_STORAGE_DRIVER=s3 needs <settings>, which are not set.`, naming each
one and no value. The secret stays out of logs: S3's errors carry none, and the
driver the storage shows (`storage.getMount().driver.options`) names it
`[redacted]`. Keep the settings in the environment, never in Git.

The driver addresses an object as `<endpoint>/<bucket>/<key>` (path style), a
key such as `users/avatars/7/avatar` becoming that path, and signs each request
with AWS Signature Version 4 through `aws4fetch`, which this package installs
for it. The access key needs `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject` and `s3:ListBucket` on the bucket.

### What `s3` does not do

Give the storage a bucket of its own: its keys start at the bucket's root.
unstorage 1.17.5's `s3` driver reads only the first page of a listing, the
bucket's first 1,000 objects, whatever prefix is asked for:

- `getKeys(base)` is right while the bucket holds at most 1,000 objects, and
  silently short after that.
- `clear()` removes those first 1,000 objects and keeps the rest.
- `getMeta()` returns only the object's `x-amz-meta-*` headers, with no size
  or modification time.

JSKIT's own packages never list, clear or read metadata; they save, read and
remove files by key, which `s3` does in full.

## More than one server

Copies of an app on several servers share their files only through `s3`: with
`fs`, a file one server saved is missing on the others. See
[Run on more than one server](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/more-than-one-server).
