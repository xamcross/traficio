import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Rejects an empty value and a value of spaces only. It reports the same error as Validators.required. */
export function notBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim().length === 0 ? { required: true } : null;
}
