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

  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
