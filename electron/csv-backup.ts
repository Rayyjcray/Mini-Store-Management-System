import type Database from 'better-sqlite3'
import { customerSchema, expenseSchema, productSchema, settingsSchema } from '../shared/validation'
import { buildOwnerReport, ownerReportRows } from './owner-report'

type Kind = 'text' | 'integer' | 'money' | 'nullable-text' | 'nullable-integer'
type Column = readonly [string, Kind]
// This order also satisfies the database's foreign keys during import.
const tables: Record<string, readonly Column[]> = {
  products: [
    ['id', 'integer'],
    ['name', 'text'],
    ['sku', 'text'],
    ['barcode', 'nullable-text'],
    ['category', 'text'],
    ['price', 'money'],
    ['cost', 'money'],
    ['stock', 'integer'],
    ['low_stock', 'integer'],
    ['unit', 'text'],
    ['active', 'integer'],
  ],
  customers: [
    ['id', 'integer'],
    ['name', 'text'],
    ['room', 'text'],
    ['phone', 'text'],
    ['notes', 'text'],
    ['credit_limit', 'money'],
  ],
  sales: [
    ['id', 'integer'],
    ['receipt', 'text'],
    ['customer_id', 'nullable-integer'],
    ['total', 'money'],
    ['cost', 'money'],
    ['paid', 'money'],
    ['tendered', 'money'],
    ['change_amount', 'money'],
    ['payment_method', 'text'],
    ['status', 'text'],
    ['notes', 'text'],
    ['created_at', 'text'],
  ],
  sale_items: [
    ['id', 'integer'],
    ['sale_id', 'integer'],
    ['product_id', 'integer'],
    ['name', 'text'],
    ['quantity', 'integer'],
    ['price', 'money'],
    ['cost', 'money'],
  ],
  stock_movements: [
    ['id', 'integer'],
    ['product_id', 'integer'],
    ['quantity', 'integer'],
    ['reason', 'text'],
    ['reference', 'text'],
    ['created_at', 'text'],
  ],
  customer_ledger: [
    ['id', 'integer'],
    ['customer_id', 'integer'],
    ['sale_id', 'nullable-integer'],
    ['amount', 'money'],
    ['type', 'text'],
    ['notes', 'text'],
    ['created_at', 'text'],
  ],
  expenses: [
    ['id', 'integer'],
    ['description', 'text'],
    ['category', 'text'],
    ['amount', 'money'],
    ['date', 'text'],
    ['notes', 'text'],
  ],
  settings: [
    ['key', 'text'],
    ['value', 'text'],
  ],
  audit_log: [
    ['id', 'integer'],
    ['action', 'text'],
    ['details', 'text'],
    ['created_at', 'text'],
  ],
}
type Value = string | number | null
const invalid = (detail: string): never => {
  throw new Error(`Invalid DormStore CSV backup: ${detail}`)
}
// Protect spreadsheet formula prefixes and escape the escape/null markers losslessly.
const escapedText = (value: string) =>
  /^[\\'\s]*[=+@-]|^[\\'\t\r\n]/.test(value) ? `'${value}` : value
const unescapedText = (value: string) =>
  value.startsWith("'") && escapedText(value.slice(1)) === value ? value.slice(1) : value
const heading = ([name, kind]: Column) => (kind === 'money' ? `${name} (PHP)` : name)
const encode = (value: Value, kind: Kind) => {
  if (value === null) return '\\N'
  if (typeof value === 'string') return escapedText(value)
  if (!Number.isSafeInteger(value)) return invalid('unsupported numeric value.')
  return kind === 'money'
    ? `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`
    : String(value)
}
const decode = (value: string, [name, kind]: Column): Value => {
  if (value === '\\N' && kind.startsWith('nullable-')) return null
  if (kind.endsWith('text')) return unescapedText(value)
  if (!(kind === 'money' ? /^-?\d+(\.\d{1,2})?$/ : /^-?\d+$/).test(value))
    return invalid(`invalid number in ${name}.`)
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  const number =
    (kind === 'money' ? Number(whole) * 100 + Number(fraction.padEnd(2, '0')) : Number(whole)) *
    (value.startsWith('-') ? -1 : 1)
  if (!Number.isSafeInteger(number) || (name === 'id' && number <= 0))
    return invalid(`unsupported number in ${name}.`)
  return number
}

/** Strict CSV with BOM, CRLF/LF and quoted commas, newlines and double quotes. */
function parseCSV(input: string): string[][] {
  const text = input.replace(/^\ufeff/, '')
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    endedQuote = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          endedQuote = true
        }
      } else field += char
    } else if (char === ',' || char === '\r' || char === '\n') {
      row.push(field)
      field = ''
      endedQuote = false
      if (char !== ',') {
        rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else if (char === '"' && field === '' && !endedQuote) quoted = true
    else {
      if (char === '"' || endedQuote) invalid('malformed CSV quoting.')
      field += char
    }
  }
  if (quoted) invalid('unfinished quoted field.')
  if (field || endedQuote || row.length) {
    row.push(field)
    rows.push(row)
  }
  while (rows.length && rows.at(-1)!.every((cell) => cell === '')) rows.pop()
  return rows
}

export function exportRawCSVBackup(db: Database.Database): string {
  return db.transaction(() => {
    const hasIdentity = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shop_identity'")
      .get()
    const identity = hasIdentity
      ? (db.prepare('SELECT shop_id FROM shop_identity WHERE id=1').get() as
          { shop_id: string } | undefined)
      : undefined
    const rows: string[][] = [
      ['DormStore CSV backup', '1'],
      ['Database schema', '1'],
      ['Shop ID', identity?.shop_id || ''],
      ['Exported at', new Date().toISOString()],
      ['Currency', 'PHP'],
      [
        'Notes',
        'Full shop backup. Keep all sections and IDs intact for restore. \\N means no value. Accounts and passwords are not included.',
      ],
    ]
    for (const [table, columns] of Object.entries(tables)) {
      const records = db
        .prepare(
          `SELECT ${columns.map(([name]) => `"${name}"`).join(',')} FROM "${table}" ORDER BY ${table === 'settings' ? 'key' : 'id'}`,
        )
        .all() as Record<string, Value>[]
      rows.push(['Table', table, String(records.length)], columns.map(heading))
      for (const record of records)
        rows.push(columns.map(([name, kind]) => encode(record[name], kind)))
    }
    rows.push(['End', 'DormStore CSV backup'])
    return (
      '\ufeff' +
      rows
        .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
        .join('\r\n') +
      '\r\n'
    )
  })()
}

export function exportCSVBackup(db: Database.Database): string {
  return db.transaction(() => {
    const ownerRows = ownerReportRows(buildOwnerReport(db))
    ownerRows.push([], ['DormStore restore records', 'Do not edit below this line'])
    const report = ownerRows
      .map((row) =>
        row
          .map((value) => {
            const safe = /^-?\d+(\.\d+)?$/.test(value) ? value : escapedText(value)
            return `"${safe.replaceAll('"', '""')}"`
          })
          .join(','),
      )
      .join('\r\n')
    return '\ufeff' + report + '\r\n' + exportRawCSVBackup(db).replace(/^\ufeff/, '')
  })()
}

/** Only imports into a fresh staging database; Store.restore performs live replacement. */
export function importCSVBackup(db: Database.Database, input: string) {
  let rows = parseCSV(input)
  // Older v1 CSV backups remain restorable. New exports lead with owner views.
  if (rows[0]?.[0] === 'DormStore shop backup') {
    if (rows[0].length !== 2 || rows[0][1] !== '2') invalid('unsupported report version.')
    const markers = rows
      .map((row, index) =>
        row.length === 2 &&
        row[0] === 'DormStore restore records' &&
        row[1] === 'Do not edit below this line'
          ? index
          : -1,
      )
      .filter((index) => index >= 0)
    if (markers.length !== 1) invalid('missing restore records. Use the original backup file.')
    rows = rows.slice(markers[0] + 1)
  }
  let cursor = 0
  const expect = (expected: string[]) => {
    const row = rows[cursor++]
    if (!row || row.length !== expected.length || row.some((value, i) => value !== expected[i]))
      invalid(`missing or unsupported ${expected[0]}. Choose a CSV backup saved by DormStore.`)
  }
  expect(['DormStore CSV backup', '1'])
  expect(['Database schema', '1'])
  const identity = rows[cursor++]
  if (
    identity?.length !== 2 ||
    identity[0] !== 'Shop ID' ||
    (identity[1] && !/^[0-9a-f-]{36}$/i.test(identity[1]))
  )
    invalid('invalid shop identity.')
  const exported = rows[cursor++]
  if (
    exported?.length !== 2 ||
    exported[0] !== 'Exported at' ||
    Number.isNaN(Date.parse(exported[1]))
  )
    invalid('missing export date.')
  expect(['Currency', 'PHP'])
  const note = rows[cursor++]
  if (note?.length !== 2 || note[0] !== 'Notes') invalid('missing backup notes.')
  db.transaction(() => {
    db.exec('DELETE FROM settings')
    if (identity[1]) {
      db.exec(
        'CREATE TABLE shop_identity(id INTEGER PRIMARY KEY CHECK(id=1), shop_id TEXT NOT NULL)',
      )
      db.prepare('INSERT INTO shop_identity VALUES (1, ?)').run(identity[1])
    }
    for (const [table, columns] of Object.entries(tables)) {
      const section = rows[cursor++]
      if (
        section?.length !== 3 ||
        section[0] !== 'Table' ||
        section[1] !== table ||
        !/^\d+$/.test(section[2])
      )
        invalid(`missing ${table} section.`)
      const count = Number(section[2])
      if (!Number.isSafeInteger(count) || count > rows.length - cursor)
        invalid(`incomplete ${table} section.`)
      expect(columns.map(heading))
      const insert = db.prepare(
        `INSERT INTO "${table}" (${columns.map(([name]) => `"${name}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      for (let i = 0; i < count; i++) {
        const row = rows[cursor++]
        if (!row || row.length !== columns.length) invalid(`invalid row in ${table}.`)
        const values = row.map((value, index) => decode(value, columns[index]))
        const record = Object.fromEntries(columns.map(([name], index) => [name, values[index]]))
        if (table === 'products') {
          productSchema.parse(record)
          if (record.active !== 0 && record.active !== 1) invalid('invalid product status.')
        }
        if (table === 'customers') customerSchema.parse(record)
        if (table === 'expenses') expenseSchema.parse(record)
        insert.run(...values)
      }
    }
    expect(['End', 'DormStore CSV backup'])
    if (cursor !== rows.length) invalid('unexpected extra records.')
    const settings = db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    settingsSchema.parse(Object.fromEntries(settings.map(({ key, value }) => [key, value])))
    if ((db.pragma('foreign_key_check') as unknown[]).length) invalid('broken record references.')
    // CSV is editable, so reject inconsistent payments, totals and customer balances.
    if (
      db
        .prepare(
          `SELECT 1 FROM sales s WHERE
      payment_method NOT IN ('cash','gcash','credit') OR change_amount != tendered-paid OR
      (payment_method != 'cash' AND tendered != paid) OR
      (payment_method != 'credit' AND paid != total) OR
      (payment_method = 'credit' AND customer_id IS NULL) OR
      total != (SELECT COALESCE(SUM(quantity*price),0) FROM sale_items WHERE sale_id=s.id) OR
      cost != (SELECT COALESCE(SUM(quantity*cost),0) FROM sale_items WHERE sale_id=s.id)`,
        )
        .get()
    )
      invalid('inconsistent sale totals or payments.')
    if (
      db
        .prepare(
          `SELECT 1 FROM customer_ledger WHERE
      type NOT IN ('credit_sale','repayment','void') OR
      (type='credit_sale' AND (amount<=0 OR sale_id IS NULL)) OR
      (type IN ('repayment','void') AND amount>=0) OR
      (type='repayment' AND sale_id IS NOT NULL) OR (type='void' AND sale_id IS NULL)`,
        )
        .get()
    )
      invalid('invalid customer ledger.')
    if (
      db
        .prepare(
          `SELECT 1 FROM customers c WHERE
      COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id=c.id),0) NOT BETWEEN 0 AND credit_limit`,
        )
        .get()
    )
      invalid('invalid customer balance.')
  })()
}
