import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ResultView } from './result-view';
import { AssessmentDto, PlanDto } from '../../core/api/types';

/** No-op routed target so provideRouter() has a real 'pricing' route to resolve hrefs against. */
@Component({ selector: 'result-view-spec-blank', template: '' })
class BlankPage {}

function assessment(): AssessmentDto {
  return {
    id: 'A1', siteId: 'S1', status: 'ready',
    scores: { seo: 62, aeo: 34, geo: 28, overall: 41 },
    summary: 'People searching Google for a bakery in Riverton can find you. People asking ChatGPT or Perplexity cannot.',
    scoreNotes: { seo: 'Indexed and titled well enough to rank.', aeo: 'Rarely pulled into the box at the top of results.', geo: 'Assistants have to guess your address and hours.' },
    pageCount: 18,
    findings: [
      { id: 'f-good', category: 'geo', severity: 'good', evidence: 'AI crawlers are allowed to read your site. Nothing to do here.', affectedPages: [] },
      { id: 'f-med', category: 'aeo', severity: 'medium', evidence: '14 of your 18 product pages give no price.', affectedPages: Array.from({ length: 14 }, (_, i) => `https://x/p${i}`) },
      { id: 'f-high', category: 'geo', severity: 'high', evidence: 'No page states your address.', affectedPages: [] },
      { id: 'f-one', category: 'seo', severity: 'low', evidence: 'One page has no title.', affectedPages: ['https://x/a'] },
    ],
    errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [], publicSlug: null,
  };
}
function plan(locked: boolean): PlanDto {
  const t = (i: number, title: string, impact: 'high' | 'medium' | 'low', minutes: number, steps: number, status: 'todo' | 'done' = 'todo') => ({
    taskId: `T${i}`, title, category: 'geo', impact, effortMinutes: minutes, stepCount: steps,
    whyItMatters: locked ? null : 'why', steps: locked ? null : Array(steps).fill('step'), doneCheck: locked ? null : 'check', status,
  });
  return { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked, progress: { done: 0, verified: 0, total: 8 }, tasks: [
    t(1, 'Put your address and hours where machines can read them', 'high', 20, 4), t(2, 'Write the one page that answers what people ask', 'high', 45, 6),
    t(3, 'Add prices to your shop pages', 'medium', 30, 3), t(4, 'A', 'low', 15, 1), t(5, 'B', 'low', 15, 1), t(6, 'C', 'low', 15, 1), t(7, 'D', 'low', 15, 1), t(8, 'E', 'low', 20, 1),
  ] };
}

async function render(tier: 'free' | 'pro', p: PlanDto | null) {
  await TestBed.configureTestingModule({
    imports: [ResultView],
    providers: [provideRouter([{ path: 'pricing', component: BlankPage }])],
  }).compileComponents();
  const fixture = TestBed.createComponent(ResultView);
  fixture.componentRef.setInput('assessment', assessment());
  fixture.componentRef.setInput('plan', p);
  fixture.componentRef.setInput('tier', tier);
  fixture.componentRef.setInput('siteId', 'S1');
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  return { text: compiled.textContent ?? '', compiled };
}

describe('ResultView', () => {
  it('shows the checked date, overall, band, summary, sub-scores and notes', async () => {
    const { text } = await render('free', plan(true));
    expect(text).toContain('CHECKED 28 JULY 2026');
    expect(text).toContain('41');
    expect(text).toContain('Needs work');
    expect(text).toContain('Visibility out of 100');
    expect(text).toContain('People asking ChatGPT or Perplexity cannot.');
    expect(text).toContain('Google search');
    expect(text).toContain('Indexed and titled well enough to rank.');
    expect(text).toContain('AI assistants');
  });

  it('sorts findings high, medium, low, good and captions the pages', async () => {
    const { text } = await render('free', plan(true));
    expect(text).toContain('4 things, across 3 areas');
    const hi = text.indexOf('No page states your address.');
    const med = text.indexOf('14 of your 18 product pages');
    const low = text.indexOf('One page has no title.');
    const good = text.indexOf('AI crawlers are allowed');
    expect(hi).toBeLessThan(med); expect(med).toBeLessThan(low); expect(low).toBeLessThan(good);
    expect(text).toContain('AI ASSISTANTS · AFFECTS EVERY PAGE');
    expect(text).toContain('ANSWER BOXES · 14 PAGES');
    expect(text).toContain('GOOGLE SEARCH · 1 PAGE');
    expect(text).toContain('FINE');
  });

  it('shows the NEXT teaser with the locked list for a free user', async () => {
    const { text, compiled } = await render('free', plan(true));
    expect(text).toContain('We wrote you eight things to fix, in order.');
    expect(text).toContain('About 3 hours of work in total.');
    expect(text).toContain('Read my plan');
    expect(text).toContain('Included with Pro, from $9 a month');
    expect(text).toContain('YOUR PLAN · 8 TASKS');
    expect(text).toContain('BIGGEST WIN');
    expect(text).toContain('4 steps · 20 min');
    expect(text).toContain('5 more');

    const readMyPlan = Array.from(compiled.querySelectorAll('a')).find((a) => a.textContent?.includes('Read my plan'));
    expect(readMyPlan?.getAttribute('href')).toBe('/pricing?site=S1');
  });

  it('shows the pro links instead of the teaser for a pro user', async () => {
    const { text } = await render('pro', plan(false));
    expect(text).not.toContain('Read my plan');
    expect(text).toContain('Do this next →');
    expect(text).toContain('See all 8 tasks');
  });
});
