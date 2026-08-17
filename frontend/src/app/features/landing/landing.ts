import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { ScoreBar } from '../../shared/score-bar';

@Component({
  selector: 'app-landing',
  imports: [ReactiveFormsModule, RouterLink, ScoreBar],
  template: `
    <div class="page surface landing">
      <section class="hero">
        <span class="eyebrow">FOR PEOPLE WHO RUN ONE WEBSITE</span>
        <h1>Your customers ask AI. Does it know you exist?</h1>
        <p class="lead">People used to search. Now they ask ChatGPT for a bakery near them, and it answers with somebody. We check whether that somebody is you, and tell you what to fix.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" class="hero-form" id="check">
          <label class="sr-only" for="url">Your website</label>
          <input id="url" type="text" formControlName="url" placeholder="yourbusiness.com" autocomplete="url" />
          <button type="submit" class="btn btn-primary" [disabled]="form.invalid">Check my site free</button>
          <span class="faint small">Two minutes. No card. Your score and every problem, free.</span>
        </form>
      </section>

      <section class="steps divider">
        <div><span class="mono step-no">01</span><h3>You give us your web address</h3><p>Nothing to install, no password to your site, no plugin. We only read the pages anyone can see.</p></div>
        <div><span class="mono step-no">02</span><h3>We read it the way machines do</h3><p>Then we score how findable you are in Google, in answer boxes, and inside AI assistants — and list what is holding you back.</p></div>
        <div><span class="mono step-no">03</span><h3>You fix one thing at a time</h3><p>We show you the single biggest win, with steps you can follow yourself, then confirm it worked at your next check.</p></div>
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

      <footer class="site-footer divider">
        <span class="brand-faint">GEOSTRATEGY</span>
        <span class="spacer"></span>
        <a routerLink="/pricing">Pricing</a><a routerLink="/terms">Terms</a><a routerLink="/privacy">Privacy</a>
      </footer>
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
    .site-footer { display: flex; align-items: center; gap: 24px; padding: 26px 0 0; margin-top: 46px; }
    .site-footer a { color: var(--muted); font-size: 14px; }
    .brand-faint { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--faint-2); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 760px) { .hero h1 { font-size: 36px; } .steps { flex-direction: column; } .steps > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 24px; } .example { width: 100%; padding-left: 0; border-left: none; } }
  `,
})
export class Landing {
  private store = inject(UserStore);
  private router = inject(Router);
  protected readonly price = PRO_PRICE_LABEL;

  protected readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const { url } = this.form.getRawValue();
    sessionStorage.setItem(PENDING_URL_KEY, url.trim());
    void this.router.navigateByUrl(this.store.user() ? '/dashboard' : '/signup');
  }
}
