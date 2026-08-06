import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  template: `
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

    <h2>Questions</h2>
    <p>Email us at <a href="mailto:REPLACE_ME_CONTACT_EMAIL">REPLACE_ME_CONTACT_EMAIL</a>.</p>

    <p><a routerLink="/">Back home</a></p>
  `,
})
export class Privacy {}
