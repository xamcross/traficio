import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY } from '../../core/config';

@Component({
  selector: 'app-landing',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="hero">
      <h1>See why people cannot find your website.</h1>
      <p>We read your site. Then we give you a simple plan. You fix one thing at a time.</p>

      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>
          Your website
          <input type="text" formControlName="url" placeholder="example.com" autocomplete="url" />
        </label>
        <button type="submit" [disabled]="form.invalid">Check my site</button>
      </form>
    </section>

    <section class="how-it-works">
      <div>
        <h2>1. Tell us your web address.</h2>
      </div>
      <div>
        <h2>2. We check your site.</h2>
      </div>
      <div>
        <h2>3. You follow the plan.</h2>
      </div>
    </section>

    <footer>
      <a routerLink="/pricing">Pricing</a>
      <a routerLink="/terms">Terms</a>
      <a routerLink="/privacy">Privacy</a>
    </footer>
  `,
})
export class Landing {
  private store = inject(UserStore);
  private router = inject(Router);

  protected readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const { url } = this.form.getRawValue();
    sessionStorage.setItem(PENDING_URL_KEY, url);
    this.router.navigateByUrl(this.store.user() ? '/dashboard' : '/signup');
  }
}
