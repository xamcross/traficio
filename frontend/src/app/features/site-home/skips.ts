/** Session-only "skip for now" set per plan. Spec §4.4. Never sent to the server. */
const KEY = (planId: string) => `geostrategy.skipped.${planId}`;

export function readSkips(planId: string): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY(planId)) ?? '[]') as string[]); } catch { return new Set(); }
}
export function addSkip(planId: string, taskId: string): Set<string> {
  const s = readSkips(planId); s.add(taskId);
  sessionStorage.setItem(KEY(planId), JSON.stringify([...s]));
  return s;
}
export function clearSkips(planId: string): void { sessionStorage.removeItem(KEY(planId)); }
