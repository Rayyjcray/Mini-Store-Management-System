import type { StoreAPI } from '../shared/contracts'
declare global {
  interface Window {
    dormstore: StoreAPI
  }
}
