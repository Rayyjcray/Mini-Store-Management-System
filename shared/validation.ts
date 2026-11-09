import { z } from 'zod'
import { categories } from './contracts'
const id = z.number().int().positive()
const text = (max: number) => z.string().trim().max(max)
const money = z.number().int().min(0).max(100_000_000)
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  )
export const productSchema = z.object({
  id: id.optional(),
  name: text(120).min(1),
  sku: text(60).min(1),
  barcode: text(80).nullable().default(null),
  category: z.enum(categories),
  price: money,
  cost: money,
  stock: z.number().int().min(0).max(1_000_000),
  low_stock: z.number().int().min(0).max(1_000_000),
  unit: text(30).min(1),
})
export const customerSchema = z.object({
  id: id.optional(),
  name: text(120).min(1),
  room: text(50),
  phone: text(50),
  notes: text(1000),
  credit_limit: money,
})
export const stockSchema = z.object({
  product_id: id,
  quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'Quantity must not be zero'),
  reason: z.enum(['Restock', 'Damaged', 'Expired', 'Correction', 'Personal use']),
  notes: text(500),
})
export const checkoutSchema = z.object({
  items: z
    .array(z.object({ product_id: id, quantity: z.number().int().positive().max(1_000_000) }))
    .min(1)
    .max(500),
  customer_id: id.optional(),
  payment_method: z.enum(['cash', 'gcash', 'credit']),
  paid: money,
  tendered: money,
  notes: text(1000),
})
export const repaymentSchema = z.object({
  customer_id: id,
  amount: money.refine((v) => v > 0, 'Enter an amount above zero'),
  method: z.enum(['cash', 'gcash']),
  notes: text(500),
})
export const expenseSchema = z.object({
  id: id.optional(),
  description: text(200).min(1),
  category: z.enum(['Rent', 'Utilities', 'Transportation', 'Supplies', 'Maintenance', 'Other']),
  amount: money.refine((v) => v > 0),
  date: day,
  notes: text(1000),
})
export const rangeSchema = z
  .object({ from: day, to: day })
  .refine((v) => v.from <= v.to, 'Start date must be before end date')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Choose a range of up to 367 days',
  )
export const settingsSchema = z.object({
  store_name: text(120).min(1),
  owner_name: text(120),
  address: text(250),
  receipt_footer: text(250),
})
export const voidSchema = z.object({ id, reason: text(500).min(3) })
export const idSchema = id
