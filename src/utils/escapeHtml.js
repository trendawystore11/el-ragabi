/**
 * V3.52 — HTML-escape helper for legacy innerHTML-based renderers
 * (statements / sync panel). Every interpolated user/stored value that flows
 * into an innerHTML template MUST pass through this so a value smuggled via a
 * Google Sheets import (customer name, notes, sync error, …) can never break
 * out into an executable <script> or event-handler attribute.
 */
export function escapeHtml(value) {
  const s = value == null ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape for a double-quoted HTML attribute value — same escaping, kept as a
 * named alias so call sites self-document that they are attribute contexts.
 */
export const escapeAttr = escapeHtml;
