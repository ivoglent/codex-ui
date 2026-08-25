export const NOTIFICATION_THREAD_QUERY = "threadId";

/** Returns the thread requested by a notification URL, if it is usable. */
export function notificationThreadIdFromSearch(search: string): string | null {
  const threadId = new URLSearchParams(search).get(NOTIFICATION_THREAD_QUERY)?.trim();
  return threadId || null;
}

/** Removes a consumed notification target without disturbing other URL state. */
export function clearNotificationThreadFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(NOTIFICATION_THREAD_QUERY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
