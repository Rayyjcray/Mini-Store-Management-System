import type Database from 'better-sqlite3'
import type {
  Customer,
  Expense,
  LedgerEntry,
  Movement,
  Product,
  Sale,
  SaleItem,
  Settings,
} from '../shared/contracts'

export type ReportValue = string | number
export interface ReportColumn {
  label: string
  width: number
  money?: boolean
  total?: boolean
}
export interface ReportSection {
  name: string
  description: string
  empty: string
  columns: ReportColumn[]
  rows: ReportValue[][]
}
export interface OwnerReport {
  storeName: string
  exportedAt: string
  details: [string, string][]
  summary: { label: string; value: number; money?: boolean; explanation: string }[]
  sections: ReportSection[]
}
const column = (label: string, width = 24): ReportColumn => ({ label, width })
const moneyColumn = (label: string, total = false): ReportColumn => ({
  label: `${label} (PHP)`,
  width: 20,
  money: true,
  total,
})
const pesos = (centavos: number) => centavos / 100
const timestamp = (value: string) => value.replace('T', ' ').replace(/\.\d+$/, '')
const sum = <T>(items: T[], value: (item: T) => number) =>
  items.reduce((total, item) => total + value(item), 0)
const paymentName = (method: string) =>
  ({ cash: 'Cash', gcash: 'GCash', credit: 'Credit / utang' })[method] || method

/** Readable owner views use all records, independently of the UI's history limits. */
export function buildOwnerReport(db: Database.Database): OwnerReport {
  const products = db
    .prepare('SELECT * FROM products ORDER BY active DESC,name COLLATE NOCASE')
    .all() as Product[]
  const customers = db
    .prepare(
      `SELECT c.*, COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id=c.id),0) balance
    FROM customers c ORDER BY balance DESC,name COLLATE NOCASE`,
    )
    .all() as Customer[]
  const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC,id DESC').all() as Sale[]
  const items = db
    .prepare('SELECT * FROM sale_items ORDER BY sale_id DESC,id')
    .all() as (SaleItem & { sale_id: number })[]
  const ledger = db.prepare('SELECT * FROM customer_ledger ORDER BY id').all() as LedgerEntry[]
  const movements = db
    .prepare('SELECT * FROM stock_movements ORDER BY created_at DESC,id DESC')
    .all() as (Movement & { product_id: number })[]
  const expenses = db
    .prepare('SELECT * FROM expenses ORDER BY date DESC,id DESC')
    .all() as Expense[]
  const settings = Object.fromEntries(
    (db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[]).map(
      ({ key, value }) => [key, value],
    ),
  ) as unknown as Settings
  const names = new Map(customers.map((customer) => [customer.id, customer.name]))
  const productNames = new Map(products.map((product) => [product.id, product.name]))
  const receipts = new Map(sales.map((sale) => [sale.id, sale]))
  const customerName = (id: number | null) =>
    id === null ? 'Walk-in customer' : names.get(id) || 'Unknown customer'
  const completed = sales.filter((sale) => sale.status === 'completed')
  const activeProducts = products.filter((product) => product.active)
  const revenue = sum(completed, (sale) => sale.total)
  const costs = sum(completed, (sale) => sale.cost)
  const operatingExpenses = sum(expenses, (expense) => expense.amount)
  const balances = new Map<number, number>()
  const creditRows = ledger.map((entry): ReportValue[] => {
    const balance = (balances.get(entry.customer_id) || 0) + entry.amount
    balances.set(entry.customer_id, balance)
    const type =
      {
        credit_sale: 'Purchase on credit',
        repayment: 'Repayment received',
        void: 'Cancelled credit sale',
      }[entry.type] || entry.type
    const method = entry.type === 'repayment' ? paymentName(entry.notes.split(':')[0]) : ''
    return [
      timestamp(entry.created_at),
      customerName(entry.customer_id),
      type,
      entry.sale_id ? receipts.get(entry.sale_id)?.receipt || '' : '',
      pesos(Math.max(entry.amount, 0)),
      pesos(Math.max(-entry.amount, 0)),
      pesos(balance),
      method,
      entry.notes,
    ]
  })
  return {
    storeName: settings.store_name,
    exportedAt: timestamp(new Date().toLocaleString('sv-SE')),
    details: [
      ['Owner', settings.owner_name || 'Not provided'],
      ['Store address', settings.address || 'Not provided'],
      ['Receipt message', settings.receipt_footer],
    ],
    summary: [
      {
        label: 'Total sales',
        value: pesos(revenue),
        money: true,
        explanation: 'All completed sales; cancelled sales excluded.',
      },
      {
        label: 'Cost of goods sold',
        value: pesos(costs),
        money: true,
        explanation: 'Product costs captured when completed sales were made.',
      },
      {
        label: 'Operating expenses',
        value: pesos(operatingExpenses),
        money: true,
        explanation: 'All recorded operating expenses.',
      },
      {
        label: 'Net profit',
        value: pesos(revenue - costs - operatingExpenses),
        money: true,
        explanation: 'Total sales minus cost of goods sold and operating expenses.',
      },
      {
        label: 'Money collected',
        value: pesos(
          sum(completed, (sale) => sale.paid) -
            sum(
              ledger.filter((entry) => entry.type === 'repayment'),
              (entry) => entry.amount,
            ),
        ),
        money: true,
        explanation: 'Payments on completed sales plus customer repayments.',
      },
      {
        label: 'Unpaid customer balances',
        value: pesos(sum(customers, (customer) => customer.balance)),
        money: true,
        explanation: 'Total utang still owed to the shop at export.',
      },
      {
        label: 'Customers with unpaid balances',
        value: customers.filter((customer) => customer.balance > 0).length,
        explanation: 'See Customers for names and individual balances.',
      },
      {
        label: 'Active products',
        value: activeProducts.length,
        explanation: 'Products currently available in the catalog.',
      },
      {
        label: 'Units currently in stock',
        value: sum(activeProducts, (product) => product.stock),
        explanation: 'Combined on-hand units across active products.',
      },
      {
        label: 'Stock value at cost',
        value: pesos(sum(activeProducts, (product) => product.stock * product.cost)),
        money: true,
        explanation: 'Current units in stock multiplied by current unit cost.',
      },
    ],
    sections: [
      {
        name: 'Inventory',
        description:
          'Current stock, selling prices and product costs. Archived products remain listed for reference.',
        empty: 'No products recorded yet.',
        columns: [
          column('Product', 36),
          column('Category', 24),
          column('In stock', 12),
          column('Unit', 12),
          moneyColumn('Selling price'),
          moneyColumn('Unit cost'),
          moneyColumn('Stock value', true),
          column('Stock status', 18),
          column('SKU', 22),
          column('Barcode', 24),
        ],
        rows: products.map((product) => [
          product.name,
          product.category,
          product.stock,
          product.unit,
          pesos(product.price),
          pesos(product.cost),
          pesos(product.stock * product.cost),
          !product.active
            ? 'Archived'
            : !product.stock
              ? 'Out of stock'
              : product.stock <= product.low_stock
                ? 'Low stock'
                : 'In stock',
          product.sku,
          product.barcode || '',
        ]),
      },
      {
        name: 'Customers',
        description:
          'Who still owes money, how much they owe, and the credit available to each customer. Highest balances appear first.',
        empty: 'No customers recorded yet.',
        columns: [
          column('Customer', 32),
          column('Room / address', 22),
          column('Phone', 22),
          moneyColumn('Unpaid balance', true),
          moneyColumn('Credit limit'),
          moneyColumn('Available credit'),
          column('Account status', 20),
          column('Notes', 40),
        ],
        rows: customers.map((customer) => [
          customer.name,
          customer.room,
          customer.phone,
          pesos(customer.balance),
          pesos(customer.credit_limit),
          pesos(customer.credit_limit - customer.balance),
          customer.balance ? 'Owes money' : 'Settled',
          customer.notes,
        ]),
      },
      {
        name: 'Sales',
        description:
          'Each sale and the payment received at checkout. Cancelled sales are marked Voided and excluded from overview totals.',
        empty: 'No sales recorded yet.',
        columns: [
          column('Date and time', 23),
          column('Receipt', 30),
          column('Customer', 32),
          column('Payment method', 20),
          moneyColumn('Sale total'),
          moneyColumn('Paid at checkout'),
          moneyColumn('Credit charged'),
          column('Sale status', 18),
          column('Notes', 36),
        ],
        rows: sales.map((sale) => [
          timestamp(sale.created_at),
          sale.receipt,
          customerName(sale.customer_id),
          paymentName(sale.payment_method),
          pesos(sale.total),
          pesos(sale.paid),
          pesos(sale.total - sale.paid),
          sale.status === 'voided' ? 'Voided' : 'Completed',
          sale.notes,
        ]),
      },
      {
        name: 'Sale items',
        description:
          'Products bought on each receipt, using the product names and prices saved when the sale was made.',
        empty: 'No items sold yet.',
        columns: [
          column('Date and time', 23),
          column('Receipt', 30),
          column('Customer', 32),
          column('Product purchased', 36),
          column('Quantity', 12),
          moneyColumn('Unit price'),
          moneyColumn('Line total'),
          column('Sale status', 18),
        ],
        rows: items.map((item) => {
          const sale = receipts.get(item.sale_id)!
          return [
            timestamp(sale.created_at),
            sale.receipt,
            customerName(sale.customer_id),
            item.name,
            item.quantity,
            pesos(item.price),
            pesos(item.quantity * item.price),
            sale.status === 'voided' ? 'Voided' : 'Completed',
          ]
        }),
      },
      {
        name: 'Credit & repayments',
        description:
          'Customer utang history. Added debt increases the balance; repayments and cancellations reduce it. Read from top to bottom.',
        empty: 'No credit purchases or repayments recorded yet.',
        columns: [
          column('Date and time', 23),
          column('Customer', 32),
          column('Transaction', 26),
          column('Receipt', 30),
          moneyColumn('Added debt'),
          moneyColumn('Payment / reversal'),
          moneyColumn('Balance after entry'),
          column('Payment method', 20),
          column('Notes', 40),
        ],
        rows: creditRows,
      },
      {
        name: 'Stock history',
        description:
          'Stock added or removed, with the product name, reason and reference for each change.',
        empty: 'No stock changes recorded yet.',
        columns: [
          column('Date and time', 23),
          column('Product', 36),
          column('Units added / removed', 22),
          column('Reason', 22),
          column('Reference / notes', 40),
        ],
        rows: movements.map((movement) => [
          timestamp(movement.created_at),
          productNames.get(movement.product_id) || 'Unknown product',
          movement.quantity,
          movement.reason,
          movement.reference,
        ]),
      },
      {
        name: 'Expenses',
        description:
          'Recorded operating expenses. Stock purchases should not also be recorded here if their cost is already included in goods sold.',
        empty: 'No expenses recorded yet.',
        columns: [
          column('Date', 16),
          column('Description', 40),
          column('Category', 24),
          moneyColumn('Amount', true),
          column('Notes', 40),
        ],
        rows: expenses.map((expense) => [
          expense.date,
          expense.description,
          expense.category,
          pesos(expense.amount),
          expense.notes,
        ]),
      },
    ],
  }
}

export function ownerReportRows(report: OwnerReport): string[][] {
  const rows: string[][] = [
    ['DormStore shop backup', '2'],
    ['Store', report.storeName],
    ['Saved on', report.exportedAt],
    ...report.details,
    ['About this file', 'All-time shop snapshot. Amounts are Philippine pesos (PHP).'],
    [
      'Restore',
      'Keep this original file. Restore returns records as saved; editing the report does not update the saved backup.',
    ],
    [],
    ['SHOP OVERVIEW'],
    ['What it means', 'Amount / count', 'Explanation'],
    ...report.summary.map((item) => [
      item.label,
      item.money ? item.value.toFixed(2) : String(item.value),
      item.explanation,
    ]),
  ]
  for (const section of report.sections) {
    rows.push(
      [],
      [section.name.toUpperCase()],
      [section.description],
      section.columns.map((col) => col.label),
    )
    if (!section.rows.length) rows.push([section.empty])
    for (const row of section.rows)
      rows.push(
        row.map((value, i) =>
          typeof value === 'number' && section.columns[i].money ? value.toFixed(2) : String(value),
        ),
      )
  }
  return rows
}
