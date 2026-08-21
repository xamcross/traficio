import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GuideLayout } from './guide-layout';

@Component({
  selector: 'app-guide-why-ai-cannot-find-your-website',
  imports: [RouterLink, GuideLayout],
  template: `
    <app-guide-layout>
      <h1>Why AI cannot find your website</h1>
      <p class="lead">
        You ask ChatGPT about a plumber in your town, and it names three businesses. Yours is not
        one of them, even though your website has been live for years. This is the most common
        question we get, so here is the plain answer.
      </p>

      <h2>The short answer</h2>
      <p>
        An AI assistant can only write about what it can read. If the assistant cannot read the
        words on your site, it cannot mention your business, no matter how good your work is.
        Most of the time, the fix is not about being better at what you do. It is about being
        visible to a machine in the first place.
      </p>

      <h2>AI assistants read raw HTML</h2>
      <p>
        When a person opens your website in a browser, the browser downloads your page, runs the
        JavaScript on it, then shows the finished result. Most crawlers used by AI assistants skip
        that last step. GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot and
        PerplexityBot all read the raw HTML your server sends. None of them runs your JavaScript.
      </p>
      <p>
        This matters because a large number of website builders send a near-empty page first, then
        fill it in with JavaScript once the page loads in a browser. A person never notices,
        because their browser does the filling in for them. An AI crawler does notice. It reads
        the raw file, finds a shell with no text in it, and moves on. Your business, your prices,
        your address: none of it was ever in the file the crawler read.
      </p>
      <p>
        Google is a partial exception. Google renders JavaScript, but on a separate, delayed
        queue, and Google's own advice still favours a server-rendered or pre-rendered page over
        one that depends on JavaScript to show its content. The AI assistants above are not
        exceptions. If the words are not in the HTML, they see nothing.
      </p>

      <h2>The empty-page problem, in practice</h2>
      <p>
        You can check this yourself in a few minutes; our guide on
        <a routerLink="/guides/is-your-site-readable-by-chatgpt">whether your site is readable by ChatGPT</a>
        walks through exactly how. In short: view the page source, not the rendered page, and look
        for your own sentences: your business name, what you sell, your address. If you find
        mostly script tags and almost no text, that is the empty-page problem. It is the single
        most common reason a small business is invisible to AI.
      </p>

      <h2>Other reasons AI cannot find you</h2>
      <p>The empty page is the biggest cause, but it is not the only one.</p>
      <ul>
        <li>
          <strong>Your robots.txt file blocks the crawler.</strong> This is a small text file at
          yourdomain.com/robots.txt that tells crawlers which parts of your site they may read. If
          it disallows GPTBot, ClaudeBot or another assistant's crawler by name, that assistant
          will not read your pages at all, on purpose. Some sites block these crawlers without
          knowing it, often because a plugin or a host set a default rule.
        </li>
        <li>
          <strong>Your pages do not answer a question.</strong> An AI assistant is usually trying
          to answer something a person asked: who does this near me, how much does this cost, does
          this place offer that. If your page never states these things in plain words, an
          assistant has nothing to quote or summarise, even if it can read the page perfectly.
        </li>
        <li>
          <strong>Nobody else links to you or mentions you.</strong> An assistant's own crawl of
          your site is not the only way it learns you exist. It also draws on what other pages say
          about you: a directory listing, a review, a local news mention, another business linking
          to yours. A site with no other page pointing to it, or talking about it, is harder to
          discover in the first place.
        </li>
      </ul>

      <h2>What to check first</h2>
      <p>Work through these in order. Each one takes only a few minutes.</p>
      <ol>
        <li>
          <strong>View source, and look for your own words.</strong> If your name, what you do and
          your location are not in the raw HTML, that is your first and biggest problem.
        </li>
        <li>
          <strong>Check robots.txt.</strong> Open yourdomain.com/robots.txt and make sure it does
          not disallow GPTBot, ClaudeBot, PerplexityBot or the other assistant crawlers.
        </li>
        <li>
          <strong>Read your homepage as a stranger would.</strong> Does it plainly say what you
          do, where you are, and how someone reaches you? Or does it lean on a slogan and a photo?
        </li>
        <li>
          <strong>Search for your business name.</strong> See whether any other site, directory or
          listing mentions you. If none does, an assistant has only your own site to go on.
        </li>
      </ol>
      <p>
        None of these checks needs new software or a rebuild. Once you know which one is failing,
        the fix is usually small. That is the point of this guide: the problem is rarely your
        work. It is usually whether a machine can see it.
      </p>
    </app-guide-layout>
  `,
})
export class WhyAiCannotFindYourWebsite {}
