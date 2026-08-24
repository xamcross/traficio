import { formatDate as ngFormatDate } from '@angular/common';

export type Tone = 'low' | 'mid' | 'high';

/** Score bands, spec §5.2. */
export function bandFor(score: number): { label: string; tone: Tone } {
  if (score >= 80) return { label: 'Looking good', tone: 'high' };
  if (score >= 50) return { label: 'Getting there', tone: 'mid' };
  return { label: 'Needs work', tone: 'low' };
}

/**
 * The label for an area. One short label, used on every screen. The landing
 * page explainer is the only place that defines what each one means, and it
 * writes that prose by hand.
 */
const AREA_NAMES: Record<string, string> = { seo: 'Google', aeo: 'Answers', geo: 'AI' };
export function areaName(category: string): string { return AREA_NAMES[category] ?? category; }
export function areaCode(category: string): string { return category.toUpperCase(); }

const SEVERITY_LABELS: Record<string, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MED', low: 'LOW', good: 'PASS' };
export function severityLabel(severity: string): string { return SEVERITY_LABELS[severity] ?? severity.toUpperCase(); }
/** Worst first. `critical` only comes from the ungated preview check; the full assessment never sends it. */
const SEVERITY_ORDER: Record<string, number> = { critical: -1, high: 0, medium: 1, low: 2, good: 3 };
export function severityOrder(severity: string): number { return SEVERITY_ORDER[severity] ?? 4; }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function numberWord(n: number): string { return n >= 1 && n <= 12 ? WORDS[n] : String(n); }

/** Picks the singular form or the plural form. Every count in the copy uses this. */
export function plural(n: number, one: string, many: string): string { return n === 1 ? one : many; }

/**
 * Effort text, spec §4.3. Under 90 minutes: minutes, to the nearest five. An
 * estimate that reads "about 47 minutes" claims a precision we do not have.
 * Otherwise rounded hours.
 */
export function effortText(minutes: number): string {
  if (minutes <= 0) return 'nothing';
  // Clamped to 85 so this branch never prints "about 90 minutes" while 90 itself reads "about 2 hours".
  if (minutes < 90) return `about ${Math.min(85, Math.max(5, Math.round(minutes / 5) * 5))} minutes`;
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
