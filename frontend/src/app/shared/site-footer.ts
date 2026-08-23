import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandMark } from './brand-mark';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, BrandMark],
  template: `
    <footer class="site-footer divider">
      <span class="brand-faint"><app-brand-mark [size]="15" />GEOSTRATEGY</span>
      <span class="spacer"></span>
      <a routerLink="/pricing">Pricing</a><a routerLink="/terms">Terms</a><a routerLink="/privacy">Privacy</a>
    </footer>
  `,
})
export class SiteFooter {}
