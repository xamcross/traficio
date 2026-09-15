import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';
import { FREE_TIER_COPY, PRO_PRICE_LABEL, PRO_TIER_COPY } from '../../core/config';
import { plural } from '../../shared/copy';

@Component({
  selector: 'app-terms',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface prose">
      <h1>Terms of Service</h1>
      <p class="muted">Version 2. Last updated 15 September 2026.</p>
      <p>
        Traficio checks your website and gives you a simple plan to help people find it. These
        terms are the agreement between you and us when you use it. We write them in plain
        language. By creating an account you accept them.
      </p>

      <h2>Who we are</h2>
      <p>
        Traficio is run by <strong>[OPERATOR NAME, to be confirmed]</strong>,
        <strong>[POSTAL ADDRESS, to be confirmed]</strong>. Email
        <a href="mailto:support@traficio.com">support@traficio.com</a> to reach us.
      </p>

      <h2>What we do</h2>
      <p>
        You give us your web address. Our crawler reads a small number of public pages of that
        site. We write a report with a score and the problems we found. We turn the report into a
        short list of tasks. You work through the tasks at your own pace. An AI model, Claude by
        Anthropic, writes the report and the plan from what the crawler found.
      </p>

      <h2>Your account</h2>
      <p>
        You need an account with a verified email address to check a site. Keep your password
        safe. You are responsible for what happens under your account. Tell us at once if someone
        else uses it. You must be 18 or older.
      </p>

      <h2>How you may use it</h2>
      <p>
        Check websites you own, or websites you have permission to check. Our crawler respects a
        site's robots.txt, and so must you: if a site asks not to be read, we do not read it. Do not
        use the service to:
      </p>
      <ul>
        <li>Check a site against the wishes of the person who runs it</li>
        <li>Send us addresses in bulk, or through a script</li>
        <li>Resell our reports as your own</li>
        <li>Work around the check limits on your plan</li>
        <li>Attack, overload, or probe the service</li>
      </ul>
      <p>We may suspend or close an account that does any of these. We tell you why.</p>

      <h2>Plans and limits</h2>
      <p>
        Free costs nothing and needs no card. It gives you {{ free.sites }}
        {{ plural(free.sites, 'site', 'sites') }} and {{ free.checks }}
        {{ plural(free.checks, 'check', 'checks') }} a month, with the score and the findings. Pro
        costs {{ price }} a month. It gives you {{ pro.sites }} {{ plural(pro.sites, 'site', 'sites') }},
        {{ pro.checks }} {{ plural(pro.checks, 'check', 'checks') }} a month, the full plan, the
        re-check that confirms each fix, and your score history. A check counts against the month
        in which you start it. We may change the limits of the Free plan. We tell you on the pricing
        page.
      </p>

      <h2>Payment</h2>
      <p>
        Freemius, Inc. is the seller of the Pro plan and the name on your receipt. Freemius takes
        the payment, adds the tax that applies where you live, and issues the invoice. Pro is billed
        each month in advance and renews each month until you cancel. Prices may change. We tell
        you at least 30 days before a change reaches your subscription, and you can cancel before it
        does.
      </p>

      <h2>Cancelling and refunds</h2>
      <p>
        Cancel at any time from the Manage subscription link on your account page, or by email to
        <a href="mailto:support@traficio.com">support@traficio.com</a>. Your Pro features run to the
        end of the month you have paid for. After that your account returns to Free. Your score and
        your findings stay. Your plan and your history become read-only, and every site over the
        Free limit becomes read-only too.
      </p>
      <p>
        Freemius gives you a money-back guarantee of <strong>[N, to be confirmed]</strong> days from
        your first payment. Ask for a refund within that period at
        <a href="mailto:support@traficio.com">support@traficio.com</a>, and Freemius returns the
        payment. After that period we do not refund part of a month. If we take a payment in error,
        email us and we return it.
      </p>

      <h2>Your site and our reports</h2>
      <p>
        Your site stays yours. The reports and the plans we write for you are for your own use, or
        for the use of the people who work on your site with you. If you share a result, anyone with
        the link can read it; you can stop sharing at any time. We do not publish your site or your
        results anywhere else. Our
        <a routerLink="/privacy">privacy policy</a> says what we store and who else handles it.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We work to keep the service up, but we do not promise that it is available at every moment.
        We may change or add features, and we may stop a feature. If we stop the service as a whole,
        we tell you at least 30 days ahead, and we refund the unused part of a paid month.
      </p>

      <h2>What we do not promise</h2>
      <p>
        We tell you what we find and what we would fix. We cannot promise a higher ranking, a
        place in an answer box, or a mention by any AI assistant. Those decisions belong to
        Google, OpenAI and the rest, and none of them tells anyone the full rule. Our reports come
        from an automated check and an AI model, and they can be wrong. Use your own judgement before
        you change your site.
      </p>

      <h2>Our liability</h2>
      <p>
        We provide the service as it is. To the extent the law allows, we are not liable for a loss
        of profit, of business, or of data, or for any indirect loss, that comes from your use of the
        service or from a report. Our total liability to you for all claims in any 12 months is
        limited to the amount you paid us in those 12 months. Nothing in these terms limits a
        liability that the law does not let us limit.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the law of <strong>[COUNTRY, to be confirmed]</strong>. A dispute
        that we cannot settle by email goes to the courts of
        <strong>[CITY AND COUNTRY, to be confirmed]</strong>. If you are a consumer, you keep the
        protection of the law of the country where you live.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        When we change these terms, we change the version and the date at the top. For a change that
        affects your rights or your payment, we email the address on your account at least 30 days
        before it takes effect. If you keep using the service after that date, you accept the new
        terms.
      </p>

      <h2>Questions</h2>
      <p>Email us at <a href="mailto:support@traficio.com">support@traficio.com</a>.</p>

      <p><a routerLink="/">Back home</a></p>

      <app-site-footer />
    </div>
  `,
})
export class Terms {
  protected readonly price = PRO_PRICE_LABEL;
  protected readonly free = FREE_TIER_COPY;
  protected readonly pro = PRO_TIER_COPY;
  protected readonly plural = plural;
}
