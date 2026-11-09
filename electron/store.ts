import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, renameSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { ZodError } from 'zod'
import type {
  Customer,
  CustomerAccount,
  Expense,
  LedgerEntry,
  Movement,
  Product,
  Receipt,
  Report,
  Sale,
  SaleItem,
  Settings,
  Snapshot,
} from '../shared/contracts'
import {
  checkoutSchema,
  customerSchema,
  expenseSchema,
  idSchema,
  productSchema,
  rangeSchema,
  repaymentSchema,
  settingsSchema,
  stockSchema,
  voidSchema,
} from '../shared/validation'

export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export function errorMessage(error: unknown): string {
  if (error instanceof ZodError)
    return error.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; ')
  if (error instanceof Error) {
    if (error.message.includes('UNIQUE constraint failed: products.sku'))
      return 'That SKU already exists. Choose a unique SKU.'
    if (error.message.includes('UNIQUE constraint failed: products.barcode'))
      return 'That barcode is already assigned to another product.'
    return error.message
  }
  return 'The operation could not be completed.'
}
const boundedMoney = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000)
    throw new Error('Transaction amount exceeds the supported limit (₱1,000,000).')
  return amount
}
const sameFile = (first: string, second: string) => {
  const normalize = (path: string) =>
    process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  if (normalize(first) === normalize(second)) return true
  if (!existsSync(first) || !existsSync(second)) return false
  const a = statSync(first, { bigint: true }),
    b = statSync(second, { bigint: true })
  return a.ino !== 0n && a.dev === b.dev && a.ino === b.ino
}

export class Store {
  db!: Database.Database
  constructor(
    public path: string,
    private scope?: { shopId: string; allowLegacyBackup?: boolean },
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.open()
  }
  private open() {
    if (this.path !== ':memory:' && !existsSync(this.path) && existsSync(`${this.path}.previous`)) {
      // Recover if the process stopped between the two restore renames.
      renameSync(`${this.path}.previous`, this.path)
    }
    this.db = new Database(this.path)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('trusted_schema = OFF')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 1) {
      this.db.close()
      throw new Error('This database needs a newer DormStore version.')
    }
    if (version === 0) this.migrate()
    if (this.scope) {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS shop_identity(id INTEGER PRIMARY KEY CHECK(id=1),shop_id TEXT NOT NULL)',
      )
      const identity = this.db.prepare('SELECT shop_id FROM shop_identity WHERE id=1').get() as
        { shop_id: string } | undefined
      if (identity && identity.shop_id !== this.scope.shopId) {
        this.db.close()
        throw new Error('This database belongs to a different shop.')
      }
      if (!identity)
        this.db.prepare('INSERT INTO shop_identity VALUES (1,?)').run(this.scope.shopId)
    }
  }
  private migrate() {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE,
          barcode TEXT UNIQUE, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0),
          cost INTEGER NOT NULL CHECK(cost >= 0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
          low_stock INTEGER NOT NULL DEFAULT 5 CHECK(low_stock >= 0), unit TEXT NOT NULL DEFAULT 'pc', active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE customers (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, room TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '', credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit >= 0)
        );
        CREATE TABLE sales (
          id INTEGER PRIMARY KEY, receipt TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id),
          total INTEGER NOT NULL CHECK(total >= 0), cost INTEGER NOT NULL CHECK(cost >= 0),
          paid INTEGER NOT NULL CHECK(paid >= 0 AND paid <= total), tendered INTEGER NOT NULL CHECK(tendered >= paid),
          change_amount INTEGER NOT NULL CHECK(change_amount >= 0), payment_method TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided')),
          notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','localtime'))
        );
        CREATE TABLE sale_items (
          id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id),
          name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), price INTEGER NOT NULL CHECK(price >= 0), cost INTEGER NOT NULL CHECK(cost >= 0)
        );
        CREATE TABLE stock_movements (
          id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity != 0),
          reason TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','localtime'))
        );
        CREATE TABLE customer_ledger (
          id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), sale_id INTEGER REFERENCES sales(id),
          amount INTEGER NOT NULL CHECK(amount != 0), type TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','localtime'))
        );
        CREATE TABLE expenses (
          id INTEGER PRIMARY KEY, description TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','localtime')));
        CREATE INDEX sales_date ON sales(created_at);
        CREATE INDEX items_sale ON sale_items(sale_id);
        CREATE INDEX ledger_customer ON customer_ledger(customer_id);
        CREATE INDEX expenses_date ON expenses(date);
        PRAGMA user_version = 1;
      `)
      const insert = this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      for (const [key, value] of Object.entries({
        store_name: 'DormStore',
        owner_name: '',
        address: '',
        receipt_footer: 'Thank you! See you around the dorm.',
      }))
        insert.run(key, value)
    })()
  }
  private audit(action: string, details: unknown) {
    this.db
      .prepare('INSERT INTO audit_log(action,details) VALUES (?,?)')
      .run(action, JSON.stringify(details))
  }
  private movement(product: number, quantity: number, reason: string, reference: string) {
    this.db
      .prepare('INSERT INTO stock_movements(product_id,quantity,reason,reference) VALUES (?,?,?,?)')
      .run(product, quantity, reason, reference)
  }
  products() {
    return this.db
      .prepare('SELECT * FROM products WHERE active=1 ORDER BY name COLLATE NOCASE')
      .all() as Product[]
  }
  customers() {
    return this.db
      .prepare(
        'SELECT c.*, COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id=c.id),0) AS balance FROM customers c ORDER BY name COLLATE NOCASE',
      )
      .all() as Customer[]
  }
  settings(): Settings {
    return Object.fromEntries(
      (this.db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]).map(
        (v) => [v.key, v.value],
      ),
    ) as unknown as Settings
  }
  snapshot(): Snapshot {
    const today = localDay()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    const customers = this.customers()
    return {
      products: this.products(),
      customers,
      sales: this.db
        .prepare(
          'SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 500',
        )
        .all() as Sale[],
      expenses: this.db
        .prepare('SELECT * FROM expenses ORDER BY date DESC,id DESC')
        .all() as Expense[],
      movements: this.db
        .prepare(
          'SELECT m.*,p.name AS product_name FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 300',
        )
        .all() as Movement[],
      settings: this.settings(),
      today: this.report({ from: today, to: today }),
      weekly: this.report({ from: localDay(start), to: today }),
      totalDebt: customers.reduce((sum, c) => sum + c.balance, 0),
      databasePath: this.path,
    }
  }
  saveProduct(input: unknown) {
    const p = productSchema.parse(input)
    return this.db.transaction(() => {
      if (p.id) {
        const old = this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(p.id) as
          Product | undefined
        if (!old) throw new Error('Product no longer exists.')
        // Existing stock is changed only through the inventory ledger.
        this.db
          .prepare(
            'UPDATE products SET name=?,sku=?,barcode=?,category=?,price=?,cost=?,low_stock=?,unit=? WHERE id=?',
          )
          .run(
            p.name,
            p.sku,
            p.barcode || null,
            p.category,
            p.price,
            p.cost,
            p.low_stock,
            p.unit,
            p.id,
          )
        this.audit('product.update', { before: old, after: p })
        return p.id
      }
      const result = this.db
        .prepare(
          'INSERT INTO products(name,sku,barcode,category,price,cost,stock,low_stock,unit) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          p.name,
          p.sku,
          p.barcode || null,
          p.category,
          p.price,
          p.cost,
          p.stock,
          p.low_stock,
          p.unit,
        )
      const id = Number(result.lastInsertRowid)
      if (p.stock) this.movement(id, p.stock, 'Opening stock', '')
      this.audit('product.create', { id, ...p })
      return id
    })()
  }
  archiveProduct(input: unknown) {
    const id = idSchema.parse(input)
    this.db.transaction(() => {
      const product = this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id) as
        Product | undefined
      if (!product) throw new Error('Product no longer exists.')
      if (product.stock !== 0)
        throw new Error('Adjust remaining stock to zero before archiving this product.')
      this.db.prepare('UPDATE products SET active=0 WHERE id=?').run(id)
      this.audit('product.archive', { id })
    })()
  }
  adjustStock(input: unknown) {
    const a = stockSchema.parse(input)
    this.db.transaction(() => {
      const p = this.db
        .prepare('SELECT * FROM products WHERE id=? AND active=1')
        .get(a.product_id) as Product | undefined
      if (!p) throw new Error('Product no longer exists.')
      if (p.stock + a.quantity < 0 || p.stock + a.quantity > 1_000_000)
        throw new Error('Stock must stay between 0 and 1,000,000 units.')
      if (a.reason === 'Restock' && a.quantity < 0)
        throw new Error('Restock quantity must be positive.')
      if (['Damaged', 'Expired', 'Personal use'].includes(a.reason) && a.quantity > 0)
        throw new Error('This adjustment must remove stock.')
      this.db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(a.quantity, a.product_id)
      this.movement(a.product_id, a.quantity, a.reason, a.notes)
      this.audit('stock.adjust', a)
    })()
  }
  saveCustomer(input: unknown) {
    const c = customerSchema.parse(input)
    return this.db.transaction(() => {
      if (c.id) {
        const existing = this.customers().find((x) => x.id === c.id)
        if (!existing) throw new Error('Customer no longer exists.')
        if (c.credit_limit < existing.balance)
          throw new Error('Credit limit cannot be below the outstanding balance.')
        this.db
          .prepare('UPDATE customers SET name=?,room=?,phone=?,notes=?,credit_limit=? WHERE id=?')
          .run(c.name, c.room, c.phone, c.notes, c.credit_limit, c.id)
        this.audit('customer.update', c)
        return c.id
      }
      const result = this.db
        .prepare('INSERT INTO customers(name,room,phone,notes,credit_limit) VALUES (?,?,?,?,?)')
        .run(c.name, c.room, c.phone, c.notes, c.credit_limit)
      const id = Number(result.lastInsertRowid)
      this.audit('customer.create', { id, ...c })
      return id
    })()
  }
  customerAccount(input: unknown): CustomerAccount {
    const id = idSchema.parse(input)
    const customer = this.customers().find((c) => c.id === id)
    if (!customer) throw new Error('Customer no longer exists.')
    return {
      customer,
      ledger: this.db
        .prepare('SELECT * FROM customer_ledger WHERE customer_id=? ORDER BY id DESC')
        .all(id) as LedgerEntry[],
    }
  }
  repay(input: unknown) {
    const r = repaymentSchema.parse(input)
    this.db.transaction(() => {
      const { customer } = this.customerAccount(r.customer_id)
      if (r.amount > customer.balance) throw new Error('Payment exceeds the outstanding balance.')
      this.db
        .prepare(
          "INSERT INTO customer_ledger(customer_id,amount,type,notes) VALUES (?,?,'repayment',?)",
        )
        .run(r.customer_id, -r.amount, `${r.method}: ${r.notes}`)
      this.audit('customer.repayment', r)
    })()
  }
  checkout(input: unknown): Receipt {
    const c = checkoutSchema.parse(input)
    return this.db.transaction(() => {
      const merged = new Map<number, number>()
      for (const item of c.items)
        merged.set(item.product_id, (merged.get(item.product_id) || 0) + item.quantity)
      const lines = [...merged].map(([id, quantity]) => {
        const p = this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id) as
          Product | undefined
        if (!p) throw new Error('A product in this cart is no longer available.')
        if (p.stock < quantity)
          throw new Error(`Not enough stock for ${p.name}. Available: ${p.stock}.`)
        return { ...p, quantity }
      })
      const total = boundedMoney(lines.reduce((sum, p) => sum + p.price * p.quantity, 0))
      const cost = boundedMoney(lines.reduce((sum, p) => sum + p.cost * p.quantity, 0))
      if (c.paid > total)
        throw new Error(
          'Applied payment exceeds the sale total. Enter excess cash as cash received.',
        )
      if (c.tendered < c.paid) throw new Error('Cash received is less than the applied payment.')
      if (c.payment_method === 'gcash' && c.tendered !== c.paid)
        throw new Error('GCash amount must match the applied payment.')
      const debt = total - c.paid
      if (c.payment_method !== 'credit' && debt > 0)
        throw new Error('Choose customer credit for an unpaid balance.')
      if (c.payment_method === 'credit' && c.tendered !== c.paid)
        throw new Error('For credit sales, the down payment and received amount must match.')
      if (c.customer_id) {
        const { customer } = this.customerAccount(c.customer_id)
        if (customer.balance + debt > customer.credit_limit)
          throw new Error('This sale would exceed the customer’s credit limit.')
      } else if (debt > 0 || c.payment_method === 'credit')
        throw new Error('Select a customer for a credit sale.')
      const receipt = `DS-${localDay().replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`
      const result = this.db
        .prepare(
          'INSERT INTO sales(receipt,customer_id,total,cost,paid,tendered,change_amount,payment_method,notes) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          receipt,
          c.customer_id || null,
          total,
          cost,
          c.paid,
          c.tendered,
          c.tendered - c.paid,
          c.payment_method,
          c.notes,
        )
      const id = Number(result.lastInsertRowid)
      for (const p of lines) {
        this.db
          .prepare(
            'INSERT INTO sale_items(sale_id,product_id,name,quantity,price,cost) VALUES (?,?,?,?,?,?)',
          )
          .run(id, p.id, p.name, p.quantity, p.price, p.cost)
        this.db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(p.quantity, p.id)
        this.movement(p.id, -p.quantity, 'Sale', receipt)
      }
      if (debt > 0)
        this.db
          .prepare(
            "INSERT INTO customer_ledger(customer_id,sale_id,amount,type,notes) VALUES (?,?,?,'credit_sale',?)",
          )
          .run(c.customer_id, id, debt, receipt)
      this.audit('sale.complete', { id, receipt })
      return this.receipt(id)
    })()
  }
  receipt(input: unknown): Receipt {
    const id = idSchema.parse(input)
    const sale = this.db
      .prepare(
        'SELECT s.*,c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?',
      )
      .get(id) as Sale | undefined
    if (!sale) throw new Error('Sale not found.')
    return {
      sale,
      items: this.db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(id) as SaleItem[],
      settings: this.settings(),
    }
  }
  voidSale(input: unknown) {
    const v = voidSchema.parse(input)
    this.db.transaction(() => {
      const { sale, items } = this.receipt(v.id)
      if (sale.status === 'voided') throw new Error('This sale is already voided.')
      const debt = sale.total - sale.paid
      if (debt && sale.customer_id) {
        const { customer } = this.customerAccount(sale.customer_id)
        if (customer.balance < debt)
          throw new Error(
            'This credit has already been repaid. Its full outstanding credit must remain before it can be voided.',
          )
        this.db
          .prepare(
            "INSERT INTO customer_ledger(customer_id,sale_id,amount,type,notes) VALUES (?,?,?,'void',?)",
          )
          .run(sale.customer_id, sale.id, -debt, v.reason)
      }
      for (const item of items) {
        const product = this.db
          .prepare('SELECT stock FROM products WHERE id=?')
          .get(item.product_id) as { stock: number }
        if (product.stock + item.quantity > 1_000_000)
          throw new Error(
            'Returned stock would exceed 1,000,000 units. Adjust inventory before voiding.',
          )
        this.db
          .prepare('UPDATE products SET stock=stock+?,active=1 WHERE id=?')
          .run(item.quantity, item.product_id)
        this.movement(item.product_id, item.quantity, 'Sale void', `${sale.receipt}: ${v.reason}`)
      }
      this.db.prepare("UPDATE sales SET status='voided' WHERE id=?").run(v.id)
      this.audit('sale.void', { ...v, refundDue: sale.paid })
    })()
  }
  saveExpense(input: unknown) {
    const e = expenseSchema.parse(input)
    return this.db.transaction(() => {
      if (e.id) {
        if (!this.db.prepare('SELECT id FROM expenses WHERE id=?').get(e.id))
          throw new Error('Expense no longer exists.')
        this.db
          .prepare(
            'UPDATE expenses SET description=?,category=?,amount=?,date=?,notes=? WHERE id=?',
          )
          .run(e.description, e.category, e.amount, e.date, e.notes, e.id)
        this.audit('expense.update', e)
        return e.id
      }
      const result = this.db
        .prepare('INSERT INTO expenses(description,category,amount,date,notes) VALUES (?,?,?,?,?)')
        .run(e.description, e.category, e.amount, e.date, e.notes)
      const id = Number(result.lastInsertRowid)
      this.audit('expense.create', { id, ...e })
      return id
    })()
  }
  deleteExpense(input: unknown) {
    const id = idSchema.parse(input)
    this.db.transaction(() => {
      const expense = this.db.prepare('SELECT * FROM expenses WHERE id=?').get(id)
      if (!expense) throw new Error('Expense no longer exists.')
      this.db.prepare('DELETE FROM expenses WHERE id=?').run(id)
      this.audit('expense.delete', expense)
    })()
  }
  report(input: unknown): Report {
    const { from, to } = rangeSchema.parse(input)
    const start = `${from}T00:00:00`,
      end = `${to}T23:59:59.999`
    const sums = this.db
      .prepare(
        "SELECT COALESCE(SUM(total),0) revenue,COALESCE(SUM(cost),0) cogs,COUNT(*) count,COALESCE(SUM(paid),0) collections FROM sales WHERE status='completed' AND created_at BETWEEN ? AND ?",
      )
      .get(start, end) as { revenue: number; cogs: number; count: number; collections: number }
    const expenses = (
      this.db
        .prepare('SELECT COALESCE(SUM(amount),0) value FROM expenses WHERE date BETWEEN ? AND ?')
        .get(from, to) as { value: number }
    ).value
    const repayments = (
      this.db
        .prepare(
          "SELECT COALESCE(-SUM(amount),0) value FROM customer_ledger WHERE type='repayment' AND created_at BETWEEN ? AND ?",
        )
        .get(start, end) as { value: number }
    ).value
    const rows = this.db
      .prepare(
        "SELECT substr(created_at,1,10) date,SUM(total) revenue,SUM(total-cost) profit FROM sales WHERE status='completed' AND created_at BETWEEN ? AND ? GROUP BY date ORDER BY date",
      )
      .all(start, end) as Report['daily']
    const daily: Report['daily'] = []
    for (
      let date = new Date(`${from}T12:00:00`);
      localDay(date) <= to;
      date.setDate(date.getDate() + 1)
    ) {
      const key = localDay(date)
      daily.push(rows.find((r) => r.date === key) || { date: key, revenue: 0, profit: 0 })
    }
    const topProducts = this.db
      .prepare(
        "SELECT i.name,SUM(i.quantity) quantity,SUM(i.quantity*i.price) revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.status='completed' AND s.created_at BETWEEN ? AND ? GROUP BY i.product_id ORDER BY revenue DESC LIMIT 10",
      )
      .all(start, end) as Report['topProducts']
    const categories = this.db
      .prepare(
        "SELECT p.category name,SUM(i.quantity*i.price) revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE s.status='completed' AND s.created_at BETWEEN ? AND ? GROUP BY p.category ORDER BY revenue DESC",
      )
      .all(start, end) as Report['categories']
    return {
      ...sums,
      expenses,
      collections: sums.collections + repayments,
      daily,
      topProducts,
      categories,
    }
  }
  saveSettings(input: unknown) {
    const s = settingsSchema.parse(input)
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(s))
        this.db.prepare('UPDATE settings SET value=? WHERE key=?').run(value, key)
      this.audit('settings.update', s)
    })()
  }
  seedCatalog() {
    this.db.transaction(() => {
      if ((this.db.prepare('SELECT COUNT(*) count FROM products').get() as { count: number }).count)
        throw new Error('The starter catalog can only be loaded into an empty catalog.')
      const items: [string, string, Product['category'], number, number][] = [
        ['Argentina Corned Beef 150g', 'CB-001', 'Canned goods', 45, 37],
        ['Century Tuna Flakes 155g', 'CB-002', 'Canned goods', 42, 34],
        ['Sardines in Tomato Sauce', 'CB-003', 'Canned goods', 25, 20],
        ['Lucky Me Pancit Canton', 'ND-001', 'Noodles & canton', 18, 14],
        ['Lucky Me Beef Noodles', 'ND-002', 'Noodles & canton', 14, 11],
        ['Cup Noodles Seafood', 'ND-003', 'Noodles & canton', 32, 26],
        ['SkyFlakes Crackers', 'SN-001', 'Snacks & biscuits', 8, 6],
        ['Oreo Original 29.4g', 'SN-002', 'Snacks & biscuits', 12, 9],
        ['Piattos Cheese 40g', 'SN-003', 'Snacks & biscuits', 22, 17],
        ['Bottled Water 500ml', 'BV-001', 'Water & beverages', 15, 9],
        ['Coca-Cola 290ml', 'BV-002', 'Water & beverages', 22, 16],
        ['C2 Green Tea 355ml', 'BV-003', 'Water & beverages', 25, 19],
        ['Nescafé 3-in-1 Sachet', 'CF-001', 'Coffee & drinks', 12, 8],
        ['Milo Sachet 24g', 'CF-002', 'Coffee & drinks', 12, 9],
        ['Tang Orange Sachet', 'CF-003', 'Coffee & drinks', 22, 17],
        ['Safeguard Soap 60g', 'TL-001', 'Toiletries', 28, 22],
        ['Colgate Toothpaste Sachet', 'TL-002', 'Toiletries', 10, 7],
        ['Sunsilk Shampoo Sachet', 'TL-003', 'Toiletries', 8, 5],
        ['Tide Powder Sachet', 'LN-001', 'Laundry supplies', 12, 9],
        ['Downy Fabric Conditioner', 'LN-002', 'Laundry supplies', 10, 7],
        ['Surf Powder Sachet', 'LN-003', 'Laundry supplies', 10, 7],
        ['Tissue Pocket Pack', 'DE-001', 'Dorm essentials', 10, 6],
        ['Ballpen Black', 'DE-002', 'Dorm essentials', 12, 7],
        ['AA Battery Pair', 'DE-003', 'Dorm essentials', 30, 20],
      ]
      for (const [name, sku, category, price, cost] of items)
        this.saveProduct({
          name,
          sku,
          category,
          price: price * 100,
          cost: cost * 100,
          stock: 0,
          low_stock: 5,
          unit: 'pc',
        })
      this.audit('catalog.starter', { count: items.length })
    })()
  }
  async backup(destination: string) {
    if (sameFile(destination, this.path)) throw new Error('Choose a different backup location.')
    await this.db.backup(destination)
  }
  async restore(source: string) {
    if (sameFile(source, this.path))
      throw new Error('Choose a backup file, not the active database.')
    const imported = new Database(source, { readonly: true, fileMustExist: true })
    const temporary = join(dirname(this.path), `restore-${randomUUID()}.db`)
    try {
      if (
        imported.pragma('user_version', { simple: true }) !== 1 ||
        imported.pragma('integrity_check', { simple: true }) !== 'ok'
      )
        throw new Error('This is not a valid DormStore v1 backup.')
      if ((imported.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('The backup contains broken references.')
      if (this.scope) {
        const hasIdentity = imported
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_identity'")
          .get()
        const identity = hasIdentity
          ? (imported.prepare('SELECT shop_id FROM shop_identity WHERE id=1').get() as
              { shop_id: string } | undefined)
          : undefined
        if (identity ? identity.shop_id !== this.scope.shopId : !this.scope.allowLegacyBackup)
          throw new Error(
            'Choose a backup from the current shop. Backups from other shops cannot be restored here.',
          )
      }
      for (const table of [
        'products',
        'customers',
        'sales',
        'sale_items',
        'stock_movements',
        'customer_ledger',
        'expenses',
        'settings',
        'audit_log',
      ])
        imported.prepare(`SELECT * FROM ${table} LIMIT 1`).get()
      await imported.backup(temporary)
    } finally {
      imported.close()
    }
    // Fully exercise restored queries before touching the live database.
    let check: Store | undefined
    try {
      check = new Store(temporary, this.scope)
      check.snapshot()
    } catch (e) {
      check?.close()
      if (existsSync(temporary)) unlinkSync(temporary)
      throw e
    } finally {
      check?.close()
    }
    const safety = join(dirname(this.path), `before-restore-${Date.now()}.db`)
    await this.backup(safety)
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.close()
    const previous = `${this.path}.previous`
    if (existsSync(previous)) unlinkSync(previous)
    try {
      renameSync(this.path, previous)
      renameSync(temporary, this.path)
      this.open()
      this.audit('database.restore', { safety })
      unlinkSync(previous)
    } catch (error) {
      if (this.db.open) this.db.close()
      if (existsSync(previous)) {
        if (existsSync(this.path)) unlinkSync(this.path)
        renameSync(previous, this.path)
      }
      this.open()
      throw error
    }
  }
  close() {
    if (this.db.open) this.db.close()
  }
}
