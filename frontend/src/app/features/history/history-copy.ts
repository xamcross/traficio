import { AssessmentDto, Scores } from '../../core/api/types';
import { areaName, monthName, numberWord } from '../../shared/copy';

const AREAS: Array<'seo' | 'aeo' | 'geo'> = ['seo', 'aeo', 'geo'];

/** Headline for the history page. `ready` is oldest first and every item has scores. Spec §4.8. */
export function headlineFor(ready: AssessmentDto[]): { title: string; text: string } {
  if (ready.length < 2) return { title: 'One check so far.', text: 'Fix a task, then check again to see the change.' };
  const first = ready[0], last = ready[ready.length - 1];
  const f = first.scores as Scores, l = last.scores as Scores;
  const month = monthName(first.completedAt ?? first.createdAt);
  if (l.overall > f.overall) {
    const best = AREAS.map((k) => ({ k, d: l[k] - f[k] })).sort((x, y) => y.d - x.d)[0].k;
    return { title: 'It is working.', text: `You have gone from ${f.overall} to ${l.overall} since ${month}. ${areaName(best)} has moved the most.` };
  }
  return { title: 'Not moving yet.', text: `Your score is ${l.overall}. It was ${f.overall} in ${month}. Finish the next task and check again.` };
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** The "what changed" cell. Spec §4.8. */
export function changesText(a: AssessmentDto, isFirstReady: boolean): string {
  if (a.status !== 'ready' || !a.scores) return 'We could not read your site that day';
  if (isFirstReady) return 'Your first check';
  const c = a.changes ?? [];
  if (c.length === 0) return 'No changes since your last check';
  if (c.length === 1) return c[0].kind === 'verified' ? `Confirmed fixed: ${c[0].title}` : c[0].title;
  const done = c.filter((x) => x.kind === 'done').length;
  const verified = c.filter((x) => x.kind === 'verified').length;
  const tasks = (n: number) => `${numberWord(n)} task${n === 1 ? '' : 's'}`;
  if (verified === 0) return `${cap(tasks(done))} done`;
  if (done === 0) return `${cap(tasks(verified))} confirmed fixed`;
  return `${cap(tasks(done))} done, ${numberWord(verified)} confirmed fixed`;
}

export function chartPoints(ready: AssessmentDto[], key: 'seo' | 'aeo' | 'geo', width: number, height: number): string {
  const n = ready.length;
  if (n < 2) return '';
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return ready.map((a, i) => `${r1((width / (n - 1)) * i)},${r1(height - (a.scores as Scores)[key] * (height / 100))}`).join(' ');
}
