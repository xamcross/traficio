import { changesText, chartPoints, headlineFor } from './history-copy';
import { AssessmentDto } from '../../core/api/types';

function a(id: string, overall: number, seo: number, aeo: number, geo: number, completedAt: string, changes: AssessmentDto['changes'] = []): AssessmentDto {
  return { id, siteId: 'S1', status: 'ready', scores: { seo, aeo, geo, overall }, summary: null, scoreNotes: null, findings: [], pageCount: null, errorCode: null, errorMessage: null, createdAt: completedAt, completedAt, changes, publicSlug: null };
}

describe('history copy', () => {
  it('headline: one check', () => {
    expect(headlineFor([a('1', 31, 55, 26, 13, '2026-03-02T10:00:00Z')])).toEqual({ title: 'One check so far.', text: 'Fix a task, then check again to see the change.' });
  });
  it('headline: it is working, names the area that moved most', () => {
    const h = headlineFor([a('1', 31, 55, 26, 13, '2026-03-02T10:00:00Z'), a('2', 41, 62, 34, 28, '2026-07-28T10:00:00Z')]);
    expect(h.title).toBe('It is working.');
    expect(h.text).toBe('You have gone from 31 to 41 since March. AI assistants has moved the most.');
  });
  it('headline: not moving yet', () => {
    const h = headlineFor([a('1', 41, 62, 34, 28, '2026-03-02T10:00:00Z'), a('2', 40, 62, 33, 28, '2026-07-28T10:00:00Z')]);
    expect(h.title).toBe('Not moving yet.');
    expect(h.text).toBe('Your score is 40. It was 41 in March. Finish the next task and check again.');
  });
  it('what changed text', () => {
    const base = a('1', 41, 62, 34, 28, '2026-07-28T10:00:00Z');
    expect(changesText(base, true)).toBe('Your first check');
    expect(changesText({ ...base, status: 'failed', scores: null }, false)).toBe('We could not read your site that day');
    expect(changesText(base, false)).toBe('No changes since your last check');
    expect(changesText({ ...base, changes: [{ title: 'Page titles shortened', kind: 'done' }] }, false)).toBe('Page titles shortened');
    expect(changesText({ ...base, changes: [{ title: 'Photos described', kind: 'verified' }] }, false)).toBe('Confirmed fixed: Photos described');
    expect(changesText({ ...base, changes: [{ title: 'a', kind: 'verified' }, { title: 'b', kind: 'verified' }] }, false)).toBe('Two tasks confirmed fixed');
    expect(changesText({ ...base, changes: [{ title: 'a', kind: 'done' }, { title: 'b', kind: 'done' }, { title: 'c', kind: 'done' }] }, false)).toBe('Three tasks done');
    expect(changesText({ ...base, changes: [{ title: 'a', kind: 'done' }, { title: 'b', kind: 'verified' }] }, false)).toBe('One task done, one confirmed fixed');
  });
  it('chart points use one decimal', () => {
    const pts = chartPoints([a('1', 31, 55, 26, 13, '2026-03-02T10:00:00Z'), a('2', 41, 62, 34, 28, '2026-07-28T10:00:00Z')], 'seo', 1000, 240);
    expect(pts).toBe('0,108 1000,91.2');
  });
});
