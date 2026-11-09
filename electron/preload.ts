import { contextBridge, ipcRenderer } from 'electron'
import type { StoreAPI } from '../shared/contracts'
const api: StoreAPI = {
  authStatus: () => ipcRenderer.invoke('auth:status'),
  setupOwner: (input) => ipcRenderer.invoke('auth:setup', input),
  registerOwner: (input) => ipcRenderer.invoke('auth:register-owner', input),
  listShops: () => ipcRenderer.invoke('shops:list'),
  createShop: (input) => ipcRenderer.invoke('shops:create', input),
  switchShop: (id) => ipcRenderer.invoke('shops:switch', id),
  signIn: (input) => ipcRenderer.invoke('auth:sign-in', input),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  resetPassword: (input) => ipcRenderer.invoke('auth:reset-password', input),
  changePassword: (input) => ipcRenderer.invoke('auth:change-password', input),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  createAccount: (input) => ipcRenderer.invoke('accounts:create', input),
  updateAccount: (input) => ipcRenderer.invoke('accounts:update', input),
  resetAccountPassword: (input) => ipcRenderer.invoke('accounts:reset-password', input),
  securityEvents: () => ipcRenderer.invoke('security:events'),
  authActivity: () => ipcRenderer.invoke('auth:activity'),
  onAuthChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: import('../shared/contracts').AuthState,
    ) => callback(state)
    ipcRenderer.on('auth:changed', listener)
    return () => {
      ipcRenderer.removeListener('auth:changed', listener)
    }
  },
  snapshot: () => ipcRenderer.invoke('store:snapshot'),
  saveProduct: (input) => ipcRenderer.invoke('product:save', input),
  archiveProduct: (id) => ipcRenderer.invoke('product:archive', id),
  adjustStock: (input) => ipcRenderer.invoke('stock:adjust', input),
  saveCustomer: (input) => ipcRenderer.invoke('customer:save', input),
  customerAccount: (id) => ipcRenderer.invoke('customer:account', id),
  repay: (input) => ipcRenderer.invoke('customer:repay', input),
  checkout: (input) => ipcRenderer.invoke('sale:checkout', input),
  receipt: (id) => ipcRenderer.invoke('sale:receipt', id),
  voidSale: (input) => ipcRenderer.invoke('sale:void', input),
  saveExpense: (input) => ipcRenderer.invoke('expense:save', input),
  deleteExpense: (id) => ipcRenderer.invoke('expense:delete', id),
  report: (input) => ipcRenderer.invoke('report:get', input),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  seedCatalog: () => ipcRenderer.invoke('catalog:seed'),
  backup: () => ipcRenderer.invoke('database:backup'),
  restore: () => ipcRenderer.invoke('database:restore'),
  exportReport: (input) => ipcRenderer.invoke('report:export', input),
  printReceipt: (id) => ipcRenderer.invoke('receipt:print', id),
}
contextBridge.exposeInMainWorld('dormstore', api)
