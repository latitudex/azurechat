import { EmbedProviders } from "@/features/embed/embed-providers";
import { AI_NAME } from "@/features/theme/theme-config";

// Embed routes are always per-request: session state and persona access are
// evaluated on every load and must never be statically cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: AI_NAME,
  description: AI_NAME,
};

/**
 * Minimal layout for iframe-embedded views. Unlike (authenticated)/layout it
 * renders NO MainMenu / sidebar and no telemetry chrome — just the providers
 * needed for an embedded chat. The html/body shell comes from app/layout.tsx.
 */
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EmbedProviders>
      <div className="flex flex-1 min-w-0 h-full w-full overflow-hidden">
        {children}
      </div>
    </EmbedProviders>
  );
}
