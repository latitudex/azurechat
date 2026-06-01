"use client";

import { type FC, useCallback, useEffect } from "react";
import { AI_NAME } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card";

/** Message posted by the auth popup (`/embed/auth/complete`) to its opener. */
export const EMBED_AUTH_MESSAGE = "buhler-chat-auth";

/**
 * Auth-gated placeholder shown inside the iframe when there is no session.
 * Deliberately reveals NOTHING about the agent (name/description) until the
 * user signs in. Microsoft Entra blocks its login pages inside iframes, so we
 * open the OAuth round-trip in a popup and listen for a postMessage telling us
 * to re-check the session.
 */
export const EmbedSignIn: FC<{ title?: string }> = ({ title }) => {
  const openLogin = useCallback(() => {
    const callbackUrl =
      typeof window !== "undefined" ? window.location.href : "/";
    const url = `/embed/auth/start?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    window.open(url, "buhler-chat-login", "width=520,height=720");
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only trust same-origin messages from our own popup.
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === EMBED_AUTH_MESSAGE && e.data?.status === "ok") {
        window.location.reload();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex items-center justify-center h-full w-full p-4">
      <Card className="min-w-[280px] max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">
            {title ?? "Sign in to chat"}
          </CardTitle>
          <CardDescription>
            Sign in with your Microsoft Entra ID account to chat with this{" "}
            {AI_NAME} agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={openLogin}>
            Sign in to continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
