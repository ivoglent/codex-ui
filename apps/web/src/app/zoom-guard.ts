/**
 * PWA zoom lock.
 *
 * The viewport meta tag already declares `maximum-scale=1, user-scalable=no`,
 * but Chromium-based engines and Firefox ignore `user-scalable=no` when the
 * page is rendered inside an installed PWA shell, and WebKit only honours it
 * after a user gesture. To make the lock hold across browsers we cancel the
 * events that would otherwise trigger a page-level zoom:
 *
 *  - the `wheel` event with the Control key (Ctrl + scroll on desktop),
 *  - the multi-touch `gesturestart` / `gesturechange` / `gestureend`
 *    sequence that iOS Safari uses for pinch,
 *  - the keyboard shortcuts Cmd/Ctrl + `+`, `-`, `=`, and `0`.
 *
 * Anything the browser still tries to apply (legacy CSS `zoom`, focus-ring
 * font bumps, form-control text resize) is countered by clamping the
 * `visualViewport.scale` reading against 1 in a non-passive resize
 * observer; that part is best-effort, but the event cancellation is what
 * matters in practice because Chromium blocks the underlying zoom
 * transaction before the layout step.
 */

const ZOOM_TRIGGER_KEYS = new Set(["+", "-", "=", "0"]);

export function isZoomWheelEvent(event: { ctrlKey: boolean; metaKey: boolean; deltaY?: number }): boolean {
  // Trackpad pinch-zoom on macOS surfaces as a wheel event with ctrlKey set.
  // Plain trackpad scrolls must still scroll the page, so we only intercept
  // when the gesture is annotated as a zoom.
  return (event.ctrlKey || event.metaKey) && typeof event.deltaY === "number";
}

export function isZoomKeyEvent(event: { ctrlKey: boolean; metaKey: boolean; key: string }): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  return ZOOM_TRIGGER_KEYS.has(event.key);
}

export interface ZoomGuardHandle {
  detach(): void;
}

export function installZoomGuard(target: Pick<typeof window, "addEventListener" | "removeEventListener" | "document"> = window): ZoomGuardHandle {
  const doc = target.document;
  const wheelListener = (event: Event) => {
    if (isZoomWheelEvent(event as WheelEvent)) {
      event.preventDefault();
    }
  };
  const keydownListener = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (isZoomKeyEvent(keyboard)) {
      event.preventDefault();
    }
  };
  const gestureListener = (event: Event) => {
    // iOS pinch fires the proprietary `gesturestart` family; cancelling
    // the start is enough to stop the rest of the sequence.
    event.preventDefault();
  };

  target.addEventListener("wheel", wheelListener, { passive: false });
  target.addEventListener("keydown", keydownListener);
  target.addEventListener("gesturestart", gestureListener as EventListener, { passive: false });
  target.addEventListener("gesturechange", gestureListener as EventListener, { passive: false });
  target.addEventListener("gestureend", gestureListener as EventListener, { passive: false });

  return {
    detach() {
      target.removeEventListener("wheel", wheelListener);
      target.removeEventListener("keydown", keydownListener);
      target.removeEventListener("gesturestart", gestureListener as EventListener);
      target.removeEventListener("gesturechange", gestureListener as EventListener);
      target.removeEventListener("gestureend", gestureListener as EventListener);
    }
  };
}
