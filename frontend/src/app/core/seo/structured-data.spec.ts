import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { StructuredData } from './structured-data';
import { environment } from '../../../environments/environment';

describe('StructuredData', () => {
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    doc = TestBed.inject(DOCUMENT);
    doc.getElementById('app-structured-data')?.remove();
  });

  afterEach(() => doc.getElementById('app-structured-data')?.remove());

  function block(): Record<string, unknown> {
    const el = doc.getElementById('app-structured-data');
    expect(el).withContext('the script tag is written to the head').not.toBeNull();
    return JSON.parse(el!.textContent ?? '') as Record<string, unknown>;
  }

  it('writes a block that parses as JSON and names both types', () => {
    TestBed.inject(StructuredData).writeLandingBlock();
    const graph = block()['@graph'] as Array<Record<string, unknown>>;
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'SoftwareApplication']);
  });

  it('states the two real offers, with the price as a bare number', () => {
    TestBed.inject(StructuredData).writeLandingBlock();
    const graph = block()['@graph'] as Array<Record<string, unknown>>;
    const offers = graph[1]['offers'] as Array<Record<string, string>>;
    expect(offers.map((o) => [o['name'], o['price']])).toEqual([
      ['Free', '0'],
      ['Pro', '9'],
    ]);
    // A price carries no currency symbol; priceCurrency carries the currency.
    offers.forEach((o) => expect(o['price']).toMatch(/^[0-9.]+$/));
  });

  it('builds every url from siteOrigin, so the apex move stays a one-line change', () => {
    TestBed.inject(StructuredData).writeLandingBlock();
    const graph = block()['@graph'] as Array<Record<string, string>>;
    expect(graph[0]['url']).toBe(`${environment.siteOrigin}/`);
    expect(graph[1]['url']).toBe(`${environment.siteOrigin}/`);
  });

  it('claims nothing it cannot support', () => {
    TestBed.inject(StructuredData).writeLandingBlock();
    const text = JSON.stringify(block());
    ['aggregateRating', 'reviewCount', 'ratingValue', 'logo', 'foundingDate', 'address'].forEach(
      (invented) => expect(text).not.toContain(invented),
    );
  });

  it('replaces the block instead of appending a second one', () => {
    const service = TestBed.inject(StructuredData);
    service.writeLandingBlock();
    service.writeLandingBlock();
    expect(doc.querySelectorAll('#app-structured-data').length).toBe(1);
  });
});
