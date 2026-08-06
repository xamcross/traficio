import { Component, input } from '@angular/core';
import { ApiError } from '../core/api/api-client';

@Component({
  selector: 'app-error-note',
  template: `@if (error(); as e) {<p class="error-note" role="alert">{{ e.message || 'Something went wrong. Please try again.' }}</p>}`,
  styles: `.error-note { background: #fdecea; color: #b3261e; padding: 0.75rem 1rem; border-radius: 8px; }`,
})
export class ErrorNote {
  error = input<ApiError | null>(null);
}
