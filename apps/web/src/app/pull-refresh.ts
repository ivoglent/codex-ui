/**
 * Geometry for the chat pull-down gesture. Pull resistance softens the gesture
 * so the indicator does not snap from the top of the scrollable area all the
 * way to the threshold on a small finger movement, and the max distance caps
 * how far the indicator can travel before the refresh commits.
 */
export const PULL_THRESHOLD_PX = 80;
export const PULL_MAX_PX = 140;
export const PULL_RESISTANCE = 0.55;

export function pullDistance(rawDelta: number): number {
  if (!Number.isFinite(rawDelta) || rawDelta <= 0) return 0;
  return Math.min(PULL_MAX_PX, rawDelta * PULL_RESISTANCE);
}

export function shouldCommitRefresh(distance: number): boolean {
  return Number.isFinite(distance) && distance >= PULL_THRESHOLD_PX;
}

export function indicatorOffset(distance: number): number {
  return distance - 56;
}
