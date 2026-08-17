import { Component, computed, input } from '@angular/core';
import { severityLabel } from './copy';

const CLASS: Record<string, string> = { high: 'badge-high', medium: 'badge-mid', low: 'badge-low' };

@Component({
  selector: 'app-impact-badge',
  template: `<span [class]="'badge ' + cls()">{{ label() }}</span>`,
})
export class ImpactBadge {
  impact = input.required<string>();
  protected readonly label = computed(() => severityLabel(this.impact()));
  protected readonly cls = computed(() => CLASS[this.impact()] ?? 'badge-low');
}
