import { test, expect } from '@playwright/test';

/**
 * Single happy-path journey through the whole app, backend fully mocked with page.route.
 * Landing -> register -> log in -> add a site -> run a check -> report -> plan -> complete a task.
 *
 * Every /v1/** request is intercepted. A catch-all route fulfills any unmocked /v1/** request
 * with a distinctive 500 so a miss fails loudly instead of hanging or silently passing.
 */
test('signup, add a site, run a check, view the report, complete a plan task', async ({ page }) => {
  test.setTimeout(90_000);

  const state = {
    authenticated: false,
    assessmentReady: false,
    plan: {
      id: 'PLAN1',
      assessmentId: 'A1',
      siteId: 'S1',
      tasks: [
        {
          taskId: 'T1',
          title: 'Add a title tag',
          category: 'SEO',
          impact: 'high',
          effortMinutes: 10,
          whyItMatters: 'Search engines use the title to understand your page.',
          steps: ['Open your homepage HTML.', 'Add a <title> tag inside <head>.'],
          doneCheck: 'View source and confirm the <title> tag is present.',
          status: 'todo' as const,
        },
        {
          taskId: 'T2',
          title: 'Write a meta description',
          category: 'SEO',
          impact: 'medium',
          effortMinutes: 15,
          whyItMatters: 'A good description improves click-through from search results.',
          steps: ['Write a one or two sentence summary.', 'Add it as a meta description tag.'],
          doneCheck: 'View source and confirm the meta description is present.',
          status: 'todo' as const,
        },
      ],
      progress: { done: 0, verified: 0, total: 2 },
    },
  };

  function userDto() {
    return { id: 'U1', email: 'jane@example.com', emailVerified: true, tier: 'free' };
  }

  function assessmentDto() {
    return {
      id: 'A1',
      siteId: 'S1',
      status: state.assessmentReady ? 'ready' : 'queued',
      scores: state.assessmentReady ? { seo: 82, aeo: 65, geo: 47 } : null,
      findings: [] as unknown[],
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      completedAt: state.assessmentReady ? '2026-08-06T00:05:00.000Z' : null,
    };
  }

  // Catch-all first (lowest precedence — later-registered routes below override it): fail loudly
  // on any /v1/** request this test forgot to mock.
  await page.route('**/v1/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'e2e_unmocked_route',
        message: `Unmocked route in happy-path e2e: ${route.request().method()} ${route.request().url()}`,
      }),
    });
  });

  await page.route(/\/v1\/auth\/register$/, async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route(/\/v1\/auth\/login$/, async (route) => {
    state.authenticated = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userDto()) });
  });

  await page.route(/\/v1\/me$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (state.authenticated) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userDto()) });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unauthenticated', message: 'Log in to continue.' }),
      });
    }
  });

  await page.route(/\/v1\/sites$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [] }) });
    } else if (method === 'POST') {
      const site = { id: 'S1', domain: 'example.com', url: 'https://example.com', platform: null, latestScores: null, readOnly: false };
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(site) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/sites\/[^/]+\/assessments$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(assessmentDto()) });
    } else {
      await route.fallback();
    }
  });

  // SSE: two status frames, then the response ends (no explicit terminator). The app's wrapper
  // treats that close as its cue to stop listening and re-fetch the assessment.
  await page.route(/\/v1\/assessments\/A1\/events$/, async (route) => {
    state.assessmentReady = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"status":"crawling"}\n\ndata: {"status":"planning"}\n\n',
    });
  });

  await page.route(/\/v1\/assessments\/A1\/plan$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.plan) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/assessments\/A1$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assessmentDto()) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/plans\/PLAN1\/tasks\/T1$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { status: 'todo' | 'done' };
      const task = state.plan.tasks.find((t) => t.taskId === 'T1')!;
      task.status = body.status;
      state.plan.progress.done = state.plan.tasks.filter((t) => t.status === 'done').length;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.plan) });
    } else {
      await route.fallback();
    }
  });

  // --- 1. Landing: type a URL and start the journey ---
  await page.goto('/');
  await page.getByLabel('Your website').fill('example.com');
  await page.getByRole('button', { name: 'Check my site' }).click();
  await expect(page).toHaveURL(/\/signup$/);

  // --- 2. Register ---
  await page.getByLabel('Email').fill('jane@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByText('Check your email. We sent you a link. Click the link to confirm your address.'),
  ).toBeVisible();

  // --- 3. Log in --- (two "Log in" links are visible here: the header nav and this panel; the
  // panel's link renders after the header in the DOM, so it is the last match)
  await page.locator('a', { hasText: 'Log in' }).last().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill('jane@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Add a site')).toBeVisible();

  // --- 4. Dashboard: add-site input is pre-filled from the pending URL; submit it ---
  await expect(page.getByLabel('Website')).toHaveValue('example.com');
  await page.getByRole('button', { name: 'Add site' }).click();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();

  // --- 5. Run a check; SSE narrates progress ---
  // The "crawling"/"planning" narration text is only shown for the moment the SSE frame is the
  // current status, which — with a fully mocked, zero-latency backend — can flash by faster than
  // an assertion poll can catch (both frames land in the same fulfilled response and the app can
  // race straight through to "ready" before the next check). The progress rail's step labels are
  // real content from progress.ts's STEPS list, and they stay in the DOM for as long as we're on
  // the progress page, so asserting on one of them is not racy the way the narration text is.
  await page.getByRole('button', { name: 'Check my site' }).click();
  await expect(page).toHaveURL(/\/assessments\/A1\/progress$/);
  await expect(page.getByText('crawling', { exact: true })).toBeVisible();

  // --- 6. Auto-navigates to the report once ready (after the progress page's 1.5s "Done!" beat) ---
  await expect(page).toHaveURL(/\/assessments\/A1\/report$/, { timeout: 10_000 });
  await expect(page.getByText('SEO', { exact: true })).toBeVisible();
  await expect(page.getByText('AEO', { exact: true })).toBeVisible();
  await expect(page.getByText('GEO', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'See my plan' }).click();

  // --- 7. Plan: check off the first task ---
  await expect(page).toHaveURL(/\/assessments\/A1\/plan$/);
  await expect(page.getByText('You finished 0 of 2 tasks.')).toBeVisible();
  await page.locator('article.task').first().getByRole('checkbox').check();
  await expect(page.getByText('You finished 1 of 2 tasks.')).toBeVisible();
});
