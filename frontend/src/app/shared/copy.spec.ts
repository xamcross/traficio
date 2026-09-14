import { areaCode, areaName, bandFor, capitalize, effortText, formatDate, formatDateShort, monthName, numberWord, pagesCaption, plural, severityLabel, severityOrder } from './copy';

describe('copy helpers', () => {
  it('bands scores into three labels and tones', () => {
    expect(bandFor(0)).toEqual({ label: 'Needs work', tone: 'low' });
    expect(bandFor(49)).toEqual({ label: 'Needs work', tone: 'low' });
    expect(bandFor(50)).toEqual({ label: 'Getting there', tone: 'mid' });
    expect(bandFor(79)).toEqual({ label: 'Getting there', tone: 'mid' });
    expect(bandFor(80)).toEqual({ label: 'Looking good', tone: 'high' });
    expect(bandFor(100)).toEqual({ label: 'Looking good', tone: 'high' });
  });

  it('maps categories to area names and codes', () => {
    expect(areaName('seo')).toBe('Google');
    expect(areaName('aeo')).toBe('Answers');
    expect(areaName('geo')).toBe('AI');
    expect(areaName('other')).toBe('other');
    expect(areaCode('geo')).toBe('GEO');
  });

  it('labels and orders severities', () => {
    expect(severityLabel('high')).toBe('HIGH');
    expect(severityLabel('medium')).toBe('MED');
    expect(severityLabel('low')).toBe('LOW');
    expect(severityLabel('good')).toBe('PASS');
    expect(['good', 'low', 'high', 'medium'].sort((a, b) => severityOrder(a) - severityOrder(b))).toEqual(['high', 'medium', 'low', 'good']);
  });

  it('writes numbers as words up to twelve', () => {
    expect(numberWord(1)).toBe('one');
    expect(numberWord(8)).toBe('eight');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(13)).toBe('13');
  });

  it('writes effort in minutes under 90 and in rounded hours above', () => {
    expect(effortText(20)).toBe('about 20 minutes');
    expect(effortText(89)).toBe('about 85 minutes');
    expect(effortText(47)).toBe('about 45 minutes');
    expect(effortText(3)).toBe('about 5 minutes');
    expect(effortText(90)).toBe('about 2 hours');
    expect(effortText(60)).toBe('about 60 minutes');
    expect(effortText(100)).toBe('about 2 hours');
    expect(effortText(175)).toBe('about 3 hours');
    expect(effortText(0)).toBe('nothing');
  });

  it('captions affected pages', () => {
    expect(pagesCaption(0, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(18, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(20, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(1, 18)).toBe('1 PAGE');
    expect(pagesCaption(14, 18)).toBe('14 PAGES');
    expect(pagesCaption(3, null)).toBe('3 PAGES');
  });

  it('picks the singular form only at one', () => {
    expect(plural(0, 'thing', 'things')).toBe('things');
    expect(plural(1, 'thing', 'things')).toBe('thing');
    expect(plural(2, 'thing', 'things')).toBe('things');
    expect(plural(1, 'TASK', 'TASKS')).toBe('TASK');
  });

  it('makes the first letter upper case', () => {
    expect(capitalize('two')).toBe('Two');
    expect(capitalize('Two')).toBe('Two');
    expect(capitalize('')).toBe('');
  });

  it('formats dates in the long form', () => {
    expect(formatDate('2026-07-28T10:00:00.000Z')).toBe('28 July 2026');
    expect(formatDateShort('2026-09-01T10:00:00.000Z')).toBe('1 September');
    expect(monthName('2026-03-02T10:00:00.000Z')).toBe('March');
  });
});
