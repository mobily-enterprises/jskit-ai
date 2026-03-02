# 001 - Create An App

## 1) Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
git init
```

## 2) Scaffold into current directory

```bash
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- If target contains only `.git`, it is allowed.
- If target contains other files, use `--force`.

## 3) Install and run

```bash
npm install
```

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server
```

Open:

```text
http://localhost:5173/app
http://localhost:5173/admin
http://localhost:5173/console
```

Expected:
- Pages render from filesystem routing (`src/pages`).
- `GET /api/v1/health` returns `404` until runtime routes are installed via JSKIT modules.
