export type Tier = 'free' | 'pro';
export type AssessmentStatus = 'queued' | 'crawling' | 'analyzing' | 'planning' | 'ready' | 'failed';
export type TaskStatus = 'todo' | 'done' | 'verified';
export type Impact = 'high' | 'medium' | 'low';

export interface UserDto { id: string; email: string; emailVerified: boolean; tier: Tier; }
export interface Scores { seo: number; aeo: number; geo: number; }
export interface SiteDto { id: string; domain: string; url: string; platform: string | null; latestScores: Scores | null; readOnly: boolean; }
export interface Finding { id: string; category: string; severity: string; evidence: string; affectedPages: string[]; }
export interface AssessmentDto {
  id: string; siteId: string; status: AssessmentStatus; scores: Scores | null;
  findings: Finding[]; errorCode: string | null; errorMessage: string | null;
  createdAt: string; completedAt: string | null;
}
export interface PlanTaskDto {
  taskId: string; title: string; category: string; impact: Impact; effortMinutes: number;
  whyItMatters: string; steps: string[]; doneCheck: string; status: TaskStatus;
}
export interface PlanProgressDto { done: number; verified: number; total: number; }
export interface PlanDto { id: string; assessmentId: string; siteId: string; tasks: PlanTaskDto[]; progress: PlanProgressDto; }
export interface UsageDto { assessmentsUsed: number; assessmentsLimit: number; sitesUsed: number; sitesLimit: number; }
