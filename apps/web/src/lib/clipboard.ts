/**
 * Copy `text` to the system clipboard with a fallback for non-secure
 * contexts (HTTP + non-localhost — common when DinoPanel is hosted on
 * a LAN IP without HTTPS, which is the default smoke-test setup).
 *
 * `navigator.clipboard.writeText` is blocked by Chrome/Firefox outside
 * secure contexts. We try it first because it's the standard path, then
 * fall back to the legacy `document.execCommand('copy')` which still
 * works everywhere — deprecated, but no replacement exists for HTTP
 * pages and browsers haven't removed it.
 *
 * Resolves to `true` on success, `false` when both paths fail (extremely
 * rare — execCommand is universally supported on every browser DinoPanel
 * targets). Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissions / non-secure context — fall through.
    }
  }
  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Off-screen but still focusable + selectable.
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
