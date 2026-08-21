export type Tier = 'free' | 'pro';
export type AssessmentStatus = 'queued' | 'crawling' | 'analyzing' | 'planning' | 'ready' | 'failed';
export type TaskStatus = 'todo' | 'done' | 'verified';
export type Impact = 'high' | 'medium' | 'low';
export type Severity = 'high' | 'medium' | 'low' | 'good';

export interface UserDto { id: string; email: string; emailVerified: boolean; tier: Tier; }
export interface Scores { seo: number; aeo: number; geo: number; overall: number; }
export interface ScoreNotes { seo: string; aeo: string; geo: string; }
export interface LatestAssessmentDto { id: string; status: AssessmentStatus; createdAt: string; completedAt: string | null; }
export interface SiteDto {
  id: string; domain: string; url: string; platform: string | null; latestScores: Scores | null; readOnly: boolean;
  latestAssessment: LatestAssessmentDto | null; latestReadyAssessmentId: string | null;
}
export interface Finding { id: string; category: string; severity: Severity | string; evidence: string; affectedPages: string[]; }
export interface TaskChangeDto { title: string; kind: 'done' | 'verified'; }
export interface AssessmentDto {
  id: string; siteId: string; status: AssessmentStatus; scores: Scores | null;
  summary: string | null; scoreNotes: ScoreNotes | null;
  findings: Finding[]; pageCount: number | null;
  errorCode: string | null; errorMessage: string | null;
  createdAt: string; completedAt: string | null;
  changes: TaskChangeDto[];
  publicSlug: string | null;
}
export interface PlanTaskDto {
  taskId: string; title: string; category: string; impact: Impact; effortMinutes: number; stepCount: number;
  whyItMatters: string | null; steps: string[] | null; doneCheck: string | null; status: TaskStatus;
}
export interface PlanProgressDto { done: number; verified: number; total: number; }
export interface PlanDto { id: string; assessmentId: string; siteId: string; locked: boolean; tasks: PlanTaskDto[]; progress: PlanProgressDto; }
export interface UsageDto { assessmentsUsed: number; assessmentsLimit: number; sitesUsed: number; sitesLimit: number; nextCheckAt: string | null; }
