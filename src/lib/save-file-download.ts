/**
 * In Tauri, writes to the system Downloads folder via plugin-fs.
 * In the browser, triggers a file download (user’s default download location).
 */
export async function saveBytesAsDownload(
  filename: string,
  data: Uint8Array,
  mimeType: string,
): Promise<void> {
  try {
    const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeFile(filename, data, { baseDir: BaseDirectory.Download })
    return
  } catch {
    // Not Tauri, plugin unavailable, or fs permission — use browser download
  }

  triggerBrowserDownload(filename, data, mimeType)
}

/** Result of a save-with-dialog attempt. */
export type SaveDialogResult = 'saved' | 'cancelled'

/** A single extension filter for the native save dialog, e.g. `{ name: 'Excel Workbook', extensions: ['xlsx'] }`. */
export interface SaveDialogFilter {
  name: string
  extensions: string[]
}

/**
 * In Tauri, opens a native "Save As" dialog so the user picks the destination,
 * then writes the bytes to the chosen path via the `write_file` command.
 * Returns 'cancelled' if the user dismisses the dialog.
 *
 * In the browser (no Tauri), falls back to a normal file download and returns 'saved'.
 */
export async function saveBytesWithDialog(
  defaultFilename: string,
  data: Uint8Array,
  mimeType: string,
  filters?: SaveDialogFilter[],
): Promise<SaveDialogResult> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await save({ defaultPath: defaultFilename, filters })
    if (!path) return 'cancelled'
    await invoke('write_file', { path, contents: Array.from(data) })
    return 'saved'
  } catch {
    // Not Tauri, plugin unavailable — fall back to browser download
  }

  triggerBrowserDownload(defaultFilename, data, mimeType)
  return 'saved'
}

function triggerBrowserDownload(filename: string, data: Uint8Array, mimeType: string) {
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
