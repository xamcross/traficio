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
        GeoStrategy checks your website and gives you a simple plan to help people find it. This is
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

      <h2>Questions</h2>
      <p>Email us at <a href="mailto:support@traficio.com">support@traficio.com</a>.</p>

      <p><a routerLink="/">Back home</a></p>

      <app-site-footer />
    </div>
  `,
})
export class Terms {}
