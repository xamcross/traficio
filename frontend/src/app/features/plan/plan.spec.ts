import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Plan } from './plan';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PlanDto, PlanTaskDto } from '../../core/api/types';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'plan-spec-blank', template: '' })
class BlankPage {}

function activatedRouteWithId(id: string): ActivatedRoute {
  return { snapshot: { paramMap: convertToParamMap({ id }) } } as ActivatedRoute;
}

/** A promise whose resolution is controlled from the test, to simulate an in-flight request. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeTask(overrides: Partial<PlanTaskDto> = {}): PlanTaskDto {
  const steps = ['Open your homepage HTML.', 'Add a <title> tag in the <head>.', 'Publish the change.'];
  return {
    taskId: 't1',
    title: 'Add a title tag',
    category: 'Meta tags',
    impact: 'high',
    effortMinutes: 15,
    stepCount: steps.length,
    whyItMatters: 'Search engines use the title tag to understand your page.',
    steps,
    doneCheck: 'View source and confirm a title tag with your page name appears.',
    status: 'todo',
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanDto> = {}): PlanDto {
  return {
    id: 'p1',
    assessmentId: 'A1',
    siteId: 's1',
    locked: false,
    tasks: [makeTask()],
    progress: { done: 0, verified: 0, total: 1 },
    ...overrides,
  };
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  getPlanForAssessmentResult: Promise<PlanDto> = Promise.resolve(makePlan());
  getPlanForAssessmentCalls: string[] = [];
  setTaskStatusResult: Promise<PlanDto> = Promise.resolve(makePlan());
  setTaskStatusCalls: Array<[string, string, string]> = [];

  getPlanForAssessment(assessmentId: string): Promise<PlanDto> {
    this.getPlanForAssessmentCalls.push(assessmentId);
    return this.getPlanForAssessmentResult;
  }

  setTaskStatus(planId: string, taskId: string, status: 'todo' | 'done'): Promise<PlanDto> {
    this.setTaskStatusCalls.push([planId, taskId, status]);
    return this.setTaskStatusResult;
  }
}

describe('Plan', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [Plan],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([{ path: 'dashboard', component: BlankPage }]),
        { provide: ActivatedRoute, useValue: activatedRouteWithId('A1') },
      ],
    }).compileComponents();
  });

  it('renders tasks in the served order with title, category chip, impact chip, and effort', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({
        tasks: [
          makeTask({ taskId: 't1', title: 'First task', category: 'Meta tags', impact: 'high', effortMinutes: 15 }),
          makeTask({ taskId: 't2', title: 'Second task', category: 'Structured data', impact: 'low', effortMinutes: 5 }),
        ],
        progress: { done: 0, verified: 0, total: 2 },
      }),
    );
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const tasks = compiled.querySelectorAll('.task');
    expect(tasks.length).toBe(2);
    expect(tasks[0].textContent).toContain('First task');
    expect(tasks[0].textContent).toContain('Meta tags');
    expect(tasks[0].textContent).toContain('high');
    expect(tasks[0].textContent).toContain('about 15 minutes');
    expect(tasks[1].textContent).toContain('Second task');
    expect(tasks[1].textContent).toContain('Structured data');
    expect(tasks[1].textContent).toContain('low');
    expect(tasks[1].textContent).toContain('about 5 minutes');
  });

  it('expands a task on click to show whyItMatters, numbered steps, and doneCheck under "How you know it worked"', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({
        tasks: [
          makeTask({
            taskId: 't1',
            whyItMatters: 'This matters a lot.',
            steps: ['Do the first thing.', 'Do the second thing.'],
            doneCheck: 'Check it worked like this.',
          }),
        ],
        progress: { done: 0, verified: 0, total: 1 },
      }),
    );
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).not.toContain('This matters a lot.');

    compiled.querySelector<HTMLElement>('.task-header')!.click();
    fixture.detectChanges();

    const text = compiled.textContent ?? '';
    expect(text).toContain('This matters a lot.');
    expect(text).toContain('Do the first thing.');
    expect(text).toContain('Do the second thing.');
    expect(text).toContain('How you know it worked');
    expect(text).toContain('Check it worked like this.');
    expect(text.indexOf('How you know it worked')).toBeLessThan(text.indexOf('Check it worked like this.'));
  });

  it("checking a task's checkbox PATCHes done and replaces the plan; the progress bar reflects the response", async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({ id: 'p1', tasks: [makeTask({ taskId: 't1', status: 'todo' })], progress: { done: 0, verified: 0, total: 1 } }),
    );
    api.setTaskStatusResult = Promise.resolve(
      makePlan({ id: 'p1', tasks: [makeTask({ taskId: 't1', status: 'done' })], progress: { done: 1, verified: 0, total: 1 } }),
    );
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkbox = compiled.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.setTaskStatusCalls).toEqual([['p1', 't1', 'done']]);
    expect(compiled.textContent).toContain('You finished 1 of 1 tasks.');
  });

  it('renders a disabled checkbox labeled "Checked by us" for a verified task, and it cannot be toggled', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({ tasks: [makeTask({ taskId: 't1', status: 'verified' })], progress: { done: 0, verified: 1, total: 1 } }),
    );
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkbox = compiled.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(checkbox.disabled).toBeTrue();
    expect(checkbox.checked).toBeTrue();
    expect(compiled.querySelector('.status-toggle')?.textContent).toContain('Checked by us');

    checkbox.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.setTaskStatusCalls).toEqual([]);
  });

  it('unchecking a done task PATCHes todo', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({ id: 'p1', tasks: [makeTask({ taskId: 't1', status: 'done' })], progress: { done: 1, verified: 0, total: 1 } }),
    );
    api.setTaskStatusResult = Promise.resolve(
      makePlan({ id: 'p1', tasks: [makeTask({ taskId: 't1', status: 'todo' })], progress: { done: 0, verified: 0, total: 1 } }),
    );
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkbox = compiled.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(checkbox.checked).toBeTrue();
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.setTaskStatusCalls).toEqual([['p1', 't1', 'todo']]);
  });

  it('disables the checkbox while a PATCH is in flight', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({ tasks: [makeTask({ taskId: 't1', status: 'todo' })], progress: { done: 0, verified: 0, total: 1 } }),
    );
    const inFlight = deferred<PlanDto>();
    api.setTaskStatusResult = inFlight.promise;
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkbox = compiled.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(checkbox.disabled).toBeTrue();

    inFlight.resolve(
      makePlan({ tasks: [makeTask({ taskId: 't1', status: 'done' })], progress: { done: 1, verified: 0, total: 1 } }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(checkbox.disabled).toBeFalse();
  });

  it("disables task B's checkbox while task A's PATCH is in flight", async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({
        tasks: [makeTask({ taskId: 'a', status: 'todo' }), makeTask({ taskId: 'b', status: 'todo' })],
        progress: { done: 0, verified: 0, total: 2 },
      }),
    );
    const inFlight = deferred<PlanDto>();
    api.setTaskStatusResult = inFlight.promise;
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkboxes = compiled.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    const [checkboxA, checkboxB] = [checkboxes[0], checkboxes[1]];

    checkboxA.checked = true;
    checkboxA.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(checkboxA.disabled).toBeTrue();
    expect(checkboxB.disabled).toBeTrue();

    inFlight.resolve(
      makePlan({
        tasks: [makeTask({ taskId: 'a', status: 'done' }), makeTask({ taskId: 'b', status: 'todo' })],
        progress: { done: 1, verified: 0, total: 2 },
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(checkboxA.disabled).toBeFalse();
    expect(checkboxB.disabled).toBeFalse();
  });

  it('shows a loading message before the plan loads', () => {
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading');
  });

  it('renders the error note and a back link when the initial fetch is rejected', async () => {
    api.getPlanForAssessmentResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
    expect(compiled.querySelectorAll('.task').length).toBe(0);
    const backLink = compiled.querySelector('a[href="/dashboard"]');
    expect(backLink).toBeTruthy();
  });

  it('shows the error note and keeps the old state when a PATCH is rejected', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(
      makePlan({ tasks: [makeTask({ taskId: 't1', status: 'todo' })], progress: { done: 0, verified: 0, total: 1 } }),
    );
    api.setTaskStatusResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkbox = compiled.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
    expect(compiled.textContent).toContain('You finished 0 of 1 tasks.');
    expect((compiled.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBeFalse();
  });
});
