import { Component, input } from '@angular/core';
import { PlanDto } from '../../core/api/types';

@Component({
  selector: 'app-locked-plan-list',
  template: `
    <div class="locked card-soft">
      <div class="row head"><span class="mono faint tiny">YOUR PLAN · {{ plan().tasks.length }} TASKS</span><span class="spacer"></span><span class="mono faint tiny">LOCKED</span></div>
      @for (task of plan().tasks.slice(0, 3); track task.taskId; let i = $index) {
        <div class="row item">
          <span class="box" aria-hidden="true"></span>
          <span class="title">{{ task.title }}</span>
          @if (i > 0) {<span class="muted tiny">{{ task.effortMinutes }} min</span>}
        </div>
        @if (i === 0) {
          <div class="row sub"><span class="badge badge-high">BIGGEST WIN</span><span class="muted tiny">{{ task.stepCount }} steps · {{ task.effortMinutes }} min</span></div>
        }
      }
      @if (plan().tasks.length > 3) {
        <div class="row item more"><span class="box" aria-hidden="true"></span><span class="title">{{ plan().tasks.length - 3 }} more</span></div>
      }
    </div>
  `,
  styles: `
    .locked { width: 400px; max-width: 100%; overflow: hidden; }
    .head { padding: 11px 16px; background: #faf3e9; border-bottom: 1px solid var(--line); }
    .item { padding: 13px 16px; border-bottom: 1px solid #f5ece0; gap: 11px; }
    .item:last-child { border-bottom: none; }
    .sub { padding: 0 16px 13px 43px; border-bottom: 1px solid #f5ece0; gap: 10px; }
    .box { width: 16px; height: 16px; border: 1.5px solid var(--line-input); border-radius: 4px; flex-shrink: 0; }
    .title { font-size: 14px; color: var(--ink); flex: 1; }
    .more { opacity: 0.45; }
    .tiny { font-size: 10px; letter-spacing: 0.1em; }
  `,
})
export class LockedPlanList {
  plan = input.required<PlanDto>();
}
