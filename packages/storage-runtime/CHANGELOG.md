# Changelog

## Unreleased

- `JSKIT_STORAGE_DRIVER=s3` keeps `runtime.storage` in an S3 bucket, or an S3-compatible store such as R2 or MinIO, through unstorage's own `s3` driver, so copies of an app on several servers share their uploads and profile pictures. Its settings are `JSKIT_STORAGE_S3_BUCKET`, `JSKIT_STORAGE_S3_REGION`, `JSKIT_STORAGE_S3_ACCESS_KEY_ID` and `JSKIT_STORAGE_S3_SECRET_ACCESS_KEY`, required, and `JSKIT_STORAGE_S3_ENDPOINT`, AWS's regional address when empty. A missing required one refuses at startup, naming each and no value, and the driver the storage shows names the secret `[redacted]`. The package now installs `aws4fetch`, which unstorage's `s3` driver signs its requests with and declares only as an optional peer. The new README says what the driver does not do: it lists only a bucket's first 1,000 objects, so `getKeys` and `clear` are short past that, and `getMeta` has no size or time.
