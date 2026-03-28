/**
 * Escape user-provided text for Telegram Markdown mode.
 * Strips characters that can break the Markdown parser.
 */
export function esc(text: string | null | undefined): string {
  if (!text) return "";
  // Replace Markdown special characters with safe equivalents
  return text
    .replace(/\\/g, "")
    .replace(/[_*[\]()~`>#+=|{}.!\-]/g, (c) => `\\${c}`);
}

/**
 * Safe display name — strips problematic unicode and escapes for Markdown.
 * Telegram Markdown chokes on unicode bold/italic chars (𝑁𝑎𝑙𝑒...) and invisible chars.
 */
export function safeName(text: string | null | undefined): string {
  if (!text) return "";
  // Normalize unicode to strip decorative/invisible chars, then escape
  const normalized = text
    .normalize("NFKD") // decompose unicode ligatures/styled chars
    .replace(/[^\x00-\x7F\u0080-\u024F\u0400-\u04FF ]/g, "") // keep Latin, Cyrillic, basic; drop styled unicode
    .trim() || text.trim().slice(0, 20); // fallback to original truncated if normalization empties it
  return esc(normalized);
}
