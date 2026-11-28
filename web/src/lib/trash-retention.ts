export const TRASH_RETENTION = 15 * 60 * 1000;

export function trashMinutesRemaining(trashedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((TRASH_RETENTION - (now - trashedAt)) / 60_000));
}
