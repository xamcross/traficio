import { test, expect } from '@playwright/test';

/**
 * Free-tier happy path, backend fully mocked with page.route.
 * Landing -> register -> log in -> the dashboard hand-off creates a site and runs a check ->
 * progress -> the site home result view -> the plan gate.
 *
 * Every /v1/** request is intercepted. A catch-all route fulfills any unmocked /v1/** request
 * with a distinctive 500 so a miss fails loudly instead of hanging or silently passing.
 */
test('signup, the dashboard hand-off runs a check, and the free result leads to the gate', async ({ page }) => {
  test.setTimeout(90_000);

  const state = {
    authenticated: false,
    siteCreated: false,
    assessmentSubmitted: false,
    assessmentReady: false,
  };

  const SCORES = { seo: 78, aeo: 61, geo: 48, overall: 65 };

  function userDto() {
    return { id: 'U1', email: 'jane@example.com', emailVerified: true, tier: 'free' };
  }

  function siteDto() {
    return {
      id: 'S1',
      domain: 'example.com',
      url: 'https://example.com',
      platform: null,
      latestScores: state.assessmentReady ? SCORES : null,
      readOnly: false,
      latestAssessment: state.assessmentSubmitted
        ? {
            id: 'A1',
            status: state.assessmentReady ? 'ready' : 'queued',
            createdAt: '2026-08-06T00:00:00.000Z',
            completedAt: state.assessmentReady ? '2026-08-06T00:05:00.000Z' : null,
          }
        : null,
      latestReadyAssessmentId: state.assessmentReady ? 'A1' : null,
    };
  }

  function assessmentDto() {
    return {
      id: 'A1',
      siteId: 'S1',
      status: state.assessmentReady ? 'ready' : 'queued',
      scores: state.assessmentReady ? SCORES : null,
      summary: state.assessmentReady ? 'People searching Google can find you. People asking ChatGPT cannot.' : null,
      scoreNotes: state.assessmentReady
        ? { seo: 'Your title tags are solid.', aeo: 'You have no FAQ page.', geo: 'AI assistants cannot find your hours.' }
        : null,
      findings: [] as unknown[],
      pageCount: state.assessmentReady ? 3 : null,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      completedAt: state.assessmentReady ? '2026-08-06T00:05:00.000Z' : null,
      changes: [] as unknown[],
    };
  }

  function lockedPlanDto() {
    return {
      id: 'P1',
      assessmentId: 'A1',
      siteId: 'S1',
      locked: true,
      tasks: [
        { taskId: 'T1', title: 'Add a title tag', category: 'seo', impact: 'high', effortMinutes: 10, stepCount: 2, whyItMatters: null, steps: null, doneCheck: null, status: 'todo' },
        { taskId: 'T2', title: 'Write a meta description', category: 'seo', impact: 'medium', effortMinutes: 15, stepCount: 2, whyItMatters: null, steps: null, doneCheck: null, status: 'todo' },
      ],
      progress: { done: 0, verified: 0, total: 2 },
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

  await page.route(/\/v1\/me\/usage$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ assessmentsUsed: 0, assessmentsLimit: 1, sitesUsed: 0, sitesLimit: 1, nextCheckAt: null }),
    });
  });

  await page.route(/\/v1\/sites$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sites: state.siteCreated ? [siteDto()] : [] }),
      });
    } else if (method === 'POST') {
      state.siteCreated = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(siteDto()) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/sites\/S1\/assessments$/, async (route) => {
    if (route.request().method() === 'POST') {
      state.assessmentSubmitted = true;
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(assessmentDto()) });
    } else {
      await route.fallback();
    }
  });

  // SSE: two status frames, then the response ends (no explicit terminator). The app's wrapper
  // treats that close as its cue to stop listening and re-fetch the assessment. A short delay
  // before the fulfill gives the progress page a real moment in its pre-stream "queued" state —
  // a fully mocked, zero-latency backend would otherwise race straight through every rail state
  // to "ready" before the assertion below has a chance to observe any of them.
  await page.route(/\/v1\/assessments\/A1\/events$/, async (route) => {
    state.assessmentReady = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"status":"crawling"}\n\ndata: {"status":"planning"}\n\n',
    });
  });

  await page.route(/\/v1\/assessments\/A1$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assessmentDto()) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/assessments\/A1\/plan$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lockedPlanDto()) });
    } else {
      await route.fallback();
    }
  });

  await page.route(/\/v1\/sites\/S1\/plan$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lockedPlanDto()) });
    } else {
      await route.fallback();
    }
  });

  // --- 1. Landing: type a URL and start the journey ---
  await page.goto('/');
  await page.getByLabel('Your website').fill('example.com');
  await page.getByRole('button', { name: 'Check my site free' }).click();
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

  // --- 4. Dashboard hand-off: login lands on /dashboard, and the pending URL from the landing
  // page creates the site and starts the first check on its own, with no extra click on this
  // page. Against a mocked backend the hand-off itself is too fast to catch mid-flight, so we
  // wait directly for its destination rather than pin the transient /dashboard URL. ---
  await expect(page).toHaveURL(/\/assessments\/A1\/progress$/, { timeout: 15_000 });

  // --- 5. Progress: the rail narrates the SSE frames. The delay above holds the page in its
  // pre-stream "queued" state long enough to observe; the regex also allows the first SSE
  // frame's text, both real content from progress.ts, so the assertion stays accurate even if
  // the timing shifts. ---
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Finding your site…|Reading your pages…/);

  // --- 6. Auto-navigates to the site home once ready (after the progress page's 1.5s beat) ---
  await expect(page).toHaveURL(/\/sites\/S1$/, { timeout: 15_000 });
  await expect(page.getByText('Visibility out of 100')).toBeVisible();
  await expect(page.getByText('Read my plan')).toBeVisible();

  // --- 7. The Free result view's teaser leads to the plan gate ---
  await page.getByRole('link', { name: 'Read my plan' }).click();
  await expect(page).toHaveURL(/\/pricing\?site=S1$/);
  await expect(page.getByText('YOUR PLAN IS READY')).toBeVisible();
});
