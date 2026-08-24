import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';

@Component({
  selector: 'app-privacy',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface prose">
      <h1>Privacy Policy</h1>
      <p>This is version 1 of our privacy policy, written in plain language.</p>

      <h2>What we store</h2>
      <ul>
        <li>Your account email</li>
        <li>The web addresses you ask us to check</li>
        <li>The reports and plans we generate for you</li>
      </ul>

      <h2>How we use it</h2>
      <p>We use this information to check your site, build your plan, and let you log back in.</p>

      <h2>Who sees it</h2>
      <p>
        We do not sell your data. We only share it with the tools we use to run the service, such
        as hosting and email delivery.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account, for as long as the account is open</li>
        <li>Your reports and plans, for as long as the account is open</li>
        <li>Server logs, for 30 days</li>
        <li>Everything above, for 30 days after you ask us to close the account</li>
      </ul>
      <p>After those 30 days we delete it. Our backups hold a copy for up to 30 days more.</p>

      <h2>How to get it or delete it</h2>
      <p>
        Email <a href="mailto:support@traficio.com">support@traficio.com</a> from the address on
        your account. Ask us for a copy of your data, or ask us to delete it. We reply within 30
        days. Deleting your data closes your account, and we cannot undo it.
      </p>

      <h2>Questions</h2>
      <p>Email us at <a href="mailto:support@traficio.com">support@traficio.com</a>.</p>

      <p><a routerLink="/">Back home</a></p>

      <app-site-footer />
    </div>
  `,
})
export class Privacy {}
