import { test, expect } from '@playwright/test';

// The landing page is pre-rendered, so a visitor can type into the hero field before the
// bundle hydrates the page. Hydration must keep that text (issue #27).
test('a URL typed before hydration stays in the landing form and reaches the preview', async ({ page }) => {
  test.setTimeout(60_000);
  const previewBodies: unknown[] = [];

  await page.route('**/v1/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'e2e_unmocked_route', message: route.request().url() }) }));
  await page.route(/\/v1\/me$/, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'unauthorized', message: 'Sign in.' }) }));
  await page.route(/\/v1\/preview$/, async (route) => {
    previewBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ domain: 'example.com', pagesChecked: 1, checks: [] }) });
  });
  // Each script arrives 3 s late, as on a slow network, so the visitor types before hydration.
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fallback();
  });

  await page.goto('/', { waitUntil: 'commit' });
  const input = page.getByLabel('Your website');
  await input.pressSequentially('example.com');

  // The server renders the button disabled. Only a hydrated page with a valid form enables it.
  const button = page.locator('#check').getByRole('button', { name: 'Check my site free' });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await expect(input).toHaveValue('example.com');

  await button.click();
  await expect(page.getByRole('heading', { name: 'What we found on example.com' })).toBeVisible();
  expect(previewBodies).toEqual([{ url: 'example.com' }]);
});
