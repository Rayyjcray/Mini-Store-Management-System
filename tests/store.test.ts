import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { Store, localDay } from '../electron/store'
import { exportRawCSVBackup } from '../electron/csv-backup'
import { buildOwnerReport } from '../electron/owner-report'
const product = (overrides = {}) => ({
  name: 'Pancit Canton',
  sku: 'ND-001',
  category: 'Noodles & canton',
  price: 1800,
  cost: 1400,
  stock: 20,
  low_stock: 5,
  unit: 'pc',
  ...overrides,
})
const customer = (overrides = {}) => ({
  name: 'Ana Santos',
  room: '204',
  phone: '09123456789',
  notes: '',
  credit_limit: 50000,
  ...overrides,
})
const cash = (id: number, quantity = 1) => ({
  items: [{ product_id: id, quantity }],
  payment_method: 'cash',
  paid: 1800 * quantity,
  tendered: 2000 * quantity,
  notes: '',
})
const count = (store: Store, table: string) =>
  (store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n
const cleanup = (folder: string) => {
  const target = resolve(folder)
  assert.equal(dirname(target), resolve(tmpdir()))
  assert.ok(basename(target).startsWith('dormstore-test-'))
  rmSync(target, { recursive: true, force: true })
}

test('fresh database is empty, migrated, and configured for durable transactions', () => {
  const s = new Store(':memory:')
  try {
    assert.equal(s.db.pragma('user_version', { simple: true }), 1)
    assert.equal(s.db.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(s.snapshot().today.revenue, 0)
    assert.equal(s.products().length, 0)
    assert.equal(s.settings().store_name, 'DormStore')
  } finally {
    s.close()
  }
})
test('product validation, unique identifiers, and immutable opening stock on edit', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product())
    assert.equal(s.products()[0].stock, 20)
    assert.throws(() => s.saveProduct(product()), /UNIQUE/)
    assert.throws(() => s.saveProduct(product({ sku: 'INVALID', price: 1.25 })))
    s.saveProduct(product({ id, stock: 999, name: 'Updated noodles' }))
    assert.equal(s.products()[0].stock, 20)
    assert.equal(count(s, 'stock_movements'), 1)
    assert.equal(count(s, 'audit_log'), 2)
  } finally {
    s.close()
  }
})
test('cash sale snapshots price and cost, computes change, and decrements stock', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product()),
      r = s.checkout(cash(id, 2))
    assert.equal(r.sale.total, 3600)
    assert.equal(r.sale.cost, 2800)
    assert.equal(r.sale.change_amount, 400)
    assert.equal(s.products()[0].stock, 18)
    s.saveProduct(product({ id, price: 2500, cost: 1600 }))
    assert.equal(s.receipt(r.sale.id).items[0].price, 1800)
    assert.equal(s.snapshot().today.revenue, 3600)
    assert.equal(s.snapshot().today.cogs, 2800)
  } finally {
    s.close()
  }
})
test('duplicate cart lines are combined and cannot bypass stock limits', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product({ stock: 2 }))
    assert.throws(
      () =>
        s.checkout({
          ...cash(id),
          items: [
            { product_id: id, quantity: 2 },
            { product_id: id, quantity: 1 },
          ],
        }),
      /Not enough stock/,
    )
    assert.equal(s.products()[0].stock, 2)
    assert.equal(count(s, 'sales'), 0)
    const r = s.checkout({
      ...cash(id, 2),
      items: [
        { product_id: id, quantity: 1 },
        { product_id: id, quantity: 1 },
      ],
    })
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0].quantity, 2)
  } finally {
    s.close()
  }
})
test('failed multi-product checkout rolls back every stock, sale, and debt write', () => {
  const s = new Store(':memory:')
  try {
    const a = s.saveProduct(product()),
      b = s.saveProduct(product({ sku: 'ND-002', stock: 0 })),
      c = s.saveCustomer(customer())
    assert.throws(
      () =>
        s.checkout({
          items: [
            { product_id: a, quantity: 1 },
            { product_id: b, quantity: 1 },
          ],
          customer_id: c,
          payment_method: 'credit',
          paid: 0,
          tendered: 0,
          notes: '',
        }),
      /Not enough stock/,
    )
    assert.equal(s.products().find((p) => p.id === a)?.stock, 20)
    assert.equal(count(s, 'sales'), 0)
    assert.equal(count(s, 'customer_ledger'), 0)
  } finally {
    s.close()
  }
})
test('a database write failure rolls back already inserted sales and stock changes', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product())
    s.db.exec(
      "CREATE TRIGGER simulated_failure BEFORE INSERT ON stock_movements WHEN NEW.reason='Sale' BEGIN SELECT RAISE(ABORT,'simulated write error'); END;",
    )
    assert.throws(() => s.checkout(cash(id)), /simulated write error/)
    assert.equal(count(s, 'sales'), 0)
    assert.equal(count(s, 'sale_items'), 0)
    assert.equal(s.products()[0].stock, 20)
  } finally {
    s.close()
  }
})
test('credit sale needs a customer, enforces limit, supports cash down payment and exact repayments', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product()),
      c = s.saveCustomer(customer({ credit_limit: 3000 }))
    const credit = {
      items: [{ product_id: p, quantity: 2 }],
      payment_method: 'credit',
      paid: 0,
      tendered: 0,
      notes: '',
    }
    assert.throws(() => s.checkout(credit), /Select a customer/)
    assert.throws(() => s.checkout({ ...credit, customer_id: c }), /exceed/)
    s.checkout({ ...credit, customer_id: c, paid: 1000, tendered: 1000 })
    assert.equal(s.customerAccount(c).customer.balance, 2600)
    assert.throws(
      () => s.repay({ customer_id: c, amount: 2700, method: 'cash', notes: '' }),
      /exceeds/,
    )
    s.repay({ customer_id: c, amount: 600, method: 'gcash', notes: 'Reference' })
    assert.equal(s.customerAccount(c).customer.balance, 2000)
    assert.throws(() => s.saveCustomer(customer({ id: c, credit_limit: 1000 })), /below/)
    s.repay({ customer_id: c, amount: 2000, method: 'cash', notes: '' })
    assert.equal(s.customerAccount(c).customer.balance, 0)
    assert.equal(s.snapshot().today.revenue, 3600)
    assert.equal(s.snapshot().today.collections, 3600)
  } finally {
    s.close()
  }
})
test('underpayment, over-applied payment, and unsupported payment inputs are rejected', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product())
    assert.throws(() => s.checkout({ ...cash(id), paid: 1000, tendered: 1000 }), /credit/)
    assert.throws(() => s.checkout({ ...cash(id), paid: 1900 }), /exceeds/)
    assert.throws(() => s.checkout({ ...cash(id), tendered: 1700 }), /less than/)
    assert.throws(() => s.checkout({ ...cash(id), payment_method: 'gcash' }), /match/)
    assert.throws(() => s.checkout({ ...cash(id), payment_method: 'bitcoin' }))
    assert.equal(count(s, 'sales'), 0)
  } finally {
    s.close()
  }
})
test('stock adjustments enforce nonnegative stock, signs and auditable reasons', () => {
  const s = new Store(':memory:')
  try {
    const id = s.saveProduct(product({ stock: 2 }))
    assert.throws(
      () => s.adjustStock({ product_id: id, quantity: -3, reason: 'Expired', notes: '' }),
      /between/,
    )
    assert.throws(
      () => s.adjustStock({ product_id: id, quantity: -1, reason: 'Restock', notes: '' }),
      /positive/,
    )
    assert.throws(
      () => s.adjustStock({ product_id: id, quantity: 1, reason: 'Damaged', notes: '' }),
      /remove/,
    )
    s.adjustStock({ product_id: id, quantity: 10, reason: 'Restock', notes: 'Supplier A' })
    s.adjustStock({ product_id: id, quantity: -1, reason: 'Damaged', notes: 'Broken packet' })
    assert.equal(s.products()[0].stock, 11)
    assert.equal(count(s, 'stock_movements'), 3)
  } finally {
    s.close()
  }
})
test('void returns stock, reverses credit and report totals, and prevents duplicate void', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product()),
      c = s.saveCustomer(customer()),
      r = s.checkout({
        items: [{ product_id: p, quantity: 2 }],
        customer_id: c,
        payment_method: 'credit',
        paid: 1000,
        tendered: 1000,
        notes: '',
      })
    s.voidSale({ id: r.sale.id, reason: 'All goods returned' })
    assert.equal(s.products()[0].stock, 20)
    assert.equal(s.customerAccount(c).customer.balance, 0)
    assert.equal(s.receipt(r.sale.id).sale.status, 'voided')
    assert.equal(s.snapshot().today.revenue, 0)
    assert.throws(() => s.voidSale({ id: r.sale.id, reason: 'Again' }), /already voided/)
    assert.equal(count(s, 'sales'), 1)
  } finally {
    s.close()
  }
})
test('a repaid credit sale cannot be voided into a negative customer balance', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product()),
      c = s.saveCustomer(customer()),
      r = s.checkout({
        items: [{ product_id: p, quantity: 1 }],
        customer_id: c,
        payment_method: 'credit',
        paid: 0,
        tendered: 0,
        notes: '',
      })
    s.repay({ customer_id: c, amount: 1800, method: 'cash', notes: '' })
    assert.throws(() => s.voidSale({ id: r.sale.id, reason: 'Returned' }), /repaid/)
    assert.equal(s.products()[0].stock, 19)
    assert.equal(s.customerAccount(c).customer.balance, 0)
  } finally {
    s.close()
  }
})
test('archive preserves history and blocks remaining stock', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product({ stock: 1 }))
    assert.throws(() => s.archiveProduct(p), /remaining stock/)
    const r = s.checkout(cash(p))
    s.archiveProduct(p)
    assert.equal(s.products().length, 0)
    assert.equal(s.receipt(r.sale.id).items[0].name, 'Pancit Canton')
    assert.throws(() => s.checkout(cash(p)), /no longer/)
  } finally {
    s.close()
  }
})
test('expenses, date ranges and profit calculations use all stored history', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product())
    s.checkout(cash(p, 2))
    const e = s.saveExpense({
      description: 'Transport',
      category: 'Transportation',
      amount: 200,
      date: localDay(),
      notes: '',
    })
    const r = s.report({ from: localDay(), to: localDay() })
    assert.equal(r.revenue - r.cogs - r.expenses, 600)
    assert.equal(r.topProducts[0].quantity, 2)
    assert.equal(r.daily.length, 1)
    assert.throws(() => s.report({ from: '2026-02-30', to: '2026-03-01' }))
    assert.throws(() => s.report({ from: '2026-02-01', to: '2026-01-01' }))
    assert.throws(() => s.report({ from: '2020-01-01', to: '2026-01-01' }))
    s.deleteExpense(e)
    assert.equal(s.snapshot().today.expenses, 0)
  } finally {
    s.close()
  }
})
test('starter catalog is explicit, atomic, zero-stock and cannot be loaded twice', () => {
  const s = new Store(':memory:')
  try {
    s.seedCatalog()
    assert.equal(s.products().length, 24)
    assert.ok(s.products().every((p) => p.stock === 0))
    assert.equal(count(s, 'sales'), 0)
    assert.throws(() => s.seedCatalog(), /empty/)
    assert.equal(s.products().length, 24)
  } finally {
    s.close()
  }
})
test('real database survives restart, backups are consistent, restore creates a safety copy', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    path = join(folder, 'store.db'),
    backup = join(folder, 'backup.db')
  let s = new Store(path)
  try {
    const p = s.saveProduct(product()),
      c = s.saveCustomer(customer())
    s.checkout({ ...cash(p), customer_id: c })
    await s.backup(backup)
    s.close()
    s = new Store(path)
    assert.equal(s.products()[0].stock, 19)
    assert.equal(s.snapshot().today.count, 1)
    s.adjustStock({ product_id: p, quantity: 10, reason: 'Restock', notes: '' })
    assert.equal(s.products()[0].stock, 29)
    await s.restore(backup)
    assert.equal(s.products()[0].stock, 19)
    assert.ok(readdirSync(folder).some((f) => f.startsWith('before-restore-')))
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok')
    s.checkout(cash(p))
    assert.equal(s.products()[0].stock, 18)
  } finally {
    s.close()
    cleanup(folder)
  }
})
test('invalid backup and newer schema are rejected without changing live data', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    s = new Store(join(folder, 'store.db'))
  try {
    s.saveProduct(product())
    const bad = join(folder, 'bad.db')
    writeFileSync(bad, 'not a database')
    await assert.rejects(() => s.restore(bad))
    assert.equal(s.products()[0].stock, 20)
    const newer = join(folder, 'new.db'),
      db = new Database(newer)
    db.pragma('user_version=99')
    db.close()
    await assert.rejects(() => s.restore(newer), /valid DormStore/)
    assert.equal(s.products()[0].stock, 20)
    await assert.rejects(() => s.restore(s.path), /active database/)
  } finally {
    s.close()
    cleanup(folder)
  }
})
test('startup recovers the original database after an interrupted restore rename', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    path = join(folder, 'store.db')
  let s = new Store(path)
  try {
    s.saveProduct(product())
    s.close()
    renameSync(path, `${path}.previous`)
    s = new Store(path)
    assert.equal(s.products()[0].stock, 20)
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok')
  } finally {
    s.close()
    cleanup(folder)
  }
})
test('voiding an archived sold-out product makes its returned inventory available again', () => {
  const s = new Store(':memory:')
  try {
    const p = s.saveProduct(product({ stock: 1 })),
      r = s.checkout(cash(p))
    s.archiveProduct(p)
    assert.equal(s.products().length, 0)
    s.voidSale({ id: r.sale.id, reason: 'Goods returned' })
    assert.equal(s.products()[0].stock, 1)
  } finally {
    s.close()
  }
})
test('backup and restore reject aliases of the active database', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    s = new Store(join(folder, 'store.db'))
  try {
    s.saveProduct(product())
    await assert.rejects(() => s.backup(s.path), /different backup location/)
    if (process.platform === 'win32') {
      await assert.rejects(() => s.backup(s.path.toUpperCase()), /different backup location/)
      await assert.rejects(() => s.restore(s.path.toUpperCase()), /active database/)
    }
    const alias = join(folder, 'alias.db')
    linkSync(s.path, alias)
    await assert.rejects(() => s.backup(alias), /different backup location/)
    await assert.rejects(() => s.restore(alias), /active database/)
    assert.equal(s.products()[0].stock, 20)
  } finally {
    s.close()
    cleanup(folder)
  }
})

for (const format of ['CSV', 'xlsx'])
  test(`${format} backup restores every shop table, exact cents, archived products and escaped text`, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
      s = new Store(join(folder, 'store.db'), { shopId: '11111111-1111-4111-8111-111111111111' }),
      backup = join(folder, `backup.${format}`)
    try {
      const p = s.saveProduct(product({ name: '=Coffee, "special"\n第二行', barcode: '\\N' })),
        c = s.saveCustomer(
          customer({ name: "'Ana", room: '002', phone: '+639123456789', notes: '\\N' }),
        ),
        archived = s.saveProduct(product({ sku: 'ARCHIVED', stock: 0, barcode: '' }))
      s.db.prepare('UPDATE products SET barcode=? WHERE id=?').run('', archived)
      s.archiveProduct(archived)
      s.checkout({
        ...cash(p, 2),
        customer_id: c,
        payment_method: 'credit',
        paid: 101,
        tendered: 101,
        notes: 'First line\r\nSecond, "quoted" line',
      })
      s.repay({ customer_id: c, amount: 99, method: 'gcash', notes: '=not a formula' })
      const voided = s.checkout(cash(p))
      s.voidSale({ id: voided.sale.id, reason: 'Full return' })
      s.saveExpense({
        description: 'A delivery',
        category: 'Other',
        amount: 101,
        date: localDay(),
        notes: "'quoted",
      })
      s.saveSettings({ ...s.settings(), address: 'Dorm A, room "2"\nFloor 3' })
      const tableNames = [
        'products',
        'customers',
        'sales',
        'sale_items',
        'stock_movements',
        'customer_ledger',
        'expenses',
        'settings',
        'audit_log',
        'shop_identity',
      ]
      const before = Object.fromEntries(
        tableNames.map((table) => [
          table,
          s.db
            .prepare(`SELECT * FROM ${table} ORDER BY ${table === 'settings' ? 'key' : 'id'}`)
            .all(),
        ]),
      )
      const debt = s.snapshot().totalDebt
      await s.backup(backup)
      if (format === 'CSV') {
        const csv = readFileSync(backup, 'utf8')
        assert.ok(csv.startsWith('\ufeff"DormStore shop backup","2"'))
        assert.ok(csv.includes('"Unpaid customer balances","34.00"'))
        assert.ok(csv.includes('"CUSTOMERS"'))
        assert.ok(csv.includes('"price (PHP)"'))
        assert.ok(csv.includes('"18.00"'))
        assert.ok(csv.includes('"-0.99"'))
        assert.ok(csv.includes('"\'=Coffee, ""special""'))
      } else {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(backup)
        assert.equal(workbook.worksheets[0].name, 'Shop overview')
        assert.equal(workbook.getWorksheet('Customers')!.getCell('D6').value, 34)
        assert.equal(workbook.getWorksheet('Customers')!.getCell('G6').value, 'Owes money')
        assert.equal(workbook.getWorksheet('Sales')!.getCell('C7').value, "'Ana")
        assert.equal(
          workbook.getWorksheet('Inventory')!.getCell('A6').type,
          ExcelJS.ValueType.String,
        )
        assert.equal(workbook.getWorksheet('Inventory')!.getCell('E6').numFmt.includes('₱'), true)
        assert.equal(workbook.getWorksheet('DormStore restore data')!.state, 'veryHidden')
      }
      s.adjustStock({ product_id: p, quantity: 5, reason: 'Restock', notes: '' })
      await s.restore(backup)
      for (const table of tableNames) {
        const after = s.db
          .prepare(`SELECT * FROM ${table} ORDER BY ${table === 'settings' ? 'key' : 'id'}`)
          .all()
        assert.deepEqual(table === 'audit_log' ? after.slice(0, -1) : after, before[table], table)
      }
      assert.equal(s.snapshot().totalDebt, debt)
      const safetyPath = join(
        folder,
        readdirSync(folder).find((file) => file.startsWith('before-restore-'))!,
      )
      const safety = new Database(safetyPath, { readonly: true })
      try {
        assert.equal(
          (safety.prepare('SELECT stock FROM products WHERE id=?').get(p) as { stock: number })
            .stock,
          s.products()[0].stock + 5,
        )
      } finally {
        safety.close()
      }
      assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok')
      assert.equal(
        readdirSync(folder).some((file) => file.startsWith('csv-restore-')),
        false,
      )
    } finally {
      s.close()
      cleanup(folder)
    }
  })

test('CSV restore rejects incomplete, malformed, unrelated and inconsistent files without replacing records', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    s = new Store(join(folder, 'store.db')),
    backup = join(folder, 'backup.csv'),
    bad = join(folder, 'invalid.csv')
  try {
    const p = s.saveProduct(product())
    s.checkout(cash(p))
    await s.backup(backup)
    const original = exportRawCSVBackup(s.db)
    const invalidFiles = [
      'Date,Sales\n2026-11-10,100',
      original.replace('"DormStore CSV backup","1"', '"DormStore CSV backup","99"'),
      original.replace('"Database schema","1"', '"Database schema","99"'),
      original.slice(0, original.indexOf('"End"')),
      original.replace('"id","name","sku"', '"id","id","sku"'),
      original.replace('"18.00"', '"eighteen"'),
      original.replace('"18.00"', '"18.001"'),
      original.replace('"stock_movements","2"', '"stock_movements","999"'),
      original + '"extra","record"\r\n',
      original.replace('"20.00","2.00","cash"', '"20.00","1.00","cash"'),
      original.slice(0, -3),
    ]
    for (const contents of invalidFiles) {
      writeFileSync(bad, contents)
      await assert.rejects(() => s.restore(bad))
      assert.equal(s.products()[0].stock, 19)
      assert.equal(s.snapshot().sales.length, 1)
      assert.equal(
        readdirSync(folder).some((file) => file.startsWith('csv-restore-')),
        false,
      )
      assert.equal(
        readdirSync(folder).some((file) => file.startsWith('before-restore-')),
        false,
      )
    }
    // Broken references are rejected while importing into the staging database.
    writeFileSync(
      bad,
      original.replace('"1","1","1","Pancit Canton"', '"1","1","999","Pancit Canton"'),
    )
    await assert.rejects(() => s.restore(bad), /FOREIGN KEY/)
    // A standard LF file, no BOM, is also restorable.
    writeFileSync(backup, original.replace(/^\ufeff/, '').replaceAll('\r\n', '\n'))
    await s.restore(backup)
    assert.equal(s.products()[0].stock, 19)
  } finally {
    s.close()
    cleanup(folder)
  }
})

test('owner overview reconciles totals, names customers and explains empty sections', async () => {
  const s = new Store(':memory:')
  try {
    const empty = buildOwnerReport(s.db)
    assert.ok(
      empty.sections.every((section) => section.rows.length === 0 && section.empty.includes('No ')),
    )
    const p = s.saveProduct(product()),
      c = s.saveCustomer(customer())
    s.checkout({
      ...cash(p, 2),
      customer_id: c,
      payment_method: 'credit',
      paid: 100,
      tendered: 100,
    })
    s.repay({ customer_id: c, amount: 500, method: 'cash', notes: '' })
    const returned = s.checkout(cash(p))
    s.voidSale({ id: returned.sale.id, reason: 'Returned goods' })
    s.saveExpense({
      description: 'Delivery',
      category: 'Other',
      amount: 200,
      date: localDay(),
      notes: '',
    })
    const report = buildOwnerReport(s.db)
    const metrics = Object.fromEntries(report.summary.map((item) => [item.label, item.value]))
    assert.equal(metrics['Total sales'], 36)
    assert.equal(metrics['Cost of goods sold'], 28)
    assert.equal(metrics['Operating expenses'], 2)
    assert.equal(metrics['Net profit'], 6)
    assert.equal(metrics['Money collected'], 6)
    assert.equal(metrics['Unpaid customer balances'], 30)
    assert.equal(metrics['Stock value at cost'], 252)
    assert.equal(
      report.sections.find((section) => section.name === 'Customers')!.rows[0][0],
      'Ana Santos',
    )
    assert.equal(
      report.sections.find((section) => section.name === 'Credit & repayments')!.rows[1][6],
      30,
    )
    assert.equal(report.sections.find((section) => section.name === 'Sales')!.rows[0][7], 'Voided')
    assert.equal(
      report.sections.find((section) => section.name === 'Stock history')!.rows[0][1],
      'Pancit Canton',
    )
  } finally {
    s.close()
  }
})

test('workbook restore rejects changed reports, corrupted payloads and ordinary workbooks', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    s = new Store(join(folder, 'store.db')),
    backup = join(folder, 'original.xlsx'),
    bad = join(folder, 'changed.xlsx')
  try {
    s.saveProduct(product())
    // Exercise several restore chunks, including Unicode characters.
    for (let i = 0; i < 40; i++)
      s.saveCustomer(customer({ name: `Customer ${i}`, notes: '☕😀'.repeat(250) }))
    await s.backup(backup)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(backup)
    assert.ok(Number(workbook.getWorksheet('DormStore restore data')!.getCell('B3').value) > 1)
    workbook.getWorksheet('Inventory')!.getCell('C6').value = 999
    await workbook.xlsx.writeFile(bad)
    await assert.rejects(() => s.restore(bad), /report values have changed/)
    await workbook.xlsx.readFile(backup)
    workbook.getWorksheet('DormStore restore data')!.getCell('C5').value = 'changed'
    await workbook.xlsx.writeFile(bad)
    await assert.rejects(() => s.restore(bad), /restore data/)
    const ordinary = new ExcelJS.Workbook()
    ordinary.addWorksheet('Products').addRow(['Product', 'Stock'])
    await ordinary.xlsx.writeFile(bad)
    await assert.rejects(() => s.restore(bad), /original workbook/)
    assert.equal(s.products()[0].stock, 20)
    assert.equal(
      readdirSync(folder).some((file) => file.startsWith('before-restore-')),
      false,
    )
    await s.restore(backup)
    assert.equal(s.customers().length, 40)
    assert.equal(s.customers()[0].notes, '☕😀'.repeat(250))
    const foreign = new Store(join(folder, 'foreign.db'), {
      shopId: '22222222-2222-4222-8222-222222222222',
    })
    try {
      await assert.rejects(() => foreign.restore(backup), /current shop/)
    } finally {
      foreign.close()
    }
  } finally {
    s.close()
    cleanup(folder)
  }
})

test('CSV backups retain shop identity and cannot restore another shop or an unlabelled export', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-test-')),
    first = new Store(join(folder, 'first.db'), { shopId: '11111111-1111-4111-8111-111111111111' }),
    second = new Store(join(folder, 'second.db'), {
      shopId: '22222222-2222-4222-8222-222222222222',
    }),
    legacy = new Store(join(folder, 'legacy.db')),
    backup = join(folder, 'backup.csv')
  try {
    first.saveProduct(product())
    await first.backup(backup)
    await assert.rejects(() => second.restore(backup), /current shop/)
    assert.equal(second.products().length, 0)
    await legacy.backup(backup)
    await assert.rejects(() => second.restore(backup), /current shop/)
    await legacy.restore(backup)
    assert.equal(legacy.products().length, 0)
    assert.equal(
      second.db.prepare('SELECT shop_id FROM shop_identity').pluck().get(),
      '22222222-2222-4222-8222-222222222222',
    )
  } finally {
    first.close()
    second.close()
    legacy.close()
    cleanup(folder)
  }
})
