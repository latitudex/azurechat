import { RefObject, useEffect, useRef } from "react";

/**
 * Auto-scrolls the scroll container to the bottom as new content arrives,
 * but stops doing so if the user scrolls up — the "should I keep pinning
 * to the bottom?" decision lives here as local state because the answer
 * doesn't need to be shared across components.
 */
export const useChatScrollAnchor = (props: {
  ref: RefObject<HTMLDivElement>;
}) => {
  const { ref } = props;
  const autoScrollRef = useRef(true);

  // Stop auto-scrolling once the user scrolls up away from the bottom;
  // resume only when they scroll back down to (near) the end.
  useEffect(() => {
    const handleUserScroll = () => {
      if (!ref.current) return;
      const atBottom =
        ref.current.scrollTop + ref.current.clientHeight >=
        ref.current.scrollHeight - 4;
      autoScrollRef.current = atBottom;
    };

    ref.current?.addEventListener("scroll", handleUserScroll);
    return () => {
      ref.current?.removeEventListener("scroll", handleUserScroll);
    };
  }, [ref]);

  // Pin to bottom whenever the DOM grows, but only while autoScroll is on.
  useEffect(() => {
    const handleAutoScroll = () => {
      if (ref.current && autoScrollRef.current) {
        ref.current.scrollTop = ref.current.scrollHeight;
      }
    };

    const observer = new MutationObserver(handleAutoScroll);
    if (ref.current) {
      observer.observe(ref.current, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
    };
  }, [ref]);
};
