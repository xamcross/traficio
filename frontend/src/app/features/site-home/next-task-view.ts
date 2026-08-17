import { Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssessmentDto, PlanDto, PlanTaskDto, SiteDto } from '../../core/api/types';
import { areaName, bandFor, effortText } from '../../shared/copy';
import { openMinutes } from '../result/result-view';
import { addSkip, clearSkips, readSkips } from './skips';

export function nextTaskFor(plan: PlanDto, skipped: Set<string>): PlanTaskDto | null {
  const open = plan.tasks.filter((t) => t.status === 'todo');
  if (open.length === 0) return null;
  return open.find((t) => !skipped.has(t.taskId)) ?? open[0];
}

@Component({
  selector: 'app-next-task-view',
  imports: [RouterLink],
  template: `
    <div class="strip row">
      <div class="row big"><span class="overall">{{ overall() }}</span><span class="muted">of 100</span></div>
      <span class="vline" aria-hidden="true"></span>
      <div class="stack tight">
        <span class="semi" [class]="'semi tone-' + band().tone">{{ band().label }}</span>
        @if (delta(); as d) {<span class="muted small">{{ d }}</span>}
      </div>
      <span class="spacer"></span>
      <div class="row subs">
        <div class="stack tight right"><span class="faint small">Google search</span><strong>{{ scores().seo }}</strong></div>
        <div class="stack tight right"><span class="faint small">Answer boxes</span><strong>{{ scores().aeo }}</strong></div>
        <div class="stack tight right"><span class="faint small">AI assistants</span><strong>{{ scores().geo }}</strong></div>
      </div>
      <a class="small" [routerLink]="['/assessments', assessment().id, 'report']">Full report →</a>
      <button type="button" class="btn btn-text small" (click)="checkAgain.emit()" [disabled]="checkBusy()">Check again</button>
    </div>

    <div class="body stack">
      <div class="row baseline">
        <h1 class="eyebrow-h">DO THIS NEXT</h1>
        <span class="faint small">{{ doneCount() }} of {{ plan().tasks.length }} done · {{ effortLeft() }} left</span>
        <span class="spacer"></span>
        <a class="small" [routerLink]="['/assessments', assessment().id, 'plan']">See all {{ plan().tasks.length }}</a>
      </div>

      @if (task(); as t) {
        <article class="card task stack">
          <div class="row">
            @if (isBiggest(t)) {<span class="badge badge-high">BIGGEST WIN</span>}
            <span class="faint small">About {{ t.effortMinutes }} minutes</span><span class="faint small">·</span><span class="faint small">{{ areaName(t.category) }}</span>
          </div>
          <h2>{{ t.title }}</h2>
          @if (t.whyItMatters) {<p class="lead">{{ t.whyItMatters }}</p>}
          <ol class="steps">
            @for (s of t.steps ?? []; track $index) {<li><span class="num" aria-hidden="true">{{ $index + 1 }}</span><span>{{ s }}</span></li>}
          </ol>
          @if (t.doneCheck) {
            <div class="note-box stack tight"><span class="eyebrow">HOW YOU KNOW IT WORKED</span><span class="check">{{ t.doneCheck }}</span></div>
          }
          <div class="row">
            <button type="button" class="btn btn-primary" (click)="done.emit(t.taskId)" [disabled]="doneBusy()">I did this</button>
            <button type="button" class="btn btn-text" (click)="skip(t)">Skip for now</button>
          </div>
        </article>

        @if (then().length > 0) {
          <div class="then stack">
            <span class="eyebrow faint-3">THEN</span>
            @for (n of then(); track n.taskId) {<div class="row item"><span class="muted">{{ n.title }}</span><span class="spacer"></span><span class="faint small">{{ n.effortMinutes }} min</span></div>}
            @if (rest() > 0) {<div class="row item"><span class="faint">{{ rest() }} more</span></div>}
          </div>
        }
      } @else {
        <article class="card stack">
          <h2>You have done everything on your plan.</h2>
          <p class="lead">Check again to see your new score and to confirm your fixes.</p>
          <div class="row"><button type="button" class="btn btn-primary" (click)="checkAgain.emit()" [disabled]="checkBusy()">Check again</button></div>
        </article>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .strip { padding: 22px 44px; background: var(--strip); border-bottom: 1px solid var(--line); gap: 20px; flex-wrap: wrap; }
    .big { align-items: baseline; gap: 10px; } .overall { font-size: 30px; font-weight: 700; color: var(--ink); letter-spacing: -0.025em; }
    .vline { width: 1px; height: 30px; background: var(--line-strong); }
    .subs { gap: 24px; } .right { align-items: flex-end; } .subs strong { color: var(--ink); font-size: 16px; }
    .body { padding: 44px 44px 56px; gap: 26px; }
    .eyebrow-h { font-size: 14px; letter-spacing: 0.12em; color: var(--faint); font-weight: 700; }
    .baseline { align-items: baseline; }
    .task { padding: 38px 44px; gap: 26px; }
    h2 { font-size: 31px; letter-spacing: -0.025em; max-width: 30ch; }
    .lead { font-size: 17px; line-height: 1.65; color: var(--body-long); max-width: 58ch; }
    .steps { list-style: none; margin: 0; padding: 6px 0 0; display: flex; flex-direction: column; gap: 16px; }
    .steps li { display: flex; gap: 18px; align-items: flex-start; font-size: 17px; line-height: 1.5; color: var(--ink); }
    .num { width: 28px; height: 28px; border-radius: 999px; background: #f3e6d5; color: #8a6a48; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .check { font-size: 16px; color: var(--ink); }
    .then { padding-top: 10px; gap: 0; } .then .eyebrow { padding-bottom: 10px; color: #c0ad94; }
    .item { padding: 13px 0; border-bottom: 1px solid var(--line); } .item:last-child { border-bottom: none; }
    .semi { font-weight: 600; } .tight { gap: 3px; } .small { font-size: 13px; }
    @media (max-width: 760px) { .strip, .body { padding-left: 20px; padding-right: 20px; } .task { padding: 24px 20px; } }
  `,
})
export class NextTaskView {
  site = input.required<SiteDto>();
  assessment = input.required<AssessmentDto>();
  plan = input.required<PlanDto>();
  previousOverall = input<number | null>(null);
  doneBusy = input(false);
  checkBusy = input(false);
  done = output<string>();
  checkAgain = output<void>();

  protected readonly areaName = areaName;
  private readonly skipped = signal<Set<string>>(new Set());
  constructor() {
    effect(() => { this.skipped.set(readSkips(this.plan().id)); });
  }

  protected readonly scores = computed(() => this.assessment().scores ?? { seo: 0, aeo: 0, geo: 0, overall: 0 });
  protected readonly overall = computed(() => this.scores().overall);
  protected readonly band = computed(() => bandFor(this.overall()));
  protected readonly delta = computed(() => {
    const prev = this.previousOverall();
    if (prev == null) return '';
    const d = this.overall() - prev;
    if (d > 0) return `Up ${d} points since your last check`;
    if (d < 0) return `Down ${-d} points since your last check`;
    return 'Same as your last check';
  });
  protected readonly doneCount = computed(() => this.plan().tasks.filter((t) => t.status !== 'todo').length);
  protected readonly effortLeft = computed(() => effortText(openMinutes(this.plan())));
  protected readonly task = computed(() => nextTaskFor(this.plan(), this.skipped()));
  protected readonly then = computed(() => {
    const t = this.task();
    const open = this.plan().tasks.filter((x) => x.status === 'todo' && x.taskId !== t?.taskId);
    return open.slice(0, 3);
  });
  protected readonly rest = computed(() => {
    const t = this.task();
    return Math.max(0, this.plan().tasks.filter((x) => x.status === 'todo' && x.taskId !== t?.taskId).length - 3);
  });

  protected isBiggest(t: PlanTaskDto): boolean { return this.plan().tasks[0]?.taskId === t.taskId; }

  protected skip(t: PlanTaskDto): void {
    const next = addSkip(this.plan().id, t.taskId);
    const open = this.plan().tasks.filter((x) => x.status === 'todo');
    if (open.every((x) => next.has(x.taskId))) { clearSkips(this.plan().id); this.skipped.set(new Set()); return; }
    this.skipped.set(next);
  }
}
