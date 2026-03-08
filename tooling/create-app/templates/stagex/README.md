# __APP_TITLE__

Generated with `jskit-create-app` (template: `stagex`).

## Quickstart

```bash
npm install
npm run dev
```

## Server

```bash
npm run server
```

App configuration files:

- `config/surfaces.js` for surface routing/runtime mode.
- `config/public.js` for client-visible feature toggles.
- `config/server.js` for server-only toggles/secrets wiring.

Contact API routes:

- `POST /api/v1/contacts/intake`
- `POST /api/v1/contacts/preview-followup`
- `GET /api/v1/contacts/:contactId`

## Add Capabilities

```bash
npx jskit add auth-base --no-install
```
