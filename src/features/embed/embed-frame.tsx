"use client";

import { ExternalLink } from "lucide-react";
import { type FC, type ReactNode } from "react";
import { Button } from "@/features/ui/button";

interface EmbedFrameProps {
  /** Title shown in the compact embed header (agent or thread name). */
  title: string;
  /**
   * Relative path in the full (non-embedded) app to open at the top level,
   * e.g. `/chat/123` or `/agent/abc/chat`. When provided, an "Open in full
   * app" button is rendered.
   */
  fullAppHref?: string;
  children: ReactNode;
}

/**
 * Minimal wrapper for embedded views: a small header with the agent/thread
 * name and an "Open in full app" button that escapes the iframe by navigating
 * the top-level window to the canonical app route. Falls back to opening a new
 * tab when the top window is cross-origin and cannot be navigated directly.
 */
export const EmbedFrame: FC<EmbedFrameProps> = ({ title, fullAppHref, children }) => {
  const openInFullApp = () => {
    if (!fullAppHref) return;
    const url = `${window.location.origin}${fullAppHref}`;
    try {
      if (window.top) {
        window.top.location.href = url;
        return;
      }
    } catch {
      /* cross-origin top — cannot set location; fall through to new tab */
    }
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-2 shrink-0">
        <span className="text-sm font-medium truncate flex-1">{title}</span>
        {fullAppHref && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs shrink-0"
            onClick={openInFullApp}
          >
            <ExternalLink className="size-3.5" />
            Open in full app
          </Button>
        )}
      </header>
      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
};
