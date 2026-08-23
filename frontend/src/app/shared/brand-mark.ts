import { Component, input } from '@angular/core';

/**
 * The brand mark: three inbound strokes that arrive at one solid point. It says
 * that traffic, from a crawler and from a person, reaches the client's site.
 *
 * The geometry here matches `public/logo.svg`, the file every icon comes from.
 * Change one and change the other.
 *
 * The mark is decorative in every place it appears, because the brand name sits
 * next to it as text. So it stays out of the accessibility tree.
 */
@Component({
  selector: 'app-brand-mark',
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 48 48"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="48" height="48" rx="11" fill="#b4552f" />
    <g fill="none" stroke="#efe7db" stroke-width="4.8" stroke-linecap="round">
      <line x1="10.2" y1="12.4" x2="19" y2="15.4" />
      <line x1="9.6" y1="24" x2="21.6" y2="24" />
      <line x1="10.2" y1="35.6" x2="19" y2="32.6" />
    </g>
    <circle cx="33.8" cy="24" r="7.4" fill="#efe7db" />
  </svg>`,
  styles: `:host { display: inline-flex; }`,
})
export class BrandMark {
  size = input(20);
}
