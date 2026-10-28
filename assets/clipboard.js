// Some embedded WebKit browsers leave Clipboard API promises pending.
// Keep the control responsive and fall back to copying a temporary selection.
export async function copyText(text) {
  let timeout;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Clipboard timeout')), 1200); })
    ]);
    return;
  } catch {
    const active = document.activeElement;
    const selection = document.getSelection();
    const ranges = selection ? Array.from({length:selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const textarea = document.createElement('textarea');
    textarea.className = 'clipboard-buffer';
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.tabIndex = -1;
    document.body.append(textarea);
    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      textarea.remove();
      active?.focus({preventScroll:true});
      if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    }
  } finally { clearTimeout(timeout); }
}
