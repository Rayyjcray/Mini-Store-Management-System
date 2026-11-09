import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { Store, localDay } from '../electron/store'
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
