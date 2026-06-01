"use client";

import { useEffect } from "react";
import { EMBED_AUTH_MESSAGE } from "@/features/embed/embed-sign-in";

/**
 * Runs after the NextAuth callback completes inside the login popup. Notifies
 * the opener (the iframe) that auth succeeded, then closes itself. The opener
 * re-checks the session and re-renders the embedded view.
 */
export default function EmbedAuthComplete() {
  useEffect(() => {
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: EMBED_AUTH_MESSAGE, status: "ok" },
          window.location.origin
        );
      }
    } catch {
      /* opener may be gone — nothing to do */
    }
    const timer = setTimeout(() => {
      try {
        window.close();
      } catch {
        /* some browsers refuse window.close on non-script-opened windows */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">
      Signed in. You can close this window.
    </main>
  );
}
