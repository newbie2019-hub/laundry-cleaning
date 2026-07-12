import ExcelJS from 'exceljs'
import {
  toastBrowserExportFailed,
  toastBrowserExportSuccess,
  toastExportSaved,
} from '../../../lib/export-toast'
import {
  saveBytesAsDownload,
  saveBytesWithDialog,
  type SaveDialogResult,
} from '../../../lib/save-file-download'

/** Header row background (blue-600), matching the app accent. */
export const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF2563EB' },
}
export const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
  name: 'Calibri',
}
export const HEADER_ROW_HEIGHT = 36
export const HEADER_MIN_COL_WIDTH = 12

export const BORDER_THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFE2E8F0' } }
export const BORDER_ALL: Partial<ExcelJS.Borders> = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
}
export const ROW_ALT_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF9FAFB' },
}

export const CURRENCY_FMT = '"₱"#,##0.00'
export const DATE_FMT = 'yyyy-mm-dd'
export const INTEGER_FMT = '0'
export const PERCENT_FMT = '0.00"%"'
export const MAX_COL_WIDTH = 40

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function cellTextLength(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string' || typeof value === 'number') return String(value).length
  if (typeof value === 'boolean') return value ? 4 : 5
  if (value instanceof Date) return 10
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((r) => r.text).join('').length
  }
  if (typeof value === 'object' && 'text' in value && typeof (value as { text: string }).text === 'string') {
    return (value as { text: string }).text.length
  }
  if (typeof value === 'object' && 'formula' in value) return String((value as { result?: unknown }).result ?? '').length
  return String(value).length
}

export function styleHeaderRow(worksheet: ExcelJS.Worksheet) {
  const headerRow = worksheet.getRow(1)
  headerRow.height = HEADER_ROW_HEIGHT
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT as ExcelJS.Font
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    }
    cell.border = BORDER_ALL as ExcelJS.Borders
  })
}

/** After auto-fit, ensure each column is at least wide enough for the header text. */
export function ensureHeaderColumnMinWidths(worksheet: ExcelJS.Worksheet) {
  const columns = worksheet.columns
  if (!columns) return

  columns.forEach((column) => {
    if (!column) return
    const headerText = column.header != null ? String(column.header) : ''
    const fromHeader = Math.max(HEADER_MIN_COL_WIDTH, Math.min(headerText.length + 4, MAX_COL_WIDTH))
    column.width = Math.max(column.width ?? fromHeader, fromHeader)
  })
}

export function autoFitColumns(worksheet: ExcelJS.Worksheet) {
  const columns = worksheet.columns
  if (!columns) return

  columns.forEach((column, colIndex) => {
    if (!column) return
    const headerLen = column.header != null ? String(column.header).length : 0
    let maxLen = headerLen

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const cell = row.getCell(colIndex + 1)
      maxLen = Math.max(maxLen, cellTextLength(cell.value))
    })

    column.width = Math.min(Math.max(maxLen + 2, HEADER_MIN_COL_WIDTH), MAX_COL_WIDTH)
  })
}

export function applyFrozenHeaderAndFilter(worksheet: ExcelJS.Worksheet, columnCount: number) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnCount },
  }
}

export function applyAlternatingRowFills(worksheet: ExcelJS.Worksheet) {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (rowNumber % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = ROW_ALT_FILL
      })
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        bottom: BORDER_THIN,
      } as ExcelJS.Borders
    })
  })
}

/** Declarative column definition used by {@link addStyledSheet}. */
export interface ColumnSpec {
  header: string
  key: string
  /** Optional starting width; auto-fit still applies afterwards. */
  width?: number
  /** Excel number format, e.g. CURRENCY_FMT, DATE_FMT. */
  numFmt?: string
  /** Cell horizontal alignment for the data rows. */
  align?: 'left' | 'center' | 'right'
}

/**
 * Filters a column list down to the given keys (preserving the original order).
 * Returns the full list when `keys` is undefined.
 */
export function selectColumns(columns: ColumnSpec[], keys?: string[]): ColumnSpec[] {
  if (!keys) return columns
  const set = new Set(keys)
  return columns.filter((c) => set.has(c.key))
}

/**
 * Adds a fully pre-formatted worksheet to the workbook: styled header, per-column
 * number formats and alignment, frozen header + autofilter, auto-fit widths and
 * alternating row fills. This is the single place the "pre-formatted" behavior lives.
 *
 * Pass `selectedKeys` to restrict which columns are written (row objects may still
 * contain every key — extra keys are ignored).
 */
export function addStyledSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  allColumns: ColumnSpec[],
  rows: Array<Record<string, ExcelJS.CellValue>>,
  selectedKeys?: string[],
): ExcelJS.Worksheet {
  const columns = selectColumns(allColumns, selectedKeys)
  const worksheet = workbook.addWorksheet(sheetName)
  worksheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  for (const row of rows) {
    worksheet.addRow(row)
  }

  styleHeaderRow(worksheet)
  applyFrozenHeaderAndFilter(worksheet, columns.length)

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    columns.forEach((col, colIndex) => {
      if (!col.numFmt && !col.align) return
      const cell = row.getCell(colIndex + 1)
      if (col.numFmt && cell.value !== '' && cell.value != null) cell.numFmt = col.numFmt
      if (col.align) cell.alignment = { ...cell.alignment, horizontal: col.align, vertical: 'middle' }
    })
  })

  autoFitColumns(worksheet)
  ensureHeaderColumnMinWidths(worksheet)
  applyAlternatingRowFills(worksheet)

  return worksheet
}

async function workbookToBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  const buffer = await workbook.xlsx.writeBuffer()
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
}

/**
 * Serializes the workbook and writes it directly to the Downloads folder
 * (Tauri) or triggers a browser download. Used by the per-page export buttons.
 */
export async function saveWorkbookToDownloads(workbook: ExcelJS.Workbook, filename: string) {
  try {
    const bytes = await workbookToBytes(workbook)
    await saveBytesAsDownload(filename, bytes, XLSX_MIME)
    toastBrowserExportSuccess()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not create the spreadsheet.'
    toastBrowserExportFailed(message)
    throw error
  }
}

/**
 * Serializes the workbook and prompts the user for a destination via the native
 * "Save As" dialog. Returns 'cancelled' (and shows no toast) if the user dismisses
 * the dialog. Used by the centralized Export page.
 */
export async function saveWorkbookWithDialog(
  workbook: ExcelJS.Workbook,
  defaultFilename: string,
): Promise<SaveDialogResult> {
  const bytes = await workbookToBytes(workbook)
  const result = await saveBytesWithDialog(defaultFilename, bytes, XLSX_MIME, [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
  ])
  if (result === 'saved') toastExportSaved()
  return result
}
