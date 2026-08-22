import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PreviewDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { StructuredData } from '../../core/seo/structured-data';
import { severityOrder } from '../../shared/copy';
import { ScoreBar } from '../../shared/score-bar';
import { SeverityBadge } from '../../shared/severity-badge';
import { SiteFooter } from '../../shared/site-footer';

/** State of the ungated preview that runs in place after the hero form submits. */
type PreviewState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'rate_limited'
  | 'bad_url'
  | 'site_unreachable'
  | 'robots_blocked'
  | 'error';

@Component({
  selector: 'app-landing',
  imports: [ReactiveFormsModule, RouterLink, ScoreBar, SeverityBadge, SiteFooter],
  template: `
    <div class="page surface landing">
      <section class="hero">
        <span class="eyebrow">FOR PEOPLE WHO RUN ONE WEBSITE</span>
        <h1>Your customers ask AI. Does it know you exist?</h1>
        <p class="lead">People used to search. Now they ask ChatGPT for a bakery near them, and it answers with somebody. We check whether that somebody is you, and tell you what to fix.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" class="hero-form" id="check">
          <label class="sr-only" for="url">Your website</label>
          <input id="url" type="text" formControlName="url" placeholder="yourbusiness.com" autocomplete="url" />
          <button type="submit" class="btn btn-primary" [disabled]="form.invalid || previewState() === 'loading'">Check my site free</button>
          <span class="faint small">Two minutes. No card. Your score and every problem, free.</span>
        </form>
      </section>

      @if (previewState() !== 'idle') {
        <section class="preview stack divider" aria-live="polite">
          @switch (previewState()) {
            @case ('loading') {
              <div class="stack tight">
                <h2>Reading your pages…</h2>
                <p class="muted">This takes a few seconds. We read your pages the way an AI crawler does.</p>
              </div>
            }
            @case ('success') {
              @if (previewResult(); as r) {
                <div class="stack tight">
                  <span class="eyebrow">QUICK LOOK</span>
                  <h2>What we found on {{ r.domain }}</h2>
                  <p class="muted">We read {{ r.pagesChecked }} {{ r.pagesChecked === 1 ? 'page' : 'pages' }}, the way an AI crawler does. This is not your score — the full check works that out.</p>
                </div>
                @if (sortedChecks().length === 0) {
                  <p class="muted">We did not find anything to flag on the pages we read.</p>
                } @else {
                  <div class="divider preview-checks">
                    @for (c of sortedChecks(); track c.id) {
                      <div class="row check" [class.good]="c.severity === 'good'">
                        <app-severity-badge [severity]="c.severity" />
                        <p class="evidence">{{ c.description }}</p>
                      </div>
                    }
                  </div>
                }
                <div class="card cta-card stack">
                  <p class="promise">The full check adds your score, the rest of the findings, and your plan to fix them.</p>
                  <p class="muted">It is free to start.</p>
                  <a class="btn btn-primary" routerLink="/signup">Create my free account</a>
                </div>
              }
            }
            @case ('rate_limited') {
              <div class="note-box stack tight">
                <p>You have used your three free previews for this hour.</p>
                <p class="muted">Create an account to keep checking your site.</p>
                <a class="btn btn-primary" routerLink="/signup">Create my free account</a>
              </div>
            }
            @case ('bad_url') {
              <p class="error-note" role="alert">That address does not look right. Check it above and try again.</p>
            }
            @case ('site_unreachable') {
              <p class="error-note" role="alert">We could not reach that address. Check it and try again.</p>
            }
            @case ('robots_blocked') {
              <p class="error-note" role="alert">That site asks crawlers to stay out, so we can't read it.</p>
            }
            @case ('error') {
              <p class="error-note" role="alert">Something went wrong on our side. Try again.</p>
            }
          }
        </section>
      }

      <section class="steps divider">
        <div><span class="mono step-no">01</span><h3>You give us your web address</h3><p>Nothing to install, no password to your site, no plugin. We only read the pages anyone can see.</p></div>
        <div><span class="mono step-no">02</span><h3>We read it the way machines do</h3><p>Then we score how findable you are in Google, in answer boxes, and inside AI assistants — and list what is holding you back.</p></div>
        <div><span class="mono step-no">03</span><h3>You fix one thing at a time</h3><p>We show you the single biggest win, with steps you can follow yourself, then confirm it worked at your next check.</p></div>
      </section>

      <section class="explainer stack divider">
        <span class="eyebrow">YOUR SCORE</span>
        <h2>One score, three parts</h2>
        <p>Your score is one number out of 100, made from three checks: Google, for how well search engines can find and rank you; Answers, for whether the answer box above the results can quote you directly; and AI, for whether ChatGPT, Claude and the rest can read your page at all.</p>
        <p>Most AI crawlers read the plain HTML of a page and do not run JavaScript. Google can run it, but only on a separate, later pass. If your address or your hours only appear after a script runs, an AI assistant never sees them.</p>
      </section>

      <section class="card free-card two-col">
        <div class="stack">
          <span class="eyebrow">WHAT YOU GET FREE</span>
          <p class="promise">Your score and every problem we find. No card, no trial clock.</p>
          <p class="muted">The step-by-step plan that fixes them is {{ price }} a month. You will know exactly what is in it before you decide.</p>
        </div>
        <div class="example stack">
          <div class="row"><span class="example-score">41</span><span class="tone-low semi">Needs work</span></div>
          <app-score-bar [value]="41" />
          <div class="row example-subs">
            <div><span class="faint small">Google</span><strong>62</strong></div>
            <div><span class="faint small">Answers</span><strong>34</strong></div>
            <div><span class="faint small">AI</span><strong>28</strong></div>
          </div>
          <span class="mono faint small">EXAMPLE RESULT, FREE TIER</span>
        </div>
      </section>

      <section class="faq stack divider">
        <span class="eyebrow">FAQ</span>
        <h2>Questions people ask</h2>
        <div class="faq-item">
          <h3>Why doesn't my website show up when someone asks ChatGPT?</h3>
          <p>Most AI assistants use a crawler — GPTBot for ChatGPT, ClaudeBot for Claude, PerplexityBot for Perplexity — that reads the plain HTML of your page and does not run JavaScript. If your address or your hours only appear after a script runs, that crawler never sees them.</p>
        </div>
        <div class="faq-item">
          <h3>Is this the same as SEO?</h3>
          <p>Not quite. SEO is mostly about ranking in Google's list of links. Answer boxes and AI assistants care more about plain facts on the page, written as text a machine can read. We check both.</p>
        </div>
        <div class="faq-item">
          <h3>What do you actually look at?</h3>
          <p>Your public pages, read the way a crawler reads them: whether your address, hours and prices are there in text, and whether a page answers a real question near the top.</p>
        </div>
        <div class="faq-item">
          <h3>Do I have to install anything, or give you my password?</h3>
          <p>No. Type your web address and we check the pages anyone can already see — no login, no plugin, nothing added to your site. That is the same access an AI crawler has.</p>
        </div>
        <div class="faq-item">
          <h3>How is this different from hiring an agency?</h3>
          <p>Agencies commonly quote $1,000 to $5,000 a month and hand you a strategy document. We give you the score and every finding free, and a step-by-step plan for {{ price }} a month — plain steps, not a strategy meeting.</p>
        </div>
        <div class="faq-item">
          <h3>What do I get without paying?</h3>
          <p>Your score, split into Google, Answers and AI, and every problem we find, explained in plain words. That is free. You only pay if you want the step-by-step plan, the re-check, and your score history.</p>
        </div>
        <div class="faq-item">
          <h3>How long does a check take?</h3>
          <p>About two minutes, from typing your address to seeing your score.</p>
        </div>
      </section>

      <app-site-footer />
    </div>
  `,
  styles: `
    .landing { padding-top: 0; }
    .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px; padding: 84px 0 76px; }
    .hero h1 { font-size: 54px; letter-spacing: -0.035em; line-height: 1.08; max-width: 20ch; }
    .lead { font-size: 19px; line-height: 1.6; color: var(--body-long); max-width: 50ch; }
    .hero-form { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; max-width: 480px; margin-top: 18px; }
    .hero-form input { text-align: center; font-size: 17px; }
    .hero-form .btn { width: 100%; font-size: 17px; padding: 17px 0; }
    .steps { display: flex; gap: 40px; padding: 38px 0 46px; }
    .steps > div { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .steps > div + div { border-left: 1px solid var(--line); padding-left: 40px; }
    .step-no { font-size: 13px; font-weight: 700; color: var(--faint-2); }
    .steps h3 { font-size: 21px; }
    .steps p { color: var(--body-long); }
    .promise { font-size: 20px; font-weight: 600; color: var(--ink); max-width: 28ch; }
    .example { width: 320px; flex-shrink: 0; padding-left: 40px; border-left: 1px solid var(--line); }
    .example-score { font-size: 44px; font-weight: 700; color: var(--ink); letter-spacing: -0.04em; line-height: 1; }
    .semi { font-weight: 600; }
    .example-subs { gap: 20px; } .example-subs div { display: flex; flex-direction: column; } .example-subs strong { color: var(--ink); }
    .small { font-size: 13px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .explainer, .faq { padding: 38px 0 46px; }
    .explainer h2, .faq h2 { font-size: 30px; letter-spacing: -0.03em; }
    .explainer p, .faq-item p { color: var(--body-long); line-height: 1.6; max-width: 68ch; }
    .faq-item { display: flex; flex-direction: column; gap: 6px; }
    .faq-item + .faq-item { margin-top: 22px; }
    .faq-item h3 { font-size: 17px; }
    .preview { padding: 0 0 46px; max-width: 640px; margin: 0 auto; }
    .preview h2 { font-size: 24px; letter-spacing: -0.02em; }
    .tight { gap: 6px; }
    .preview-checks .check { gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--line); align-items: flex-start; }
    .preview-checks .check.good .evidence { color: var(--muted); }
    .evidence { font-size: 16px; line-height: 1.55; color: var(--ink); margin: 0; }
    .cta-card { margin-top: 8px; align-items: flex-start; gap: 10px; }
    .cta-card .btn { margin-top: 6px; }
    @media (max-width: 760px) { .hero h1 { font-size: 36px; } .steps { flex-direction: column; } .steps > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 24px; } .example { width: 100%; padding-left: 0; border-left: none; } .explainer h2, .faq h2 { font-size: 24px; } }
  `,
})
export class Landing {
  private store = inject(UserStore);
  private router = inject(Router);
  private api = inject(ApiClient);
  protected readonly price = PRO_PRICE_LABEL;

  constructor() {
    // Runs during the pre-render as well as in the browser, so the JSON-LD block
    // lands in the static HTML that a crawler reads without JavaScript.
    inject(StructuredData).writeLandingBlock();
  }

  protected readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly previewState = signal<PreviewState>('idle');
  protected readonly previewResult = signal<PreviewDto | null>(null);
  protected readonly sortedChecks = computed(() => {
    const result = this.previewResult();
    return result ? [...result.checks].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)) : [];
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const { url } = this.form.getRawValue();
    const trimmed = url.trim();
    sessionStorage.setItem(PENDING_URL_KEY, trimmed);
    if (this.store.user()) {
      void this.router.navigateByUrl('/dashboard');
      return;
    }
    void this.runPreview(trimmed);
  }

  private async runPreview(url: string): Promise<void> {
    this.previewState.set('loading');
    this.previewResult.set(null);
    try {
      const result = await this.api.preview(url);
      this.previewResult.set(result);
      this.previewState.set('success');
    } catch (e) {
      this.previewState.set(Landing.stateForError(e));
    }
  }

  /**
   * Picks the preview state for a failed check. The backend's error code names the real
   * cause for the two most likely failures, so we branch on the code first and fall back to
   * the status only for the cases the code does not cover.
   */
  private static stateForError(e: unknown): PreviewState {
    if (!(e instanceof ApiError)) return 'error';
    if (e.code === 'site_unreachable') return 'site_unreachable';
    if (e.code === 'robots_blocked') return 'robots_blocked';
    if (e.status === 429) return 'rate_limited';
    if (e.status === 400) return 'bad_url';
    return 'error';
  }
}
