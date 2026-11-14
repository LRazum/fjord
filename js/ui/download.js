// Hand a generated file to the user. On phones the share sheet is the reliable way
// (in-app browsers such as Bluefy often cannot download blobs); on desktop a normal
// download is nicer.

/** @returns {Promise<'shared' | 'cancelled' | 'downloaded'>} */
export async function saveFile(filename, mime, text) {
  const blob = new Blob([text], { type: mime });

  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && typeof File === 'function') {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // Anything else: fall through to a plain download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
