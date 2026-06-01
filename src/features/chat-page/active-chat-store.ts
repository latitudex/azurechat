/**
 * active-chat-store.ts
 *
 * Module-singleton holding a reference to the currently-mounted per-thread
 * Zustand store. Set by <ChatStoreProvider> on mount; cleared on unmount.
 *
 * Necessary because file-store.ts, speech-to-text, and input-prompt are
 * themselves module-singletons (Valtio-era leftovers) and need to write
 * into the active thread's Zustand store without rendering inside the
 * provider tree. They call `getActiveChatStore()?.getState().addAttachedFile(...)`.
 *
 * This is a TEMPORARY bridge to let us delete the Valtio chatStore. The
 * follow-up cleanup converts those singletons to either local component
 * state (input prompt selection) or actions exposed via context.
 */
import type { ChatStore } from "./chat-store-factory";

let active: ChatStore | null = null;

export function setActiveChatStore(store: ChatStore | null) {
  active = store;
}

export function getActiveChatStore(): ChatStore | null {
  return active;
}
