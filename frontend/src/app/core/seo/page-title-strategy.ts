import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, PRIMARY_OUTLET, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * The landing page copy. Every route falls back to these values, so a page
 * never ships an empty description, an empty title or a stale Open Graph tag.
 */
export const FALLBACK_TITLE = 'AI visibility check for your website | GeoStrategy';
export const FALLBACK_DESCRIPTION =
  'See how findable your website is in Google, answer boxes and AI assistants like ChatGPT. Get your score and every problem we find, free. No card needed.';

/**
 * The social card. The file sits in `public/`, so the build copies it to the
 * site root. Every page shares the same card: one card that states what the
 * product is beats a per-page card that says nothing.
 */
const OG_IMAGE_PATH = '/og-image.png';
const OG_IMAGE_WIDTH = '1200';
const OG_IMAGE_HEIGHT = '630';
const OG_IMAGE_ALT = 'GeoStrategy: your customers ask AI. Does it know you exist?';

/**
 * Sets the document title and the SEO meta tags on every navigation.
 *
 * The Title and Meta services write through Angular's injected DOCUMENT, not
 * the global `document`. This makes the strategy safe during pre-render: the
 * static build runs this same code on the server and bakes the result into
 * the output HTML.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const pageTitle = this.buildTitle(snapshot) ?? FALLBACK_TITLE;
    const description = this.buildDescription(snapshot) ?? FALLBACK_DESCRIPTION;
    const url = environment.siteOrigin + this.canonicalPath(snapshot);
    // A crawler that reads the card never resolves a relative path, so the
    // image URL is absolute.
    const image = environment.siteOrigin + OG_IMAGE_PATH;

    this.title.setTitle(pageTitle);

    // Each call replaces the previous value, so a stale tag from the last
    // page never survives a navigation.
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'GeoStrategy' });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:image:width', content: OG_IMAGE_WIDTH });
    this.meta.updateTag({ property: 'og:image:height', content: OG_IMAGE_HEIGHT });
    this.meta.updateTag({ property: 'og:image:alt', content: OG_IMAGE_ALT });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.setCanonicalLink(url);
  }

  /**
   * Reads `data.description` from the deepest primary route, the same way
   * the base class `buildTitle` reads `title`.
   */
  private buildDescription(snapshot: RouterStateSnapshot): string | undefined {
    let description: string | undefined;
    let route: ActivatedRouteSnapshot | undefined = snapshot.root;
    while (route !== undefined) {
      const value = route.data['description'];
      description = typeof value === 'string' ? value : description;
      route = route.children.find((child) => child.outlet === PRIMARY_OUTLET);
    }
    return description;
  }

  /** The route path with no query string and no trailing slash, except for the root path. */
  private canonicalPath(snapshot: RouterStateSnapshot): string {
    const path = snapshot.url.split('?')[0].split('#')[0];
    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }
    return path.length > 0 ? path : '/';
  }

  /**
   * Angular has no service for `<link>` elements, so this method sets the
   * canonical href through the injected DOCUMENT instead of the Meta service.
   */
  private setCanonicalLink(url: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}
