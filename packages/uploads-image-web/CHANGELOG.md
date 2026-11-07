# Changelog

## Unreleased

- The image dialog (Uppy's dashboard and image editor) takes the app's Material 3 roles and typeface, in light and dark: its panel is `surface-container-high` with 28dp corners and no outline, text `on-surface`, "browse files" a `primary` link underlined only under the pointer, filled buttons primary and full-shape, all in the theme's `--v-font-body`, instead of Uppy's light grey panel, blue underlined link and system font in both schemes. `@jskit-ai/uploads-image-web/client/styles` loads it after Uppy's stylesheets.
- The image dialog is modal over the whole app: its `scrim` covers the top app bar, navigation and Vuetify's own overlays (Uppy's z-index 1001 sat under the app bar), and its close button sits inside the dialog in a 56dp header row, an `on-surface-variant` 48dp icon button, instead of above the container (hidden under the app bar at 390 and 768) or beside it (at 1280). At compact width (below 600dp) it is a full-screen dialog with the close button at the leading edge; at medium width it keeps 24dp from every edge. Its hint text is `on-surface-variant` (Uppy's #757575 on its grey panel was 4.2:1).

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (12)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.uploads.imageUpload.note`
- `jskit.uploads.imageAsset.endpointUnavailable`
- `jskit.uploads.imageAsset.uploadSuccess`
- `jskit.uploads.imageAsset.uploadInvalidResponse`
- `jskit.uploads.imageAsset.uploadError`
- `jskit.uploads.imageAsset.uploadRestriction`
- `jskit.uploads.imageAsset.editorUnavailable`
- `jskit.uploads.imageAsset.deleteSuccess`
- `jskit.uploads.imageAsset.deleteError`
- `jskit.uploads.imageAsset.deleteUnavailable`
- `jskit.uploads.imageAsset.deleteRequestFailed`
- `jskit.uploads.imageAsset.changeError`

</details>
