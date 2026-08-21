import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { API_BASE } from '../config';
import { AssessmentDto, PlanDto, PreviewDto, SiteDto, UsageDto, UserDto } from './types';

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

async function unwrap<T>(obs: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(obs);
  } catch (e) {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as { code?: unknown; message?: unknown } | null;
      if (body && typeof body.code === 'string') {
        throw new ApiError(body.code, typeof body.message === 'string' ? body.message : '', e.status);
      }
      throw new ApiError('network_error', 'We could not reach the server. Check your connection and try again.', e.status);
    }
    throw e;
  }
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);
  private url(p: string) { return `${API_BASE}${p}`; }

  register(email: string, password: string) { return unwrap(this.http.post(this.url('/v1/auth/register'), { email, password })); }
  verifyEmail(token: string) { return unwrap(this.http.post(this.url('/v1/auth/verify-email'), { token })); }
  login(email: string, password: string) { return unwrap(this.http.post<UserDto>(this.url('/v1/auth/login'), { email, password })); }
  logout() { return unwrap(this.http.post(this.url('/v1/auth/logout'), null)); }
  me() { return unwrap(this.http.get<UserDto>(this.url('/v1/me'))); }
  resendVerification() { return unwrap(this.http.post(this.url('/v1/auth/resend-verification'), null)); }
  requestPasswordReset(email: string) { return unwrap(this.http.post(this.url('/v1/auth/password-reset/request'), { email })); }
  confirmPasswordReset(token: string, newPassword: string) { return unwrap(this.http.post(this.url('/v1/auth/password-reset/confirm'), { token, newPassword })); }
  createSite(url: string) { return unwrap(this.http.post<SiteDto>(this.url('/v1/sites'), { url })); }
  async listSites() { return (await unwrap(this.http.get<{ sites: SiteDto[] }>(this.url('/v1/sites')))).sites; }
  submitAssessment(siteId: string) { return unwrap(this.http.post<AssessmentDto>(this.url(`/v1/sites/${siteId}/assessments`), null)); }
  async listAssessments(siteId: string) { return (await unwrap(this.http.get<{ assessments: AssessmentDto[] }>(this.url(`/v1/sites/${siteId}/assessments`)))).assessments; }
  getAssessment(id: string) { return unwrap(this.http.get<AssessmentDto>(this.url(`/v1/assessments/${id}`))); }
  getPlanForAssessment(assessmentId: string) { return unwrap(this.http.get<PlanDto>(this.url(`/v1/assessments/${assessmentId}/plan`))); }
  getPlanForSite(siteId: string) { return unwrap(this.http.get<PlanDto>(this.url(`/v1/sites/${siteId}/plan`))); }
  setTaskStatus(planId: string, taskId: string, status: 'todo' | 'done') {
    return unwrap(this.http.patch<PlanDto>(this.url(`/v1/plans/${planId}/tasks/${taskId}`), { status }));
  }
  usage() { return unwrap(this.http.get<UsageDto>(this.url('/v1/me/usage'))); }
  shareAssessment(id: string) { return unwrap(this.http.post<{ slug: string }>(this.url(`/v1/assessments/${id}/share`), null)); }
  unshareAssessment(id: string) { return unwrap(this.http.delete(this.url(`/v1/assessments/${id}/share`))); }
  preview(url: string) { return unwrap(this.http.post<PreviewDto>(this.url('/v1/preview'), { url })); }
}
