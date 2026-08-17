import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NextTaskView, nextTaskFor } from './next-task-view';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';
import { clearSkips } from './skips';

const site: SiteDto = { id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false, latestAssessment: null, latestReadyAssessmentId: 'A1' };
const assessment: AssessmentDto = { id: 'A1', siteId: 'S1', status: 'ready', scores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, summary: null, scoreNotes: null, findings: [], pageCount: 18, errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [] };
function plan(): PlanDto {
  const t = (i: number, title: string, minutes: number, status: 'todo' | 'done' | 'verified' = 'todo') => ({
    taskId: `T${i}`, title, category: 'geo', impact: (i === 1 ? 'high' : 'medium') as 'high' | 'medium', effortMinutes: minutes, stepCount: 4,
    whyItMatters: `why ${i}`, steps: ['Open your SEO plugin settings in WordPress.', 'Find the section called Local Business or Organization.', 'Fill in your business name, street address, phone number and opening hours.', 'Save, then clear your site cache.'], doneCheck: `check ${i}`, status,
  });
  return { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked: false, progress: { done: 2, verified: 0, total: 8 }, tasks: [
    t(1, 'Put your address and hours where machines can read them', 20), t(2, 'Write the one page that answers what people ask', 45), t(3, 'Add prices to your shop pages', 30),
    t(4, 'Link your opening hours from every page footer', 15), t(5, 'E', 15), t(6, 'F', 15), t(7, 'G', 20, 'done'), t(8, 'H', 20, 'done'),
  ] };
}

describe('nextTaskFor', () => {
  it('returns the first todo task, skips skipped ones, and wraps when all are skipped', () => {
    const p = plan();
    expect(nextTaskFor(p, new Set())?.taskId).toBe('T1');
    expect(nextTaskFor(p, new Set(['T1']))?.taskId).toBe('T2');
    expect(nextTaskFor(p, new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']))?.taskId).toBe('T1');
    const allDone = { ...p, tasks: p.tasks.map((t) => ({ ...t, status: 'done' as const })) };
    expect(nextTaskFor(allDone, new Set())).toBeNull();
  });
});

describe('NextTaskView', () => {
  beforeEach(() => clearSkips('P1'));
  async function render(p: PlanDto, previousOverall: number | null = 37) {
    await TestBed.configureTestingModule({ imports: [NextTaskView], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(NextTaskView);
    fixture.componentRef.setInput('site', site);
    fixture.componentRef.setInput('assessment', assessment);
    fixture.componentRef.setInput('plan', p);
    fixture.componentRef.setInput('previousOverall', previousOverall);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the strip, the next task with steps, and the THEN list', async () => {
    const fixture = await render(plan());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('41');
    expect(text).toContain('of 100');
    expect(text).toContain('Up 4 points since your last check');
    expect(text).toContain('DO THIS NEXT');
    expect(text).toContain('2 of 8 done · about 2 hours left');   // 20+45+30+15+15+15 = 140 -> 2 hours
    expect(text).toContain('See all 8');
    expect(text).toContain('BIGGEST WIN');
    expect(text).toContain('About 20 minutes');
    expect(text).toContain('Put your address and hours where machines can read them');
    expect(text).toContain('Open your SEO plugin settings in WordPress.');
    expect(text).toContain('HOW YOU KNOW IT WORKED');
    expect(text).toContain('I did this');
    expect(text).toContain('Skip for now');
    expect(text).toContain('THEN');
    expect(text).toContain('Write the one page that answers what people ask');
    expect(text).toContain('2 more');   // 6 open tasks - the current one - 3 shown
  });

  it('skip shows the following task and emits done with the task id', async () => {
    const fixture = await render(plan());
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll('button'));
    buttons().find((b) => b.textContent?.includes('Skip for now'))!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Write the one page that answers what people ask');
    expect(el.textContent).not.toContain('BIGGEST WIN');
    let emitted: string | null = null;
    fixture.componentInstance.done.subscribe((id) => (emitted = id));
    buttons().find((b) => b.textContent?.includes('I did this'))!.click();
    // `emitted` is reassigned inside the subscribe callback above; TypeScript's control-flow
    // analysis does not track writes made inside a nested closure, so it still narrows the read
    // below to the declaration-time literal `null`. The cast restores the true `string | null`
    // type so this compiles under the project's strict Jasmine typings.
    expect(emitted as string | null).toBe('T2');
  });

  it('shows the all-done card when no todo task is left', async () => {
    const p = plan();
    const fixture = await render({ ...p, tasks: p.tasks.map((t) => ({ ...t, status: 'done' as const })) }, null);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('You have done everything on your plan.');
    expect(text).toContain('Check again');
    expect(text).not.toContain('since your last check');
  });
});
