import ExcelJS from 'exceljs'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { buildOwnerReport, type ReportSection } from './owner-report'
import { exportRawCSVBackup } from './csv-backup'

const green = '17684E',
  pale = 'EFF8F2',
  ink = '203A32',
  muted = '63786E'
const currency = '"₱"#,##0.00;[Red]("₱"#,##0.00);"₱"0.00'
const restoreSheetName = 'DormStore restore data'
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const invalid = (detail: string): never => {
  throw new Error(`Invalid DormStore workbook backup: ${detail}`)
}

function viewDigest(workbook: ExcelJS.Workbook) {
  const views = workbook.worksheets
    .filter((sheet) => sheet.name !== restoreSheetName)
    .map((sheet) => {
      const cells: [string, ExcelJS.CellValue][] = []
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.type !== ExcelJS.ValueType.Merge && cell.value !== null)
            cells.push([
              cell.address,
              typeof cell.value === 'string' ? cell.value.replace(/\r\n?/g, '\n') : cell.value,
            ])
        }),
      )
      return [sheet.name, cells]
    })
  return digest(JSON.stringify(views))
}
function frame(sheet: ExcelJS.Worksheet, title: string, subtitle: string, width: number) {
  sheet.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }]
  sheet.properties.defaultRowHeight = 26
  sheet.mergeCells(1, 1, 1, width)
  sheet.getCell('A1').value = title
  sheet.getCell('A1').font = { name: 'Aptos Display', size: 24, bold: true, color: { argb: green } }
  sheet.getRow(1).height = 42
  sheet.mergeCells(2, 1, 3, width)
  sheet.getCell('A2').value = subtitle
  sheet.getCell('A2').font = { name: 'Aptos', size: 11, color: { argb: muted } }
  sheet.getCell('A2').alignment = { vertical: 'top', wrapText: true }
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  }
  sheet.headerFooter.oddFooter = 'DormStore | &A | Page &P of &N'
}
function detailSheet(workbook: ExcelJS.Workbook, section: ReportSection) {
  const sheet = workbook.addWorksheet(section.name, { properties: { tabColor: { argb: green } } })
  sheet.columns = section.columns.map((column) => ({ width: column.width }))
  frame(sheet, section.name, section.description, section.columns.length)
  const header = sheet.getRow(5)
  header.values = section.columns.map((column) => column.label)
  header.height = 42
  header.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  if (!section.rows.length) {
    sheet.mergeCells(6, 1, 7, section.columns.length)
    sheet.getCell('A6').value = section.empty
    sheet.getCell('A6').font = { name: 'Aptos', size: 12, italic: true, color: { argb: muted } }
    sheet.getCell('A6').alignment = { vertical: 'middle' }
  }
  section.rows.forEach((values, index) => {
    const row = sheet.getRow(index + 6)
    row.values = values
    row.height = Math.max(
      30,
      ...values
        .filter((value) => typeof value === 'string')
        .map((value) => Math.min(90, String(value).split('\n').length * 18)),
    )
    row.eachCell((cell, col) => {
      cell.font = { name: 'Aptos', size: 11, color: { argb: ink } }
      cell.alignment = { vertical: 'middle', wrapText: typeof cell.value === 'string' }
      if (index % 2 === 0)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } }
      if (section.columns[col - 1].money) cell.numFmt = currency
    })
  })
  if (section.rows.length) {
    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: section.rows.length + 5, column: section.columns.length },
    }
    if (section.columns.some((column) => column.total)) {
      const total = sheet.getRow(section.rows.length + 7)
      total.getCell(1).value = 'TOTAL'
      section.columns.forEach((column, index) => {
        if (column.total) {
          total.getCell(index + 1).value = section.rows.reduce(
            (sum, row) => sum + Number(row[index]),
            0,
          )
          total.getCell(index + 1).numFmt = currency
        }
      })
      total.eachCell((cell) => {
        cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: green } }
      })
    }
  }
  sheet.pageSetup.printTitlesRow = '1:5'
  return sheet
}

export async function exportWorkbookBackup(db: Database.Database, destination: string) {
  const snapshot = db.transaction(() => ({
    report: buildOwnerReport(db),
    raw: exportRawCSVBackup(db),
  }))()
  const { report, raw } = snapshot
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DormStore'
  workbook.created = new Date()
  const overview = workbook.addWorksheet('Shop overview', {
    properties: { tabColor: { argb: green } },
  })
  overview.columns = [
    { width: 38 },
    { width: 24 },
    { width: 4 },
    { width: 24 },
    { width: 24 },
    { width: 24 },
  ]
  frame(
    overview,
    report.storeName,
    `SHOP BACKUP · Saved ${report.exportedAt}\nAll-time totals. Current stock and customer balances are shown as of export.`,
    6,
  )
  overview.views = [{ state: 'normal', showGridLines: false, zoomScale: 90 }]
  const header = overview.getRow(5)
  header.values = ['YOUR SHOP AT A GLANCE', 'AMOUNT / COUNT', '', 'WHAT THIS MEANS']
  overview.mergeCells('D5:F5')
  header.height = 30
  header.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } }
  })
  report.summary.forEach((metric, index) => {
    const row = index + 6
    overview.getCell(row, 1).value = metric.label
    overview.getCell(row, 2).value = metric.value
    overview.getCell(row, 2).numFmt = metric.money ? currency : '#,##0'
    overview.mergeCells(row, 4, row, 6)
    overview.getCell(row, 4).value = metric.explanation
    overview.getRow(row).height = 34
    overview.getRow(row).eachCell((cell, col) => {
      cell.font = { name: 'Aptos', size: 11, color: { argb: ink }, bold: col === 2 }
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (index % 2 === 0)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } }
    })
  })
  const notes: [string, string][] = [
    ['Store details', ''],
    ...report.details,
    [
      'How to read this workbook',
      'Use the tabs below. Customers shows who owes money; Credit & repayments shows how each balance changed.',
    ],
    [
      'Keeping your backup',
      'Keep this original workbook. Restore returns records as saved at export. Editing report cells does not update the backup; changed report values are rejected on restore.',
    ],
    [
      'Accounts',
      'Login accounts and passwords are kept separately and are not included in this shop backup.',
    ],
  ]
  notes.forEach(([label, text], index) => {
    const row = 18 + index
    overview.getCell(row, 1).value = label
    overview.mergeCells(row, 2, row, 6)
    overview.getCell(row, 2).value = text
    overview.getRow(row).height = text.length > 110 ? 48 : 32
    overview.getRow(row).eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 11, color: { argb: muted } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })
  for (const section of report.sections) detailSheet(workbook, section)
  const viewsChecksum = viewDigest(workbook)
  const restore = workbook.addWorksheet(restoreSheetName, { state: 'veryHidden' })
  const chunks =
    Buffer.from(raw, 'utf8')
      .toString('base64')
      .match(/.{1,30000}/g) || []
  restore.addRow(['DormStore workbook backup', '1'])
  restore.addRow(['Backup checksum', digest(raw)])
  restore.addRow(['Chunk count', chunks.length])
  restore.addRow(['Report checksum', viewsChecksum])
  chunks.forEach((chunk, index) => restore.addRow(['Part', index + 1, chunk]))
  await workbook.xlsx.writeFile(destination)
}

export async function readWorkbookBackup(source: string): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(source)
  const sheet = workbook.getWorksheet(restoreSheetName)
  if (
    !sheet ||
    sheet.getCell('A1').value !== 'DormStore workbook backup' ||
    sheet.getCell('B1').value !== '1'
  )
    return invalid('choose an original workbook saved by DormStore.')
  const count = sheet.getCell('B3').value
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    sheet.rowCount !== count + 4
  )
    return invalid('incomplete restore data.')
  const chunks: string[] = []
  for (let i = 0; i < count; i++) {
    const row = sheet.getRow(i + 5)
    if (
      row.getCell(1).value !== 'Part' ||
      row.getCell(2).value !== i + 1 ||
      typeof row.getCell(3).value !== 'string'
    )
      return invalid('incomplete restore data.')
    chunks.push(row.getCell(3).value as string)
  }
  const encoded = chunks.join('')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return invalid('invalid restore data.')
  const raw = Buffer.from(encoded, 'base64').toString('utf8')
  if (digest(raw) !== sheet.getCell('B2').value)
    return invalid('restore data has changed. Use the original backup.')
  if (viewDigest(workbook) !== sheet.getCell('B4').value)
    return invalid('report values have changed. Use the original backup to restore.')
  return raw
}
