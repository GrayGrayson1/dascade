/** Saves text as a file on this device (a Blob download; nothing leaves the browser). */
export function downloadText(fileName: string, text: string, type: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

/** Saves JSON as a file on this device. */
export function downloadJson(fileName: string, data: unknown): boolean {
  return downloadText(fileName, JSON.stringify(data, null, 2), 'application/json');
}

/** Saves CSV as a file on this device (with a byte-order mark, so spreadsheets read emoji and accents as UTF-8). */
export function downloadCsv(fileName: string, csv: string): boolean {
  return downloadText(fileName, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}
