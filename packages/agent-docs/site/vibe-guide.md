---
title: Vibe Guide
description: How to vibe an app with JSKIT-AI, even if you are not a developer.
---

<div class="why-jskit-page vibe-guide-page">
<section class="vibe-guide-intro">
  <p class="why-jskit-kicker">Vibe Guide</p>
  <h1>How to vibe an app with JSKIT-AI</h1>
  <p class="vibe-guide-intro-lead">
    This page is for people who are comfortable around computers but are not developers.
    The AI can do a lot of the building, but you still need to set up the outside pieces and
    answer the right questions clearly.
  </p>
  <p class="vibe-guide-inline-note">
    <strong>Important:</strong> start by seeding a real JSKIT app. Without that scaffold, the AI
    does not have the packaged instructions, docs, and structure it expects.
  </p>
</section>

<section class="vibe-guide-section">
  <h2>Before you start</h2>
  <div class="vibe-guide-checklist">
    <article class="vibe-guide-panel">
      <h3>You should be comfortable with</h3>
      <ul>
        <li>running commands in a terminal</li>
        <li>creating a MySQL or Postgres database</li>
        <li>creating a Supabase project and copying a couple of values</li>
        <li>creating an API key if your app will include an assistant</li>
      </ul>
    </article>
    <article class="vibe-guide-panel">
      <h3>You will probably need</h3>
      <ul>
        <li>a development database, not a production one</li>
        <li>your Supabase project URL and publishable key</li>
        <li>an assistant API key if the app will have AI features</li>
        <li>the patience to answer setup questions properly before asking for features</li>
      </ul>
    </article>
  </div>
</section>

<section class="vibe-guide-section">
  <h2>Step 1. Seed the app with AI instructions</h2>
  <p>
    This is mandatory. It creates the app scaffold and installs the files that tell the AI how to
    work inside a JSKIT app.
  </p>
  <pre class="vibe-guide-command"><code>npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install</code></pre>
  <p class="vibe-guide-inline-note">
    Use <code>none</code> here as the neutral starting point. The AI can later decide whether the
    app should stay simple or move to personal workspaces or full multi-homing.
  </p>
</section>

<section class="vibe-guide-section">
  <h2>Step 2. Prepare the external services</h2>
  <div class="vibe-guide-service-grid">
    <article class="vibe-guide-panel">
      <h3>Create a database</h3>
      <p>JSKIT works with MySQL or Postgres.</p>
      <ul>
        <li>create the database</li>
        <li>create or choose a database user</li>
        <li>save the username, password, and database name</li>
        <li>also keep host and port if they are not the usual local defaults</li>
      </ul>
    </article>
    <article class="vibe-guide-panel">
      <h3>Create a Supabase project if the app will have login</h3>
      <ol>
        <li>Go to <code>supabase.com</code> and create an account.</li>
        <li>Create a new project.</li>
        <li>Open the project dashboard.</li>
        <li>Go to <code>Settings</code> → <code>API</code>.</li>
        <li>Copy the Project URL.</li>
        <li>Copy the publishable key.</li>
      </ol>
      <p>The AI will usually ask for <code>AUTH_SUPABASE_URL</code> and <code>AUTH_SUPABASE_PUBLISHABLE_KEY</code>.</p>
    </article>
    <article class="vibe-guide-panel">
      <h3>Create an assistant API token if needed</h3>
      <p>Skip this if the app does not need an assistant.</p>
      <ul>
        <li>recommended provider: <strong>DeepSeek</strong></li>
        <li>create an API key in the provider dashboard</li>
        <li>keep it ready before you start asking for assistant features</li>
      </ul>
    </article>
  </div>
</section>

<section class="vibe-guide-section">
  <h2>Step 3. Run Codex or Claude from inside the app folder</h2>
  <p>Start your AI only after the app exists and <code>npm install</code> has finished.</p>
  <pre class="vibe-guide-command"><code>codex
claude</code></pre>
  <p class="vibe-guide-inline-note">
    Run one of them, not both. The important part is that you start inside the seeded app folder.
  </p>
</section>

<section class="vibe-guide-section">
  <h2>Step 4. Answer the setup questions clearly</h2>
  <p>The AI will ask structural questions before it starts building. That is the right behavior.</p>
  <ul class="vibe-guide-bullets">
    <li>Is this a simple app or a workspace / multi-homing app?</li>
    <li>Does it need login?</li>
    <li>Does it need a database right away?</li>
    <li>Does it need an assistant?</li>
    <li>Is it an internal tool, a customer app, or something else?</li>
  </ul>
</section>

<section class="vibe-guide-section">
  <h2>Step 5. Ask for features one chunk at a time</h2>
  <p>
    Once setup is done, start building the real app. The best results come when you ask for one
    feature or one CRUD at a time and let the AI scope it before coding.
  </p>
  <ul class="vibe-guide-bullets">
    <li>start with the main screens and data model</li>
    <li>let the AI ask follow-up questions</li>
    <li>approve the scope before implementation</li>
    <li>then grow the app chunk by chunk</li>
  </ul>
  <p class="vibe-guide-inline-note">
    “Build my whole startup in one go” is the bad vibe. “Let’s do the task list CRUD, then the
    dashboard, then the reminders flow” is the good vibe.
  </p>
</section>

<section class="vibe-guide-section vibe-guide-section--muted">
  <h2>Keep these values ready</h2>
  <div class="vibe-guide-cheatsheet-grid">
    <article class="vibe-guide-cheatsheet-card">
      <h3>Database</h3>
      <p><code>DB_NAME</code> · <code>DB_USER</code> · <code>DB_PASSWORD</code></p>
      <p><code>DB_HOST</code> and <code>DB_PORT</code> only if not default.</p>
    </article>
    <article class="vibe-guide-cheatsheet-card">
      <h3>Supabase</h3>
      <p><code>AUTH_SUPABASE_URL</code></p>
      <p><code>AUTH_SUPABASE_PUBLISHABLE_KEY</code></p>
    </article>
    <article class="vibe-guide-cheatsheet-card">
      <h3>Assistant</h3>
      <p>Your assistant provider API key.</p>
      <p>Recommended first stop: <strong>DeepSeek</strong>.</p>
    </article>
  </div>
</section>

<section class="why-jskit-close vibe-guide-close">
  <p class="why-jskit-close-top">You do not need to be a developer. You do need to be prepared.</p>
  <h2>Seed it, answer clearly, then build.</h2>
  <div class="why-jskit-close-actions">
    <a class="why-jskit-button why-jskit-button--ghost" href="/">Back to home</a>
    <a class="why-jskit-button why-jskit-button--primary" href="/guide/">Read the guide</a>
    <a class="why-jskit-button why-jskit-button--ghost" href="/ai-ready">See AI Ready</a>
  </div>
</section>
</div>
