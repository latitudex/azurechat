"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface EmbedModeValue {
  /** True when the chat UI is rendered inside the iframe-friendly /embed routes. */
  isEmbed: boolean;
  /** Origin of the host page framing us (e.g. https://tenant.sharepoint.com), if known. */
  parentOrigin?: string;
}

// Default value means components used OUTSIDE an EmbedModeProvider (the normal
// app) behave exactly as before — `isEmbed` is false and no chrome is hidden.
const EmbedModeContext = createContext<EmbedModeValue>({ isEmbed: false });

export const useEmbedMode = (): EmbedModeValue => useContext(EmbedModeContext);

/**
 * Marks the subtree as running in embed mode. Provided once in
 * `app/embed/layout.tsx`; chat-page components read `isEmbed` to suppress
 * full-app chrome (header menus, persona switcher, share controls) without
 * threading a prop through every component.
 */
export const EmbedModeProvider = ({ children }: { children: ReactNode }) => {
  const [parentOrigin, setParentOrigin] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      // ancestorOrigins is the most reliable source in Chromium and is not
      // affected by referrer-policy. Fall back to document.referrer.
      const fromAncestors = window.location.ancestorOrigins?.[0];
      if (fromAncestors) {
        setParentOrigin(fromAncestors);
        return;
      }
      if (document.referrer) {
        setParentOrigin(new URL(document.referrer).origin);
      }
    } catch {
      /* cross-origin access can throw — parentOrigin stays undefined */
    }
  }, []);

  return (
    <EmbedModeContext.Provider value={{ isEmbed: true, parentOrigin }}>
      {children}
    </EmbedModeContext.Provider>
  );
};
