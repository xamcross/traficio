import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, Finding } from '../../core/api/types';
import { ScoreDial } from '../../shared/score-dial';
import { ErrorNote } from '../../shared/error-note';

interface FindingGroup {
  category: string;
  findings: Finding[];
}

function scoreMeaning(value: number): string {
  if (value >= 70) return 'Good';
  if (value >= 40) return 'Needs work';
  return 'Fix soon';
}

function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const byCategory = new Map<string, FindingGroup>();
  for (const finding of findings) {
    let group = byCategory.get(finding.category);
    if (!group) {
      group = { category: finding.category, findings: [] };
      byCategory.set(finding.category, group);
      groups.push(group);
    }
    group.findings.push(finding);
  }
  return groups;
}

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}

@Component({
  selector: 'app-report',
  imports: [RouterLink, ScoreDial, ErrorNote],
  template: `
    @if (error(); as e) {
      <app-error-note [error]="e" />
      <p><a routerLink="/dashboard">Back to my sites</a></p>
    } @else if (assessment(); as a) {
      <h1>Your site report</h1>
      @if (a.scores; as scores) {
        <div class="dials">
          <div class="dial-card">
            <app-score-dial [label]="'SEO'" [value]="scores.seo" />
            <p class="meaning">{{ scoreMeaning(scores.seo) }}</p>
          </div>
          <div class="dial-card">
            <app-score-dial [label]="'AEO'" [value]="scores.aeo" />
            <p class="meaning">{{ scoreMeaning(scores.aeo) }}</p>
          </div>
          <div class="dial-card">
            <app-score-dial [label]="'GEO'" [value]="scores.geo" />
            <p class="meaning">{{ scoreMeaning(scores.geo) }}</p>
          </div>
        </div>
      } @else {
        <p>We could not read the scores for this check. Run a new check.</p>
      }

      <section class="findings">
        @if (groupedFindings().length === 0) {
          <p>We found no problems to report. Great job.</p>
        } @else {
          @for (group of groupedFindings(); track group.category) {
            <div class="finding-group">
              <h2>{{ group.category }}</h2>
              @for (finding of group.findings; track finding.id) {
                <article class="finding">
                  <span class="severity-badge">{{ finding.severity }}</span>
                  <p>{{ finding.evidence }}</p>
                </article>
              }
            </div>
          }
        }
      </section>

      <p class="see-plan">
        <a [routerLink]="['/assessments', id, 'plan']">See my plan</a>
      </p>
    } @else {
      <p>Loading…</p>
    }
  `,
})
export class Report implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly assessment = signal<AssessmentDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly groupedFindings = computed(() => {
    const a = this.assessment();
    return a ? groupFindings(a.findings) : [];
  });

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch (e) {
      this.error.set(toApiError(e));
      return;
    }
    if (assessment.status !== 'ready') {
      void this.router.navigateByUrl(`/assessments/${this.id}/progress`);
      return;
    }
    this.assessment.set(assessment);
  }

  protected scoreMeaning(value: number): string {
    return scoreMeaning(value);
  }
}
