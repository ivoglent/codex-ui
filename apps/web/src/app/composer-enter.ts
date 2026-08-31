/**
 * Routes Enter-key behavior in the chat composer.
 *
 * Mobile / touch-only clients (detected via `(hover: none) and (pointer: coarse)`):
 *   - Enter inserts a newline (default textarea behavior).
 *   - The user submits by tapping the send button.
 *
 * Desktop / fine-pointer clients:
 *   - Enter submits the current draft.
 *   - Shift+Enter inserts a newline.
 *
 * IME composition is always treated as a newline so users typing with CJK or
 * other composing keyboards never accidentally send a half-formed message.
 */

export interface ComposerEnterEvent {
  readonly key?: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export function isComposerEnter(event: ComposerEnterEvent): boolean {
  if (!event || typeof event !== "object") return false;
  if (event.isComposing) return false;
  // Older Android WebView reports `keyCode: 229` for composing input even when
  // `isComposing` is not yet set on the keydown event.
  if (event.keyCode === 229) return false;
  return event.key === "Enter";
}

/**
 * Returns `true` when the keydown should submit the draft instead of inserting
 * a newline. Touch-only devices always insert newlines; on desktop the Enter
 * key submits, Shift+Enter inserts a newline.
 */
export function shouldSubmitOnComposerEnter(
  isTouchDevice: boolean,
  event: ComposerEnterEvent & { readonly shiftKey?: boolean },
): boolean {
  if (!isComposerEnter(event)) return false;
  if (isTouchDevice) return false;
  if (event.shiftKey) return false;
  return true;
}

/**
 * Snapshot the platform from `window.matchMedia` once at startup. We treat
 * `(hover: none) and (pointer: coarse)` as "touch-only" — this covers phones,
 * tablets without a connected keyboard, and other no-hover surfaces. Surface
 * tablets with a connected keyboard still report `pointer: fine` and fall back
 * to the desktop Enter-submits behaviour.
 */
export function detectTouchDevice(media: Pick<MediaQueryList, "matches">): boolean {
  return media.matches;
}
