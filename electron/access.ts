import type { AccountRole, Receipt, Report, Snapshot } from '../shared/contracts'
const emptyReport = (): Report => ({
  revenue: 0,
  cogs: 0,
  expenses: 0,
  count: 0,
  collections: 0,
  daily: [],
  topProducts: [],
  categories: [],
})
export function visibleSnapshot(data: Snapshot, role: AccountRole): Snapshot {
  if (role === 'owner') return data
  return {
    ...data,
    products: data.products.map((p) => ({ ...p, cost: 0 })),
    sales: data.sales.map((s) => ({ ...s, cost: 0 })),
    expenses: [],
    movements: [],
    today: emptyReport(),
    weekly: emptyReport(),
    databasePath: '',
    settings: { ...data.settings, owner_name: '' },
  }
}
export function visibleReceipt(data: Receipt, role: AccountRole): Receipt {
  if (role === 'owner') return data
  return {
    ...data,
    sale: { ...data.sale, cost: 0 },
    items: data.items.map((i) => ({ ...i, cost: 0 })),
    settings: { ...data.settings, owner_name: '' },
  }
}
