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
