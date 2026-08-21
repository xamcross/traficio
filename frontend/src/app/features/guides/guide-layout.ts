import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';

/**
 * The shared shell for every guide page: a back link, a readable content
 * column, and the site footer. Each guide component projects its own
 * heading and body into this shell, so the layout and the reading measure
 * stay the same across all five guides without repeating styles.
 */
@Component({
  selector: 'app-guide-layout',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface guide-page">
      <a routerLink="/guides" class="back muted">← All guides</a>
      <article class="guide">
        <span class="eyebrow">GUIDE</span>
        <ng-content />
      </article>
      <app-site-footer />
    </div>
  `,
  styles: `
    .guide-page { padding-top: 44px; padding-bottom: 60px; }
    .back { display: inline-block; font-size: 14px; margin-bottom: 28px; }
    .guide { max-width: 70ch; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    .guide h1 { font-size: 34px; letter-spacing: -0.03em; line-height: 1.15; margin-top: 4px; }
    .guide h2 { font-size: 21px; margin-top: 14px; }
    .guide .lead { font-size: 18px; line-height: 1.6; color: var(--body-long); }
    .guide p { line-height: 1.75; color: var(--body-long); }
    .guide ul, .guide ol { padding-left: 22px; display: flex; flex-direction: column; gap: 10px; line-height: 1.7; color: var(--body-long); }
    .guide li::marker { color: var(--faint-2); }
    .guide strong { color: var(--ink); }
    @media (max-width: 760px) {
      .guide-page { padding-top: 24px; }
      .guide h1 { font-size: 27px; }
    }
  `,
})
export class GuideLayout {}
