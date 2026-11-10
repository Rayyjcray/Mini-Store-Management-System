export const categories = [
  'Canned goods',
  'Noodles & canton',
  'Snacks & biscuits',
  'Water & beverages',
  'Coffee & drinks',
  'Toiletries',
  'Laundry supplies',
  'Dorm essentials',
] as const
export type Category = (typeof categories)[number]
export type BackupFormat = 'db' | 'csv' | 'xlsx'
export interface Product {
  id: number
  name: string
  sku: string
  barcode: string | null
  category: Category
  price: number
  cost: number
  stock: number
  low_stock: number
  unit: string
  active: number
}
export interface Customer {
  id: number
  name: string
  room: string
  phone: string
  notes: string
  credit_limit: number
  balance: number
}
export interface Sale {
  id: number
  receipt: string
  customer_id: number | null
  customer_name: string | null
  total: number
  cost: number
  paid: number
  tendered: number
  change_amount: number
  payment_method: string
  status: 'completed' | 'voided'
  created_at: string
  notes: string
}
export interface SaleItem {
  id: number
  product_id: number
  name: string
  quantity: number
  price: number
  cost: number
}
export interface Expense {
  id: number
  description: string
  category: string
  amount: number
  date: string
  notes: string
}
export interface Movement {
  id: number
  product_name: string
  quantity: number
  reason: string
  reference: string
  created_at: string
}
export interface LedgerEntry {
  id: number
  customer_id: number
  sale_id: number | null
  amount: number
  type: string
  notes: string
  created_at: string
}
export interface Settings {
  store_name: string
  owner_name: string
  address: string
  receipt_footer: string
}
export interface Report {
  revenue: number
  cogs: number
  expenses: number
  count: number
  collections: number
  daily: { date: string; revenue: number; profit: number }[]
  topProducts: { name: string; quantity: number; revenue: number }[]
  categories: { name: string; revenue: number }[]
}
export interface Snapshot {
  products: Product[]
  customers: Customer[]
  sales: Sale[]
  expenses: Expense[]
  movements: Movement[]
  settings: Settings
  today: Report
  weekly: Report
  totalDebt: number
  databasePath: string
}
export interface Checkout {
  items: { product_id: number; quantity: number }[]
  customer_id?: number
  payment_method: 'cash' | 'gcash' | 'credit'
  paid: number
  tendered: number
  notes: string
}
export interface Receipt {
  sale: Sale
  items: SaleItem[]
  settings: Settings
}
export interface CustomerAccount {
  customer: Customer
  ledger: LedgerEntry[]
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export interface AuthState {
  configured: boolean
  authenticated: boolean
  username: string | null
  lockedUntil: number
  idleMinutes: number
  userId: number | null
  role: AccountRole | null
  displayName: string | null
  mustChangePassword: boolean
  shopId: string | null
  shopName: string | null
}
export interface Shop {
  id: string
  name: string
  owner_id: number
  legacy: number
}
export type AccountRole = 'owner' | 'staff'
export interface UserAccount {
  id: number
  username: string
  display_name: string
  role: AccountRole
  active: number
  must_change_password: number
  failures: number
  locked_until: number
  shop_id: string | null
}
export interface SecurityEvent {
  id: number
  actor: string | null
  action: string
  target: string | null
  details: string
  created_at: number
}
export interface AuthAccess {
  state: AuthState
  recoveryCode?: string
}
export interface StoreAPI {
  authStatus(): Promise<Result<AuthState>>
  setupOwner(input: unknown): Promise<Result<AuthAccess>>
  registerOwner(input: unknown): Promise<Result<AuthAccess>>
  listShops(): Promise<Result<Shop[]>>
  createShop(input: unknown): Promise<Result<Shop>>
  switchShop(id: string): Promise<Result<AuthState>>
  signIn(input: unknown): Promise<Result<AuthAccess>>
  signOut(): Promise<Result<AuthState>>
  resetPassword(input: unknown): Promise<Result<AuthAccess>>
  changePassword(input: unknown): Promise<Result<AuthAccess>>
  listAccounts(): Promise<Result<UserAccount[]>>
  createAccount(input: unknown): Promise<Result<number>>
  updateAccount(input: unknown): Promise<Result<void>>
  resetAccountPassword(input: unknown): Promise<Result<void>>
  securityEvents(): Promise<Result<SecurityEvent[]>>
  authActivity(): Promise<Result<AuthState>>
  onAuthChanged(callback: (state: AuthState) => void): () => void
  snapshot(): Promise<Result<Snapshot>>
  saveProduct(input: unknown): Promise<Result<number>>
  archiveProduct(id: number): Promise<Result<void>>
  adjustStock(input: unknown): Promise<Result<void>>
  saveCustomer(input: unknown): Promise<Result<number>>
  customerAccount(id: number): Promise<Result<CustomerAccount>>
  repay(input: unknown): Promise<Result<void>>
  checkout(input: Checkout): Promise<Result<Receipt>>
  receipt(id: number): Promise<Result<Receipt>>
  voidSale(input: unknown): Promise<Result<void>>
  saveExpense(input: unknown): Promise<Result<number>>
  deleteExpense(id: number): Promise<Result<void>>
  report(input: { from: string; to: string }): Promise<Result<Report>>
  saveSettings(input: Settings): Promise<Result<void>>
  seedCatalog(): Promise<Result<void>>
  backup(format?: BackupFormat): Promise<Result<string | null>>
  restore(): Promise<Result<boolean>>
  exportReport(input: { from: string; to: string }): Promise<Result<string | null>>
  printReceipt(id: number): Promise<Result<void>>
}
