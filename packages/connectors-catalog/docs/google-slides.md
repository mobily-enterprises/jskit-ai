# Google Slides setup and runtime

Documentation checked: 13 September 2026. Tests use simulated HTTP and private
file storage. No live Google presentation, consent or generated app was exercised.

## Set up the project-owned registration

1. Follow [Google registration setup](google-oauth.md): select this application's
   Cloud project; Google Auth Platform → Branding/Audience → configure app details
   and permitted test accounts. Public access requires the applicable review.
2. APIs & Services → Library → **Google Slides API** → Enable. Also enable
   **Google Drive API** for create-first connection verification.
3. Google Auth Platform → Data Access → Add or Remove Scopes → select
   `https://www.googleapis.com/auth/drive.file` → Update/Save. This permits files
   created by or explicitly selected/opened for this app. For existing-file
   selection, the generated app wires Google Picker; typing an ID grants nothing.
4. Clients → Create Client → Web application → Authorized redirect URIs → Add URI.
   Paste the app backend callback displayed in the editor, then Create. Copy its
   client ID and secret immediately. Use the common guide for lost-secret rotation,
   Testing refresh-token expiry and domain changes.
5. Enter the client ID and Env references, then Save configuration. **Set credential
   in Env** stores the secret; **Set callback in Env** stores the exact registered
   URL. CLI users set the same references/file without Vibe64.
6. Leave **Presentation ID (optional)** blank to verify accessible Drive metadata.
   Empty metadata is accepted without creating a deck; it does not verify that
   Slides API is enabled. For an existing deck, copy the ID between `/presentation/d/`
   and `/edit`, not a slide object ID. Both user and app must have access.
7. Read-only existing decks can instead use `presentations.readonly` with that ID.
   `presentations` permits broader edits; enable selected scopes in Data Access and
   reconnect after changes. Spreadsheet scopes alone do not grant presentation
   access. Linked charts may separately require access to their source spreadsheet.

## Runtime and framework ownership

Import `googleSlidesProvider` from `@jskit-ai/connectors-catalog/server/google-slides`.
Register it with the existing connection service/file store. The application owns
subject authorization, backend callbacks, consent and credentials. Compose the
[connection pattern](../patterns/api-key-connection/PATTERN.md) with OAuth and a
registrationRef, then `beginAuthorization` / `completeAuthorization`; use empty
verificationInput for create-first or `{ presentationId }` for an existing deck.
Other frameworks use native Google SDK/HTTP with the same project JSON/Env contract;
JSKIT is optional and has no dependency on the editor at runtime.

| Operation | Input / useful result |
| --- | --- |
| presentations.create | title; creates a blank deck and returns its ID. |
| presentations.get | presentationId; title, slides, objects and revision. |
| presentations.batchUpdate | presentationId, requests, optional requiredRevisionId; native slide/text/image/format/duplicate/delete-object changes. |
| pages.get | presentationId, pageObjectId; one slide/page. |
| pages.getThumbnail | Same IDs, optional size SMALL/MEDIUM/LARGE; temporary HTTPS contentUrl and dimensions. |

```js
const deck = await service.invoke({ ...connection, operation: "presentations.create", input: { title: "Bookings" } });
await service.invoke({ ...connection, operation: "presentations.batchUpdate", input: {
  presentationId: deck.presentationId,
  requests: [
    { createSlide: { objectId: "booking_slide", slideLayoutReference: { predefinedLayout: "BLANK" } } },
    { createShape: { objectId: "booking_title", shapeType: "TEXT_BOX", elementProperties: {
      pageObjectId: "booking_slide", size: { width: { magnitude: 400, unit: "PT" }, height: { magnitude: 60, unit: "PT" } },
      transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 40, unit: "PT" }
    } } },
    { insertText: { objectId: "booking_title", text: "Bookings this week", insertionIndex: 0 } }
  ]
} });
```

Batches accept 1–100 native request objects within 1 MiB. Google validates request
semantics; the app supplies object IDs, positions, field masks and permissions.
Use `requiredRevisionId` from a recent read to reject concurrent changes; stale
revision returns a provider error instead of being silently overwritten. This
adapter never retries uncertain creates/edits; inspect the deck before repeating.
Images must be reachable by Google and meet its image restrictions. Linked-chart
requests require source access; there is no automatic grant or chart sync worker.

Thumbnail URLs are temporary capabilities: render only to authorized users, avoid
logging them, and request a fresh thumbnail when expired. The adapter returns the
URL without downloading it or forwarding tokens to its host. The app owns CSP,
image rendering and whether to persist a permitted copy. Whole-file copying,
sharing, export and trash belong to the separately authorized Drive API.

## Automation and limitations

Authorized AI can enable APIs using gcloud/Service Usage and prepare configuration;
client creation, branding, audience, approval and consent follow the console steps.
No Vibe64-owned Google registration or gateway is required.

**LIMITATIONS:** No visual slide designer, template library, embedded Picker,
whole-file sharing/export UI or editor-assistant attachment. For example an app can
create a booking summary deck and preview a slide, but must provide its own design
and access controls. Native/live rendering and actual Google approval are unproven.

References: [API methods](https://developers.google.com/workspace/slides/api/reference/rest),
[batch requests](https://developers.google.com/workspace/slides/api/guides/batch),
[write control](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/batchUpdate),
[thumbnails](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations.pages/getThumbnail).
