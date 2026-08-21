import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { FALLBACK_DESCRIPTION, FALLBACK_TITLE, PageTitleStrategy } from './page-title-strategy';
import { environment } from '../../../environments/environment';

@Component({ template: '' })
class DummyPage {}

describe('PageTitleStrategy', () => {
  let router: Router;
  let title: Title;
  let meta: Meta;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: DummyPage },
          {
            path: 'with-meta',
            title: 'With meta | GeoStrategy',
            data: { description: 'A description for this route.' },
            component: DummyPage,
          },
          { path: 'no-meta', component: DummyPage },
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    title = TestBed.inject(Title);
    meta = TestBed.inject(Meta);
  });

  function metaContent(attrSelector: string): string | null {
    return meta.getTag(attrSelector)?.getAttribute('content') ?? null;
  }

  function canonicalHref(): string | null {
    return document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  }

  it('sets the title, the description and the canonical link on navigation', async () => {
    await router.navigateByUrl('/with-meta');

    expect(title.getTitle()).toBe('With meta | GeoStrategy');
    expect(metaContent('name="description"')).toBe('A description for this route.');
    expect(canonicalHref()).toBe(`${environment.siteOrigin}/with-meta`);
  });

  it('sets the Open Graph and the Twitter card tags on navigation', async () => {
    await router.navigateByUrl('/with-meta');

    expect(metaContent('property="og:title"')).toBe('With meta | GeoStrategy');
    expect(metaContent('property="og:description"')).toBe('A description for this route.');
    expect(metaContent('property="og:url"')).toBe(`${environment.siteOrigin}/with-meta`);
    expect(metaContent('property="og:type"')).toBe('website');
    expect(metaContent('property="og:site_name"')).toBe('GeoStrategy');
    expect(metaContent('name="twitter:card"')).toBe('summary_large_image');
  });

  it('falls back to the landing page title and description for a route with neither', async () => {
    await router.navigateByUrl('/no-meta');

    expect(title.getTitle()).toBe(FALLBACK_TITLE);
    expect(metaContent('name="description"')).toBe(FALLBACK_DESCRIPTION);
    expect(canonicalHref()).toBe(`${environment.siteOrigin}/no-meta`);
  });

  it('overwrites a previous description instead of leaving it stale', async () => {
    await router.navigateByUrl('/with-meta');
    expect(metaContent('name="description"')).toBe('A description for this route.');

    await router.navigateByUrl('/no-meta');

    expect(metaContent('name="description"')).toBe(FALLBACK_DESCRIPTION);
    expect(metaContent('name="description"')).not.toBe('A description for this route.');
  });

  it('strips the query string and the fragment from the canonical URL', async () => {
    await router.navigateByUrl('/with-meta?ref=email#section');

    expect(canonicalHref()).toBe(`${environment.siteOrigin}/with-meta`);
  });

  it('uses a single trailing slash for the root canonical URL', async () => {
    await router.navigateByUrl('/');

    expect(canonicalHref()).toBe(`${environment.siteOrigin}/`);
  });
});
