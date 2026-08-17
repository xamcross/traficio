import { Component, input } from '@angular/core';
import { ApiError } from '../core/api/api-client';

@Component({
  selector: 'app-error-note',
  template: `@if (error(); as e) {<p class="error-note" role="alert">{{ e.message || 'Something went wrong. Please try again.' }}</p>}`,
})
export class ErrorNote {
  error = input<ApiError | null>(null);
}
