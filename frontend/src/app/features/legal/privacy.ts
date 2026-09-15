import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteFooter } from '../../shared/site-footer';

@Component({
  selector: 'app-privacy',
  imports: [RouterLink, SiteFooter],
  template: `
    <div class="page surface prose">
      <h1>Privacy Policy</h1>
      <p class="muted">Version 2. Last updated 15 September 2026.</p>
      <p>
        This policy says what data Traficio collects, why, who else handles it, how long we keep
        it, and what you can ask us to do with it. We write it in plain language. The short
        version: we store what we need to check your site and run your account, we do not sell it,
        and you can ask us to delete it at any time.
      </p>

      <h2>Who we are</h2>
      <p>
        Traficio is an independent service, run by its owner. The operator of Traficio is the data
        controller for the data described here. Email
        <a href="mailto:support@traficio.com">support@traficio.com</a> for any question about this
        policy or about your data.
      </p>

      <h2>What we collect, and why</h2>

      <h3>Your account</h3>
      <p>
        When you sign up we store your email address, a hash of your password if you set one, and
        whether the email is verified. We use the email to log you in, to send you the verification
        link, the password reset link, and messages about your account. We need this to give you the
        service you signed up for.
      </p>

      <h3>Sign in with Google</h3>
      <p>
        If you sign in with Google, Google tells us your email address and a Google account id, and
        confirms that the address is verified. That is all we ask Google for. We store the email and
        the id, so that your next sign-in finds the same account. We do not receive your Google
        password, your name, your contacts, or anything from your Google Drive or Gmail.
      </p>

      <h3>Your sites and your checks</h3>
      <p>
        You give us a web address. Our crawler, TraficioBot, reads a small number of public pages of
        that site, in the same way a search engine does, and respects the site's robots.txt. We store
        the address, the pages we read, what we found on them, the scores, the report, and the plan
        with the tasks you tick off. We send the content of those pages to Anthropic, whose Claude
        model writes the report and the plan. Check only a site you own or may check.
      </p>

      <h3>Sharing a report</h3>
      <p>
        If you share a result, anyone with the link can read the score and the findings for that
        site. The shared page does not show your email or your plan. You can stop sharing at any
        time from the report page.
      </p>

      <h3>Payment</h3>
      <p>
        Freemius is the seller of the Pro plan and takes the payment. Your card details go to
        Freemius, not to us, and we never see them. Freemius tells us your email, the license and
        subscription ids, the plan, the status, and the renewal date, so that we can turn Pro on and
        off for your account. Freemius handles your payment data under its own privacy policy.
      </p>

      <h3>The free check on the home page</h3>
      <p>
        You can run a short check without an account. To stop abuse, we keep your IP address for
        one hour and allow three such checks per address in that hour. We do not link that check to
        a person.
      </p>

      <h3>Visits, cookies, and logs</h3>
      <p>
        We set one cookie of our own: the session cookie that keeps you logged in for up to 30
        days. Sign in with Google sets a second, short-lived cookie for the duration of that sign-in.
        The Freemius checkout, which opens on our pricing page, may set its own cookies. Cloudflare,
        which serves the site, may set a security cookie. We use no analytics or advertising
        cookies, and we do no tracking across other sites.
      </p>
      <p>
        Our servers log each request: the path, the time, the result, and the time it took. Our
        hosting provider keeps those logs for 7 days.
      </p>

      <h2>The legal ground</h2>
      <p>
        We process your account, your sites, your checks, and your payment status to provide the
        service you asked for. We process the preview limit, the logs, and the security cookies in
        our legitimate interest to keep the service safe and working. We keep payment records where
        the law requires it.
      </p>

      <h2>Who else handles your data</h2>
      <p>We do not sell your data. These providers handle it for us, each for one job:</p>
      <ul>
        <li><strong>Fly.io</strong> runs our API server, in Frankfurt, Germany.</li>
        <li><strong>MongoDB Atlas</strong> stores our database, in Frankfurt, Germany.</li>
        <li>
          <strong>Cloudflare</strong> serves the website, protects the API, and routes mail sent to
          support@traficio.com.
        </li>
        <li><strong>Resend</strong> sends our emails, from a data center in Ireland.</li>
        <li>
          <strong>Anthropic</strong> receives the content of the pages we check and writes the report
          and the plan. Anthropic deletes that content within 30 days and does not use it to train
          its models.
        </li>
        <li><strong>Freemius</strong> sells the Pro plan, takes the payment, and issues the receipt.</li>
        <li><strong>Google</strong> confirms your identity when you sign in with Google.</li>
      </ul>
      <p>
        Fly.io, MongoDB Atlas, and Resend hold your data inside the European Union. Cloudflare,
        Anthropic, Freemius, and Google are based in the United States. Each of them commits, in
        its data processing terms, to the rules the European Union sets for such transfers.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account, your sites, your reports, and your plans: as long as the account is open.</li>
        <li>Your session: 30 days, or until you log out.</li>
        <li>A verification link: 24 hours. A password reset link: one hour.</li>
        <li>The IP address from a free check on the home page: one hour.</li>
        <li>Server logs: 7 days.</li>
        <li>After you ask us to delete your account: we delete everything above within 30 days.</li>
      </ul>
      <p>
        We keep no backup copy of your data at this time. When we delete your data, it is gone.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us for a copy of your data, ask us to correct it, or ask us to delete it. You
        can object to a use of your data that rests on our legitimate interest. You can also complain
        to the data protection authority where you live. To use any of these rights, email
        <a href="mailto:support@traficio.com">support@traficio.com</a> from the address on your
        account. We reply within 30 days. Deleting your data closes your account, and we cannot undo
        it.
      </p>

      <h2>Age</h2>
      <p>Traficio is for people who run a website. You must be 18 or older to use it.</p>

      <h2>Changes to this policy</h2>
      <p>
        When we change this policy, we change the version and the date at the top. For a change that
        affects what we collect or who handles it, we also email the address on your account before
        the change takes effect.
      </p>

      <h2>Questions</h2>
      <p>Email us at <a href="mailto:support@traficio.com">support@traficio.com</a>.</p>

      <p><a routerLink="/">Back home</a></p>

      <app-site-footer />
    </div>
  `,
})
export class Privacy {}
