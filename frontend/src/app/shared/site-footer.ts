import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  template: `
    <footer class="site-footer divider">
      <span class="brand-faint">GEOSTRATEGY</span>
      <span class="spacer"></span>
      <a routerLink="/pricing">Pricing</a><a routerLink="/terms">Terms</a><a routerLink="/privacy">Privacy</a>
    </footer>
  `,
})
export class SiteFooter {}
