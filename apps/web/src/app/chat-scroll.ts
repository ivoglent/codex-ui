export const NEAR_BOTTOM_THRESHOLD = 120;

export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, sentinelVisible = false): boolean {
  return sentinelVisible || distanceFromBottom(scrollHeight, scrollTop, clientHeight) <= NEAR_BOTTOM_THRESHOLD;
}

export function meaningfulUpdateDelta(previousCount: number, currentCount: number): number {
  return Math.max(0, currentCount - previousCount);
}

export function restoredScrollTop(saved: string | null, scrollHeight: number, restoreSavedPosition = true): number {
  if (!restoreSavedPosition) return scrollHeight;
  if (saved == null) return scrollHeight;
  const value = Number(saved);
  return Number.isFinite(value) && value >= 0 ? value : scrollHeight;
}

export function scrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}
