import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-score-dial',
  template: `
    <figure class="dial">
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" [attr.aria-label]="label() + ' score ' + value()">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#eee" stroke-width="10" />
        <circle cx="60" cy="60" r="54" fill="none" [attr.stroke]="color()" stroke-width="10"
                stroke-linecap="round" [attr.stroke-dasharray]="C" [attr.stroke-dashoffset]="offset()"
                transform="rotate(-90 60 60)" />
        <text x="60" y="66" text-anchor="middle" font-size="28">{{ value() }}</text>
      </svg>
      <figcaption>{{ label() }}</figcaption>
    </figure>`,
})
export class ScoreDial {
  label = input.required<string>();
  value = input.required<number>();
  readonly C = 2 * Math.PI * 54;
  offset = computed(() => this.C * (1 - Math.min(100, Math.max(0, this.value())) / 100));
  color = computed(() => this.value() >= 70 ? '#1b873f' : this.value() >= 40 ? '#b58900' : '#b3261e');
}
