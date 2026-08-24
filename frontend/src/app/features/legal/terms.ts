import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';

@Component({
  selector: 'app-terms',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface prose">
      <h1>Terms of Service</h1>
      <p>
        Traficio checks your website and gives you a simple plan to help people find it. This is
        version 1 of our terms, written in plain language.
      </p>

      <h2>What we do</h2>
      <p>
        You give us your web address. We look at your site and write a report. We turn the report
        into a short list of tasks. You work through the tasks at your own pace.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account email</li>
        <li>The web addresses you ask us to check</li>
        <li>The reports and plans we generate for you</li>
      </ul>

      <h2>Your account</h2>
      <p>Keep your password safe. You are responsible for what happens under your account.</p>

      <h2>How you may use it</h2>
      <p>Check websites you own, or websites you have permission to check. Do not use the service to:</p>
      <ul>
        <li>Check a site against the wishes of the person who runs it</li>
        <li>Send us addresses in bulk, or through a script</li>
        <li>Resell our reports as your own</li>
        <li>Work around the check limits on your plan</li>
      </ul>
      <p>We may suspend an account that does any of these. We tell you why.</p>

      <h2>Payment</h2>
      <p>
        Free costs nothing and needs no card. Pro costs $9 a month, billed each month in advance.
        Freemius handles the payment and is the seller on your receipt. Prices may change, and we
        tell you at least 30 days before a change reaches your subscription.
      </p>

      <h2>Cancelling</h2>
      <p>
        Cancel at any time, from the customer portal linked on your account page. Your Pro
        features run to the end of the month you have paid for. After that your account returns
        to Free. Your score and your findings stay. Your plan and your history become read-only.
      </p>
      <p>We do not refund part of a month. If we take a payment in error, email us and we return it.</p>

      <h2>What we do not promise</h2>
      <p>
        We tell you what we find and what we would fix. We cannot promise a higher ranking, a
        place in an answer box, or a mention by any AI assistant. Those decisions belong to
        Google, OpenAI and the rest, and none of them tells anyone the full rule.
      </p>

      <h2>Questions</h2>
      <p>Email us at <a href="mailto:support@traficio.com">support@traficio.com</a>.</p>

      <p><a routerLink="/">Back home</a></p>

      <app-site-footer />
    </div>
  `,
})
export class Terms {}
