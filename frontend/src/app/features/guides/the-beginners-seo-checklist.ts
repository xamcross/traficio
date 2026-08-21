import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GuideLayout } from './guide-layout';

@Component({
  selector: 'app-guide-the-beginners-seo-checklist',
  imports: [RouterLink, GuideLayout],
  template: `
    <app-guide-layout>
      <h1>The beginner's SEO checklist</h1>
      <p class="lead">
        This is the checklist for someone who has never done this before. Work through it in
        order, on your own site, and you will have covered the basics that matter most.
      </p>

      <h2>1. Give every page a clear title</h2>
      <p>
        Every page on your site has a title, the text that appears in the browser tab and as the
        blue link in search results. It should say plainly what the page is and, if it matters,
        where you are: "Plumbing repairs in Springfield | Jane's Plumbing," not just "Home." A
        search engine and an AI assistant both use this title to understand what the page is
        about before they read anything else. A vague title such as "Home" or "Welcome" wastes the
        one line most likely to be read first.
      </p>

      <h2>2. Write a short description for every page</h2>
      <p>
        Below the title, most pages carry a short description, usually a sentence or two, that
        does not always show on the page itself but does appear under your listing in search
        results. Write one for every page that says what a visitor gets there. Skip the keyword
        stuffing; write it the way you would describe the page to a person.
      </p>

      <h2>3. Use the words your customers actually use</h2>
      <p>
        Think about how someone asks for what you do, then use those exact words on the page. A
        person searching does not type "premier culinary solutions." They type "bakery near me" or
        "wedding cake Springfield." If your page never uses the plain words a customer would use,
        neither a search engine nor an AI assistant can match your page to that search. A good
        source for these words is your own inbox: read back through the messages customers have
        already sent you, and notice how they describe what you do in their own words.
      </p>

      <h2>4. Give each thing you sell its own page</h2>
      <p>
        If you offer three services, or sell in three categories, give each one its own page
        rather than a single paragraph on a crowded homepage. A dedicated page can go into real
        detail, use the specific words that service is known by, and be the exact page a search
        engine sends someone to. A single, thin homepage covering everything at once rarely does
        any one thing justice.
      </p>

      <h2>5. Put a working address and phone number in the text</h2>
      <p>
        Your address and phone number need to be actual text on the page, not only inside a logo
        image or a contact form. An AI assistant and a search engine both read text; neither one
        reads an image. Put your address and number in your page's text, ideally in the footer of
        every page, so they are always there no matter which page someone lands on.
      </p>

      <h2>6. Make a sitemap</h2>
      <p>
        A sitemap is a simple file, usually at yourdomain.com/sitemap.xml, that lists every page
        on your site in one place. It helps a search engine find every page you have, including
        ones that are not linked from your homepage. Most modern website builders can generate one
        for you automatically; check whether yours does, and that the file is reachable. A
        sitemap does not replace clear links between your own pages; it is a backup list, not the
        main way a visitor or a crawler finds their way around.
      </p>

      <h2>7. Describe your images</h2>
      <p>
        Every image on your site can carry a short line of text called alt text, describing what
        the image shows. It is not decoration: it is read by screen readers for visitors who
        cannot see the image, and it is one more place a search engine can learn what your page is
        about. Describe the image plainly: "Fresh sourdough loaf on a wooden board," not
        "image1.jpg" or nothing at all.
      </p>

      <h2>Why each step matters</h2>
      <p>
        None of these seven steps is complicated on its own. Together, they add up to the same
        thing: a page that plainly states what you do, where you are, and how to reach you, in
        words a machine can actually read. That is what a search engine ranks, what an answer box
        quotes, and what an AI assistant repeats back to someone asking about a business like
        yours. Skip the trends and the acronyms. Get these seven right, keep them accurate as your
        business changes, and you have done most of what matters. Once the basics are in place,
        our guide on <a routerLink="/guides/why-ai-cannot-find-your-website">why AI cannot find
        your website</a> covers the technical checks worth running next.
      </p>
    </app-guide-layout>
  `,
})
export class TheBeginnersSeoChecklist {}
