import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withNavigationErrorHandler } from '@angular/router';
import { PAGE_LOADER, STALE_CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnStaleChunk } from './stale-chunk-reload';

@Component({ template: '' })
class BlankPage {}

/** The error Chrome gave on traficio.com when a deploy removed the pricing chunk. */
const chromeChunkError = () => new TypeError('Failed to fetch dynamically imported module: https://traficio.com/chunk-U36SNIGE.js');

describe('reloadOnStaleChunk', () => {
  let loaded: string[];
  let router: Router;

  beforeEach(() => {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
    loaded = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: '', component: BlankPage },
            { path: 'pricing', loadComponent: () => Promise.reject(chromeChunkError()) },
            { path: 'broken', loadComponent: () => Promise.reject(new Error('boom')) },
          ],
          withNavigationErrorHandler(reloadOnStaleChunk),
        ),
        { provide: PAGE_LOADER, useValue: (url: string) => loaded.push(url) },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY));

  it('loads the target URL as a new document when the lazy chunk is gone after a deploy', async () => {
    await router.navigateByUrl('/pricing?site=S1').catch(() => undefined);

    expect(loaded).toEqual(['/pricing?site=S1']);
  });

  it('reloads only once when the chunk is still missing after the reload, so a broken deploy cannot loop', async () => {
    await router.navigateByUrl('/pricing').catch(() => undefined);
    await router.navigateByUrl('/pricing').catch(() => undefined);

    expect(loaded).toEqual(['/pricing']);
  });

  it('leaves a navigation error that is not a chunk failure to the normal error path', async () => {
    await router.navigateByUrl('/broken').catch(() => undefined);

    expect(loaded).toEqual([]);
  });
});

describe('isChunkLoadError', () => {
  it('matches the Chrome, Firefox and Safari messages for a failed lazy import', () => {
    expect(isChunkLoadError(chromeChunkError())).toBeTrue();
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://traficio.com/chunk-A.js'))).toBeTrue();
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBeTrue();
  });

  it('does not match other errors', () => {
    expect(isChunkLoadError(new Error('boom'))).toBeFalse();
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBeFalse();
    expect(isChunkLoadError(undefined)).toBeFalse();
  });
});
