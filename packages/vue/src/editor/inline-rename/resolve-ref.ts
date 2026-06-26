/**
 * Resolves a Vue `templateRef` binding to a single DOM element.
 *
 * Vue collects a ref as an array when the referenced element is rendered
 * inside a flattened v-for (see upstream #288). This helper unwraps both
 * the single-element and array shapes so callers can treat the result
 * uniformly as `HTMLInputElement | null`.
 */
export function pickInput(ref: HTMLInputElement | HTMLInputElement[] | null): HTMLInputElement | null {
  if (!ref) return null
  return Array.isArray(ref) ? (ref[0] ?? null) : ref
}
