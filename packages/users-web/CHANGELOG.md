# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Account settings (sections, preferences, avatar upload, toasts) are translated; the language select offers `config.languages`; `useAccountLocale()` exposes the signed-in user's saved locale.
- Without `config.languages` the language select keeps JSKIT's built-in list unchanged; language names follow the app's language (English without one).

### New message keys (49)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.users.accountSettings.title`
- `jskit.users.accountSettings.subtitle`
- `jskit.users.accountSettings.back`
- `jskit.users.accountSettings.loadFailedTitle`
- `jskit.users.accountSettings.loadFailed`
- `jskit.users.accountSettings.retry`
- `jskit.users.accountSettings.noSections`
- `jskit.users.accountSettings.profile.title`
- `jskit.users.accountSettings.profile.previewSizePrefix`
- `jskit.users.accountSettings.profile.previewSizeSuffix`
- `jskit.users.accountSettings.profile.replaceAvatar`
- `jskit.users.accountSettings.profile.removeAvatar`
- `jskit.users.accountSettings.profile.selectedFilePrefix`
- `jskit.users.accountSettings.profile.displayName`
- `jskit.users.accountSettings.profile.email`
- `jskit.users.accountSettings.profile.emailHint`
- `jskit.users.accountSettings.profile.save`
- `jskit.users.accountSettings.profile.saved`
- `jskit.users.accountSettings.profile.saveFailed`
- `jskit.users.accountSettings.profile.initialsFallback`
- `jskit.users.accountSettings.avatar.removed`
- `jskit.users.accountSettings.avatar.removeFailed`
- `jskit.users.accountSettings.avatar.uploaded`
- `jskit.users.accountSettings.avatar.uploadInvalidResponse`
- `jskit.users.accountSettings.avatar.uploadFailed`
- `jskit.users.accountSettings.avatar.uploadRestriction`
- `jskit.users.accountSettings.avatar.editorUnavailable`
- `jskit.users.accountSettings.avatar.refreshFailed`
- `jskit.users.accountSettings.avatar.secureRequestFailed`
- `jskit.users.accountSettings.preferences.saved`
- `jskit.users.accountSettings.preferences.saveFailed`
- `jskit.users.accountSettings.preferences.theme.system`
- `jskit.users.accountSettings.preferences.theme.light`
- `jskit.users.accountSettings.preferences.theme.dark`
- `jskit.users.accountSettings.preferences.locale.enUS`
- `jskit.users.accountSettings.preferences.locale.enGB`
- `jskit.users.accountSettings.preferences.locale.itIT`
- `jskit.users.accountSettings.preferences.locale.esES`
- `jskit.users.accountSettings.preferences.dateFormat.system`
- `jskit.users.accountSettings.preferences.dateFormat.mdy`
- `jskit.users.accountSettings.preferences.dateFormat.dmy`
- `jskit.users.accountSettings.preferences.dateFormat.ymd`
- `jskit.users.accountSettings.preferences.numberFormat.system`
- `jskit.users.accountSettings.preferences.numberFormat.commaDot`
- `jskit.users.accountSettings.preferences.numberFormat.dotComma`
- `jskit.users.accountSettings.preferences.numberFormat.spaceComma`
- `jskit.users.accountSettings.notifications.saved`
- `jskit.users.accountSettings.notifications.saveFailed`
- `jskit.users.homeTools.label`

</details>
