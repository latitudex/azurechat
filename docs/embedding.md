# Embedding agents in external apps (iframe)

Bühler Chat agents (personas) can be embedded as an iframe inside an external
app such as a SharePoint page. The iframe shows a minimal agent card with a
**Start chat** button; clicking it opens a stripped-down chat view (no sidebar,
no main menu) plus an **Open in full app** button that escapes the iframe to the
regular `/chat/[id]` route.

The embedded experience lives under a dedicated `/embed/*` route group that
bypasses the authenticated app layout (no `MainMenu`) and has its own framing
and auth handling.

## The iframe snippet

Each agent card in the overview has a **copy** dropdown (the clipboard icon)
with three actions:

- **Agent link** — `…/agent/<personaId>/chat` (opens a chat in the full app)
- **Embeddable link** — `…/embed/agent/<personaId>` (the iframe-friendly landing)
- **Embed snippet (iframe)** — the ready-to-paste HTML below

Or write the snippet by hand:

```html
<iframe
  src="https://<your-app-host>/embed/agent/<personaId>"
  title="Bühler Chat agent"
  width="420"
  height="640"
  style="border:0;border-radius:12px"
  allow="clipboard-write"
></iframe>
```

- `allow="clipboard-write"` lets the "copy message" action work inside the frame.
- The host page's origin **must** be allow-listed via `EMBED_ALLOWED_ANCESTORS`
  (see below) or the browser will refuse to render the frame.

## Required environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBED_ALLOWED_ANCESTORS` | `'self'` | Space-separated list of origins allowed to frame `/embed/*`. Becomes the `Content-Security-Policy: frame-ancestors …` value. Example: `'self' https://contoso.sharepoint.com https://contoso.sharepoint.com/*`. |
| `EMBED_ALLOW_THIRD_PARTY_COOKIES` | unset (off) | When `true`, the NextAuth session/callback/CSRF cookies are issued as `SameSite=None; Secure` so the session is visible inside a cross-site iframe. Leave off for non-embedded deployments — it weakens CSRF posture app-wide. |

`EMBED_ALLOWED_ANCESTORS` is read at build/start time by `next.config.js`. Other
routes always send `X-Frame-Options: SAMEORIGIN` and
`Content-Security-Policy: frame-ancestors 'self'`, so only `/embed/*` can be framed.

## Authentication inside an iframe

Microsoft Entra blocks its login pages inside iframes (`X-Frame-Options`), so the
OAuth round-trip happens **in a popup**, not in the frame:

1. The embed landing detects "no session" and renders a **Sign in to continue**
   button (it reveals nothing about the agent until the user is authenticated).
2. The button opens `/embed/auth/start` in a popup. That page is a top-level
   window, so Entra's frame restrictions don't apply.
3. After the NextAuth callback, `/embed/auth/complete` `postMessage`s
   `{ type: "buhler-chat-auth", status: "ok" }` to `window.opener` and closes.
4. The iframe receives the message, re-checks the session, and re-renders.

> **Third-party cookies.** For the iframe to *see* the session created in the
> popup, the session cookie must be `SameSite=None; Secure` — enable
> `EMBED_ALLOW_THIRD_PARTY_COOKIES=true`. Browsers that block third-party
> cookies (Safari ITP, Chrome's upcoming default) will still fail; in that case
> the popup login succeeds but the frame won't see the session. The **Open in
> full app** button is the fallback.

### Azure AD app registration

- Add the embed origin to the app registration **Redirect URIs** only if it
  differs from the canonical app URL (the popup uses the same NextAuth callback,
  so usually no change is needed).
- Add the SharePoint origin under "Allow public client flows" only if your
  tenant requires it.

## Out of scope

- No changes to existing `/chat` or `/agent` behaviour or layout.
- No new auth provider — still NextAuth + Azure AD, with cookie/header config
  adjusted conditionally.
- No MSAL silent-token / SSO flow. If popup login proves insufficient, that is a
  separate, larger change.
