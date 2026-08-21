import { formatDate as ngFormatDate } from '@angular/common';

export type Tone = 'low' | 'mid' | 'high';

/** Score bands, spec §5.2. */
export function bandFor(score: number): { label: string; tone: Tone } {
  if (score >= 80) return { label: 'Looking good', tone: 'high' };
  if (score >= 50) return { label: 'Getting there', tone: 'mid' };
  return { label: 'Needs work', tone: 'low' };
}

const AREA_NAMES: Record<string, string> = { seo: 'Google search', aeo: 'Answer boxes', geo: 'AI assistants' };
export function areaName(category: string): string { return AREA_NAMES[category] ?? category; }
export function areaCode(category: string): string { return category.toUpperCase(); }

const SEVERITY_LABELS: Record<string, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MED', low: 'LOW', good: 'FINE' };
export function severityLabel(severity: string): string { return SEVERITY_LABELS[severity] ?? severity.toUpperCase(); }
/** Worst first. `critical` only comes from the ungated preview check; the full assessment never sends it. */
const SEVERITY_ORDER: Record<string, number> = { critical: -1, high: 0, medium: 1, low: 2, good: 3 };
export function severityOrder(severity: string): number { return SEVERITY_ORDER[severity] ?? 4; }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function numberWord(n: number): string { return n >= 1 && n <= 12 ? WORDS[n] : String(n); }

/** Effort text, spec §4.3. Under 90 minutes: minutes. Otherwise rounded hours. */
export function effortText(minutes: number): string {
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about 1 hour' : `about ${hours} hours`;
}

/** Caption for a finding's affected pages, spec §4.3. */
export function pagesCaption(affected: number, pageCount: number | null): string {
  if (affected === 0 || (pageCount != null && affected >= pageCount)) return 'AFFECTS EVERY PAGE';
  if (affected === 1) return '1 PAGE';
  return `${affected} PAGES`;
}

export function formatDate(iso: string): string { return ngFormatDate(iso, 'd MMMM yyyy', 'en-US'); }
export function formatDateShort(iso: string): string { return ngFormatDate(iso, 'd MMMM', 'en-US'); }
export function monthName(iso: string): string { return ngFormatDate(iso, 'MMMM', 'en-US'); }
