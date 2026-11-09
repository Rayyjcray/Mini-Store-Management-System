import { createContext, useContext } from 'react'
import type { Receipt, Result, Snapshot } from '../shared/contracts'
export type Page =
  | 'Dashboard'
  | 'Point of sale'
  | 'Products'
  | 'Inventory'
  | 'Customers'
  | 'Sales history'
  | 'Expenses'
  | 'Reports'
  | 'Settings'
  | 'Accounts'
  | 'Shops'
export interface AppContextValue {
  data: Snapshot
  busy: boolean
  navigate: (page: Page) => void
  act: <T>(
    op: () => Promise<Result<T>>,
    message?: string,
    refresh?: boolean,
  ) => Promise<{ value: T } | null>
  showReceipt: (receipt: Receipt) => void
  changeShop: (id: string) => void
}
export const AppContext = createContext<AppContextValue>(null!)
export const useStore = () => useContext(AppContext)
