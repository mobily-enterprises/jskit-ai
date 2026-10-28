# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (41)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.connectors.googleCalendar.attendeesRequiresUp200Email`
- `jskit.connectors.googleCalendar.cancellationNoEventBody`
- `jskit.connectors.googleCalendar.chooseAllDayDateTimed`
- `jskit.connectors.googleCalendar.chooseSendUpdates`
- `jskit.connectors.googleCalendar.datetimeRequiresExplicitTimezoneOffset`
- `jskit.connectors.googleCalendar.description`
- `jskit.connectors.googleCalendar.eventMustObject`
- `jskit.connectors.googleCalendar.invalidAllDayDate`
- `jskit.connectors.googleCalendar.invalidEventEtag`
- `jskit.connectors.googleCalendar.invalidTransparency`
- `jskit.connectors.googleCalendar.invalidVisibility`
- `jskit.connectors.googleCalendar.recurrenceMustArrayRfc5545Recurrence`
- `jskit.connectors.googleCalendar.scopes.calendar.label`
- `jskit.connectors.googleCalendar.scopes.calendarAcls.label`
- `jskit.connectors.googleCalendar.scopes.calendarAclsReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarAddonsCurrentEventRead.label`
- `jskit.connectors.googleCalendar.scopes.calendarAddonsCurrentEventWrite.label`
- `jskit.connectors.googleCalendar.scopes.calendarAddonsExecute.label`
- `jskit.connectors.googleCalendar.scopes.calendarAppCreated.label`
- `jskit.connectors.googleCalendar.scopes.calendarCalendarlist.label`
- `jskit.connectors.googleCalendar.scopes.calendarCalendarlistReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarCalendars.label`
- `jskit.connectors.googleCalendar.scopes.calendarCalendarsReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarEvents.label`
- `jskit.connectors.googleCalendar.scopes.calendarEventsFreebusy.label`
- `jskit.connectors.googleCalendar.scopes.calendarEventsOwned.label`
- `jskit.connectors.googleCalendar.scopes.calendarEventsOwnedReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarEventsPublicReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarEventsReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarFreebusy.label`
- `jskit.connectors.googleCalendar.scopes.calendarReadonly.label`
- `jskit.connectors.googleCalendar.scopes.calendarSettingsReadonly.label`
- `jskit.connectors.googleCalendar.startEndRequired`
- `jskit.connectors.googleCalendar.supplyStartEndSettingRecurrence`
- `jskit.connectors.googleCalendar.supplyStartEndTogetherChanging`
- `jskit.connectors.googleCalendar.textTooLong`
- `jskit.connectors.googleCalendar.timedRecurrenceRequiresStartEnd`
- `jskit.connectors.googleCalendar.useDateDatetimeOptionalTimezone`
- `jskit.connectors.googleCalendar.useIanaTimezone`
- `jskit.connectors.googleCalendar.useMatchingDateTypesEnd`
- `jskit.connectors.googleCalendar.useSupportedEventFields`

</details>

### Codes (20)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `connectors.googleCalendar.attendeesRequiresUp200Email` | attendees requires up to 200 email entries with optional displayName/optional. |
| `connectors.googleCalendar.cancellationNoEventBody` | Cancellation has no event body. |
| `connectors.googleCalendar.chooseAllDayDateTimed` | Choose an all-day date or a timed dateTime. |
| `connectors.googleCalendar.chooseSendUpdates` | Choose sendUpdates explicitly: all, externalOnly or none. |
| `connectors.googleCalendar.datetimeRequiresExplicitTimezoneOffset` | dateTime requires an explicit timezone offset. |
| `connectors.googleCalendar.eventMustObject` | event must be an object. |
| `connectors.googleCalendar.invalidAllDayDate` | Invalid all-day date. |
| `connectors.googleCalendar.invalidEventEtag` | Invalid event ETag. |
| `connectors.googleCalendar.invalidTransparency` | Invalid transparency. |
| `connectors.googleCalendar.invalidVisibility` | Invalid visibility. |
| `connectors.googleCalendar.recurrenceMustArrayRfc5545Recurrence` | recurrence must be an array of RFC5545 recurrence lines. |
| `connectors.googleCalendar.startEndRequired` | start and end are required. |
| `connectors.googleCalendar.supplyStartEndSettingRecurrence` | Supply start and end when setting recurrence. |
| `connectors.googleCalendar.supplyStartEndTogetherChanging` | Supply start and end together when changing event times. |
| `connectors.googleCalendar.textTooLong` | {field} must be text of at most 16384 characters. |
| `connectors.googleCalendar.timedRecurrenceRequiresStartEnd` | Timed recurrence requires start/end timeZone. |
| `connectors.googleCalendar.useDateDatetimeOptionalTimezone` | Use date or dateTime and optional timeZone. |
| `connectors.googleCalendar.useIanaTimezone` | Use an IANA timeZone. |
| `connectors.googleCalendar.useMatchingDateTypesEnd` | Use matching date types with end after start; all-day end is exclusive. |
| `connectors.googleCalendar.useSupportedEventFields` | Use supported event fields only. |
