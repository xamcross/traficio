import { test, expect } from '@playwright/test';

// A deploy removes the lazy chunks of the previous build. A tab that stayed open still runs the
// old main bundle, and its next lazy route asks for a chunk that now answers 404.
test('a tab from an old deploy opens the pricing page when its lazy chunk is gone', async ({ page }) => {
  test.setTimeout(60_000);
  const user = { id: 'U1', email: 'dana@rivertonbakery.com', emailVerified: true, tier: 'free' };
  const usage = { assessmentsUsed: 1, assessmentsLimit: 1, sitesUsed: 1, sitesLimit: 1, nextCheckAt: null };
  const site = { id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false, latestAssessment: { id: 'A1', status: 'ready', createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z' }, latestReadyAssessmentId: 'A1' };

  await page.route('**/v1/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'e2e_unmocked_route', message: route.request().url() }) }));
  await page.route(/\/v1\/me$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route(/\/v1\/me\/usage$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage) }));
  await page.route(/\/v1\/sites$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [site] }) }));

  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Unlock my plan' })).toBeVisible();

  // The deploy: the next chunk that the open tab asks for is gone.
  await page.route(/\/chunk-[^/?]+\.js(\?.*)?$/, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' }), { times: 1 });
  const newDocument = page.waitForRequest((r) => r.resourceType() === 'document' && /\/pricing\?site=S1$/.test(r.url()), { timeout: 15_000 });

  await page.getByRole('button', { name: 'Unlock my plan' }).click();

  await newDocument;
  await expect(page).toHaveURL(/\/pricing\?site=S1$/);
  await expect(page.getByRole('heading', { name: 'Your score is free. The plan is $9 a month.' })).toBeVisible();
});
