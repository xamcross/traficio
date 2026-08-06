import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { AssessmentDto, Finding } from '../../core/api/types';
import { ScoreDial } from '../../shared/score-dial';

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

@Component({
  selector: 'app-report',
  imports: [RouterLink, ScoreDial],
  template: `
    @if (assessment(); as a) {
      <h1>Your site report</h1>
      <div class="dials">
        <div class="dial-card">
          <app-score-dial [label]="'SEO'" [value]="a.scores!.seo" />
          <p class="meaning">{{ scoreMeaning(a.scores!.seo) }}</p>
        </div>
        <div class="dial-card">
          <app-score-dial [label]="'AEO'" [value]="a.scores!.aeo" />
          <p class="meaning">{{ scoreMeaning(a.scores!.aeo) }}</p>
        </div>
        <div class="dial-card">
          <app-score-dial [label]="'GEO'" [value]="a.scores!.geo" />
          <p class="meaning">{{ scoreMeaning(a.scores!.geo) }}</p>
        </div>
      </div>

      <section class="findings">
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
      </section>

      <p class="see-plan">
        <a [routerLink]="['/assessments', id, 'plan']">See my plan</a>
      </p>
    }
  `,
})
export class Report implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly assessment = signal<AssessmentDto | null>(null);
  protected readonly groupedFindings = computed(() => {
    const a = this.assessment();
    return a ? groupFindings(a.findings) : [];
  });

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    const assessment = await this.api.getAssessment(this.id);
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
