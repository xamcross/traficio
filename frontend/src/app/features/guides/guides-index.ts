import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';

interface GuideLink {
  path: string;
  title: string;
  summary: string;
}

@Component({
  selector: 'app-guides-index',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface guides-index">
      <div class="intro stack">
        <span class="eyebrow">GUIDES</span>
        <h1>Plain-language guides to being found online.</h1>
        <p class="lead">
          No jargon, no hype, and nothing we cannot back up. Five short guides on the questions we
          hear most from people who run one website.
        </p>
      </div>

      <div class="guide-list">
        @for (guide of guides; track guide.path) {
          <div class="guide-card card-soft">
            <a class="guide-link" [routerLink]="guide.path">
              <h2>{{ guide.title }}</h2>
              <p class="muted">{{ guide.summary }}</p>
              <span class="mono faint small">READ THE GUIDE →</span>
            </a>
          </div>
        }
      </div>

      <app-site-footer />
    </div>
  `,
  styles: `
    .guides-index { display: flex; flex-direction: column; gap: 40px; padding-top: 56px; padding-bottom: 64px; }
    .intro { max-width: 58ch; margin: 0 auto; align-items: center; text-align: center; gap: 14px; }
    .intro h1 { font-size: 36px; letter-spacing: -0.03em; }
    .lead { font-size: 17px; line-height: 1.6; color: var(--body-long); }
    .guide-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .guide-card { padding: 26px 28px; }
    .guide-link { display: flex; flex-direction: column; gap: 10px; color: inherit; }
    .guide-link h2 { font-size: 19px; }
    .guide-link p { line-height: 1.5; }
    .small { font-size: 12px; }
    @media (max-width: 760px) { .guide-list { grid-template-columns: 1fr; } }
  `,
})
export class GuidesIndex {
  protected readonly guides: GuideLink[] = [
    {
      path: '/guides/why-ai-cannot-find-your-website',
      title: 'Why AI cannot find your website',
      summary:
        'The most common reasons ChatGPT and other AI assistants cannot see your business, and what to check first.',
    },
    {
      path: '/guides/what-seo-costs-a-small-business',
      title: 'What SEO costs a small business',
      summary:
        'What agencies charge, what that buys, what you can do yourself for nothing, and where a $9 tool fits.',
    },
    {
      path: '/guides/geo-aeo-and-ai-visibility-explained',
      title: 'GEO, AEO and AI visibility explained',
      summary:
        'A plain 2026 definition of three overlapping terms, and why the industry has not settled on one word.',
    },
    {
      path: '/guides/is-your-site-readable-by-chatgpt',
      title: 'Is your site readable by ChatGPT?',
      summary:
        'A five-minute way to see your site the way a crawler sees it, plus what each AI crawler does.',
    },
    {
      path: '/guides/the-beginners-seo-checklist',
      title: "The beginner's SEO checklist",
      summary: 'Seven plain steps, in order, for someone who has never done this before.',
    },
  ];
}
