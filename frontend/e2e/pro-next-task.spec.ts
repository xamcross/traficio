import { test, expect } from '@playwright/test';

test('pro user sees the next task, marks it done, and the following task appears', async ({ page }) => {
  test.setTimeout(60_000);
  const user = { id: 'U1', email: 'dana@rivertonbakery.com', emailVerified: true, tier: 'pro' };
  const scores = { seo: 62, aeo: 34, geo: 28, overall: 41 };
  const assessment = { id: 'A1', siteId: 'S1', status: 'ready', scores, summary: 'Summary.', scoreNotes: { seo: 'a', aeo: 'b', geo: 'c' }, findings: [], pageCount: 18, errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [] };
  const site = { id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: scores, readOnly: false, latestAssessment: { id: 'A1', status: 'ready', createdAt: assessment.createdAt, completedAt: assessment.completedAt }, latestReadyAssessmentId: 'A1' };
  const task = (id: string, title: string, minutes: number, status: string) => ({ taskId: id, title, category: 'geo', impact: 'high', effortMinutes: minutes, stepCount: 2, whyItMatters: 'Because.', steps: ['Open the settings.', 'Save.'], doneCheck: 'Look at the page.', status });
  const plan = { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked: false, progress: { done: 0, verified: 0, total: 2 }, tasks: [task('T1', 'Put your address and hours where machines can read them', 20, 'todo'), task('T2', 'Write the one page that answers what people ask', 45, 'todo')] };

  await page.route('**/v1/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'e2e_unmocked_route', message: route.request().url() }) }));
  await page.route(/\/v1\/me$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route(/\/v1\/sites$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [site] }) }));
  await page.route(/\/v1\/assessments\/A1$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assessment) }));
  await page.route(/\/v1\/assessments\/A1\/plan$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) }));
  await page.route(/\/v1\/sites\/S1\/assessments$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assessments: [assessment] }) }));
  await page.route(/\/v1\/plans\/P1\/tasks\/T1$/, (route) => {
    plan.tasks[0].status = 'done';
    plan.progress.done = 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) });
  });

  await page.goto('/sites/S1');
  await expect(page.getByText('DO THIS NEXT')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Put your address and hours where machines can read them' })).toBeVisible();
  await page.getByRole('button', { name: 'I did this' }).click();
  await expect(page.getByRole('heading', { name: 'Write the one page that answers what people ask' })).toBeVisible();
  await expect(page.getByText('1 of 2 done')).toBeVisible();

  await page.getByRole('link', { name: 'See all 2' }).click();
  await expect(page).toHaveURL(/\/assessments\/A1\/plan$/);
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
});
