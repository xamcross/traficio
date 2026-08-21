import { Component } from '@angular/core';
import { GuideLayout } from './guide-layout';

@Component({
  selector: 'app-guide-is-your-site-readable-by-chatgpt',
  imports: [GuideLayout],
  template: `
    <app-guide-layout>
      <h1>Is your site readable by ChatGPT?</h1>
      <p class="lead">
        You do not need special software to answer this question. You need five minutes and the
        view-source screen already built into your browser. Here is how to check, step by step.
      </p>

      <h2>What "readable" actually means</h2>
      <p>
        ChatGPT and most other AI assistants do not open your website the way you do. They fetch
        the raw file your server sends, before any JavaScript on the page has run. If your
        business name, your services and your location are only added to the page after
        JavaScript runs in a browser, an assistant's crawler never sees them. Readable simply
        means: are those words already in the raw file.
      </p>

      <h2>How to see what a crawler sees</h2>
      <ol>
        <li>Open your website in a browser.</li>
        <li>
          Right-click anywhere on the page, away from an image or a link, and choose "View Page
          Source." On a phone, or if that option is missing, add "view-source:" to the front of
          your address bar and reload, for example view-source:yourbusiness.com.
        </li>
        <li>
          You now see the raw HTML: the exact file a crawler like GPTBot reads. Ignore the code.
          Use your browser's find tool (Ctrl+F or Cmd+F) and search for a sentence you know is on
          your page: your business name, your phone number, or a short phrase from your homepage.
        </li>
        <li>
          If you find it in the raw source, that content is visible to an AI crawler. If you do
          not find it, but you can see it on the normal page, that content exists only after
          JavaScript runs, and a crawler like GPTBot never sees it.
        </li>
      </ol>

      <h2>What the empty-page problem looks like</h2>
      <p>
        When you view source on a site with this problem, you typically see a very short file: a
        handful of script and link tags in the head, and a body that holds little more than one or
        two empty-looking tags, sometimes literally a div with an id of "root" or "app." All of
        your actual words: your services, your address, your prices, get added to that empty tag
        later, by JavaScript, once a browser runs it. A crawler that does not run JavaScript sees
        only the empty shell. This is common with sites built on certain JavaScript frameworks and
        single-page-app builders, especially if nobody has taken a deliberate step to render the
        content on the server first.
      </p>

      <h2>robots.txt, in plain words</h2>
      <p>
        Every website can have a file at yourdomain.com/robots.txt. It is a plain text file, not a
        program, that tells a well-behaved crawler which parts of the site it may or may not read.
        A line that disallows the whole site tells every crawler that reads it to stay away
        entirely. A line naming a specific crawler tells only that one to stay away. This file is
        a request, not a lock: it works because reputable crawlers choose to respect it. Check
        your own file by visiting yourdomain.com/robots.txt in a browser. If you did not write it
        yourself, someone or something else did, so it is worth reading.
      </p>

      <h2>The crawlers, and what allowing or blocking each one means</h2>
      <ul>
        <li>
          <strong>GPTBot</strong> reads pages to help train and improve OpenAI's models. Blocking
          it keeps your content out of that process, but it does not stop ChatGPT from browsing a
          page live when a user asks it to.
        </li>
        <li>
          <strong>OAI-SearchBot</strong> is the crawler behind ChatGPT's search feature. Blocking
          this one specifically can keep your pages out of ChatGPT's search results.
        </li>
        <li>
          <strong>ChatGPT-User</strong> fetches a specific page live, at the moment a user asks
          ChatGPT to look at it. Blocking it means ChatGPT cannot open your page on request.
        </li>
        <li>
          <strong>ClaudeBot</strong> and <strong>Claude-SearchBot</strong> are Anthropic's
          crawlers, used respectively for general crawling and for Claude's search feature.
          Blocking either keeps your content out of that part of Claude's pipeline.
        </li>
        <li>
          <strong>PerplexityBot</strong> crawls pages for the Perplexity answer engine. Blocking
          it keeps your content from being cited there.
        </li>
      </ul>
      <p>
        For almost every small business, the goal is to be found, so the right setting for all of
        these is usually to allow them. Block one only if you have a specific reason to keep that
        content out of that particular tool.
      </p>

      <h2>What to do next</h2>
      <p>
        If you found your own words in the raw source, and your robots.txt allows these crawlers,
        your site is likely readable today. If you did not find your words, or your robots.txt
        blocks a crawler you want to reach you, you have found your starting point. Either fix
        belongs to whoever built your site: ask them, in plain words, to make sure your key
        content is in the raw HTML, and to check that robots.txt allows the crawlers you want to
        reach.
      </p>
    </app-guide-layout>
  `,
})
export class IsYourSiteReadableByChatgpt {}
