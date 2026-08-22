import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { PRO_PRICE_LABEL } from '../config';

/** The id on the script tag, so a second call replaces the block and never appends one. */
const SCRIPT_ID = 'app-structured-data';

/** Turns "$9" into "9", because a price in JSON-LD carries no currency symbol. */
function priceNumber(label: string): string {
  return label.replace(/[^0-9.]/g, '');
}

/**
 * Writes the JSON-LD block for the landing page.
 *
 * The block states machine-readable brand and product facts. Set your expectations from
 * the evidence: a 2026 controlled study found no measurable citation uplift from
 * structured data alone, and Google retired the FAQ rich result in May 2026. This helps a
 * machine name the publisher and the product. It is not a ranking lever.
 *
 * The service writes through the injected DOCUMENT, the same way the canonical link does
 * in page-title-strategy.ts. Angular's Meta service cannot write a script tag. The write
 * happens during the pre-render, so the block lands in the static HTML that a crawler
 * reads without JavaScript.
 *
 * Every value here is true. The block states no logo, no address, no founding date and no
 * rating, because none of those exist. A product that finds invented facts on other sites
 * does not invent its own.
 */
@Injectable({ providedIn: 'root' })
export class StructuredData {
  private readonly document = inject(DOCUMENT);

  writeLandingBlock(): void {
    const origin = environment.siteOrigin;
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          name: 'GeoStrategy',
          url: `${origin}/`,
          description:
            'GeoStrategy checks whether a small business website can be found in Google, in answer boxes, and inside AI assistants.',
        },
        {
          '@type': 'SoftwareApplication',
          name: 'GeoStrategy',
          url: `${origin}/`,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web browser',
          publisher: { '@id': `${origin}/#organization` },
          description:
            'Check your website, get a score and every problem we find for free, then follow a step-by-step plan to fix them.',
          offers: [
            {
              '@type': 'Offer',
              name: 'Free',
              price: '0',
              priceCurrency: 'USD',
              description: 'Your score and every finding.',
            },
            {
              '@type': 'Offer',
              name: 'Pro',
              price: priceNumber(PRO_PRICE_LABEL),
              priceCurrency: 'USD',
              description: 'The step-by-step plan, the re-check, and your score history.',
            },
          ],
        },
      ],
    };

    let script = this.document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = this.document.createElement('script');
      script.id = SCRIPT_ID;
      script.type = 'application/ld+json';
      this.document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(graph);
  }
}
