"use client";

import { SessionProvider } from "next-auth/react";
import { type ReactNode } from "react";
import { EmbedModeProvider } from "./embed-mode-context";

/**
 * Client providers for the /embed route group. Mirrors AuthenticatedProviders
 * (SessionProvider so useSession works in ChatPage) but adds EmbedModeProvider
 * and deliberately omits the MainMenu / app chrome.
 */
export const EmbedProviders = ({ children }: { children: ReactNode }) => {
  return (
    <SessionProvider>
      <EmbedModeProvider>{children}</EmbedModeProvider>
    </SessionProvider>
  );
};
