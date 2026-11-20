/** Saves text as a file the user picks a place for. Works in the webview and in a plain browser. */
export function downloadText(fileName: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The click has handed the blob to the browser; release it on the next turn.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens the system file picker and resolves with the chosen file, or null if cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Opens the system file picker and resolves with the chosen file's text, or null if cancelled. */
export async function pickTextFile(accept: string): Promise<{ readonly name: string; readonly text: string } | null> {
  const file = await pickFile(accept);
  if (!file) return null;
  return file.text().then(
    (text) => ({ name: file.name, text }),
    () => null,
  );
}
