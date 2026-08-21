import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PRO_PRICE_LABEL } from '../../core/config';
import { GuideLayout } from './guide-layout';

@Component({
  selector: 'app-guide-what-seo-costs-a-small-business',
  imports: [RouterLink, GuideLayout],
  template: `
    <app-guide-layout>
      <h1>What SEO costs a small business</h1>
      <p class="lead">
        Search "how much does SEO cost" and you find a wide range of numbers and very little
        honesty about what you get for them. Here is a plain answer, including where we think our
        own tool fits, and where it does not.
      </p>

      <h2>The number agencies quote</h2>
      <p>
        Agencies commonly quote USD 1,000 to 5,000 a month for ongoing SEO work. That is a real
        range, not a scare number: it covers everything from a single freelancer working a few
        hours a month to a full team running content, technical fixes and reporting. For a
        business bringing in a modest income, the top of that range is more than rent. Even the
        bottom of it is a real, recurring cost.
      </p>

      <h2>What that fee usually buys</h2>
      <p>
        A monthly retainer at that price commonly includes a technical audit of your site, ongoing
        content writing, outreach to earn links from other sites, monthly reporting, and a person
        who keeps track of it all so you do not have to. For a business with many pages, many
        locations, or serious competition, that ongoing attention can be worth the cost. The
        market for competitive search terms is genuinely hard, and staying on top of it is real,
        ongoing work.
      </p>

      <h2>What a small business actually needs</h2>
      <p>
        Most small businesses are not fighting for a competitive national search term. A bakery
        does not need to outrank a national chain for the word "food." It needs to be found by
        people searching for a bakery in its own town, and it needs the basics to be right: a
        clear title on each page, a working address and phone number, a page for each thing it
        sells, and enough plain text that a search engine and an AI assistant both understand what
        the business does. Most of that is a one-time job, not a monthly one. Get it right once,
        keep it accurate as things change, and you have covered most of what moves the needle for
        a local business.
      </p>

      <h2>What you can do yourself, for nothing</h2>
      <p>A great deal of this work costs nothing but time. You can:</p>
      <ul>
        <li>Write a clear, honest page for each thing you sell or each service you offer.</li>
        <li>Put your name, address and phone number in the text of the page, not only in an image.</li>
        <li>Give every page a title and a short description that says what the page is about.</li>
        <li>Ask a few existing customers to leave a review where people already look.</li>
        <li>List your business on the free directories that matter in your area.</li>
        <li>Check that your site is not blocking search engines or AI crawlers by mistake.</li>
      </ul>
      <p>None of this needs a developer or a monthly bill. It needs an afternoon, then a habit of keeping it current.</p>

      <h2>Where a {{ price }} tool fits</h2>
      <p>
        This is where a tool like ours fits, and where it does not. GeoStrategy checks your site
        the way a search engine and an AI assistant read it, and gives you a plain list of what to
        fix, in order of what matters most. Your score and every problem we find are free. The
        step-by-step plan, the re-check that confirms a fix worked, and your score history are
        part of Pro, at {{ price }} a month. That is a tool for the one-time and ongoing basics
        above: it tells you what is wrong and how to fix it yourself. It is not a replacement for
        an agency doing sustained content and outreach work.
      </p>

      <h2>Be honest with yourself: should you hire someone?</h2>
      <p>
        If you sell in one town, offer a handful of services, and mostly need the basics right,
        you likely do not need a monthly agency retainer. Fix the basics yourself, keep an eye on
        them, and spend your money elsewhere.
      </p>
      <p>
        If you compete in a crowded market, sell across many locations, or simply do not have the
        time to keep at it, a paid agency or freelancer earns its fee by doing the ongoing work you
        cannot get to. There is no shame in that trade. The mistake is paying an ongoing fee for
        work that was really a one-time fix, or skipping help you genuinely need because a
        checklist looked simple. Know which one you are before you spend. Our
        <a routerLink="/guides/the-beginners-seo-checklist">beginner's SEO checklist</a> is a good
        place to find out.
      </p>
    </app-guide-layout>
  `,
})
export class WhatSeoCostsASmallBusiness {
  protected readonly price = PRO_PRICE_LABEL;
}
