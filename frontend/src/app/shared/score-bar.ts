import { Component, computed, input } from '@angular/core';
import { bandFor } from './copy';

@Component({
  selector: 'app-score-bar',
  template: `<div class="bar" role="img" [attr.aria-label]="'Score ' + value() + ' of 100'" [style.width.px]="width()">
    <div [class]="'bar-fill tone-' + tone()" [style.width.%]="clamped()"></div>
  </div>`,
})
export class ScoreBar {
  value = input.required<number>();
  width = input<number | null>(null);
  protected readonly clamped = computed(() => Math.min(100, Math.max(0, this.value())));
  protected readonly tone = computed(() => bandFor(this.value()).tone);
}
