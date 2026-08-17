import { Component, computed, input } from '@angular/core';
import { severityLabel } from './copy';

const CLASS: Record<string, string> = { high: 'badge-high', medium: 'badge-mid', low: 'badge-low', good: 'badge-good' };

@Component({
  selector: 'app-severity-badge',
  template: `<span [class]="'badge ' + cls()">{{ label() }}</span>`,
})
export class SeverityBadge {
  severity = input.required<string>();
  protected readonly label = computed(() => severityLabel(this.severity()));
  protected readonly cls = computed(() => CLASS[this.severity()] ?? 'badge-low');
}
