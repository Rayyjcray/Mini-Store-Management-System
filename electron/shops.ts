import { existsSync, mkdirSync, realpathSync, readdirSync, statSync, renameSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Shop } from '../shared/contracts'
import { Store, localDay } from './store'

/** Each business has a distinct SQLite connection and file. Callers supply only a server-authorized Shop. */
export class ShopStores {
  private pending = new Map<string, Promise<Store>>()
  private ready = new Map<string, Store>()
  private closed = false
  constructor(private root: string) {
    mkdirSync(root, { recursive: true })
  }
  pathFor(shop: Shop) {
    if (!/^[0-9a-f-]{36}$/i.test(shop.id)) throw new Error('Invalid shop identifier.')
    return shop.legacy
      ? join(this.root, 'dormstore.db')
      : join(this.root, 'shops', shop.id, 'dormstore.db')
  }
  forShop(shop: Shop): Promise<Store> {
    if (this.closed) return Promise.reject(new Error('The store is closing.'))
    const existing = this.pending.get(shop.id)
    if (existing) return existing
    const task = this.open(shop)
    this.pending.set(shop.id, task)
    task.catch(() => this.pending.delete(shop.id))
    return task
  }
  private async open(shop: Shop) {
    const path = this.pathFor(shop),
      fresh = !existsSync(path) && !existsSync(`${path}.previous`)
    const store = new Store(path, { shopId: shop.id, allowLegacyBackup: !!shop.legacy })
    try {
      if (fresh) store.saveSettings({ ...store.settings(), store_name: shop.name })
      const backups = join(dirname(path), 'backups')
      mkdirSync(backups, { recursive: true })
      const daily = join(backups, `auto-${localDay()}.db`)
      if (!existsSync(daily)) {
        const temporary = join(backups, `pending-${randomUUID()}.db`)
        await store.backup(temporary)
        renameSync(temporary, daily)
      }
      if (this.closed) throw new Error('The store is closing.')
      this.ready.set(shop.id, store)
      return store
    } catch (error) {
      store.close()
      throw error
    }
  }
  assertExternalDestination(destination: string) {
    const normalize = (value: string) =>
      process.platform === 'win32' ? value.toLowerCase() : value
    let parent = resolve(destination)
    const suffix: string[] = []
    while (!existsSync(parent)) {
      suffix.unshift(parent.slice(dirname(parent).length + 1))
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
    const target = normalize(resolve(realpathSync(parent), ...suffix)),
      root = normalize(realpathSync(this.root))
    if (target === root || target.startsWith(root + sep))
      throw new Error(
        'Save exports and manual backups outside the application data folder to protect all shops.',
      )
    if (!existsSync(destination)) return
    const selected = statSync(destination, { bigint: true })
    const paths = [join(this.root, 'owner-auth.db'), join(this.root, 'dormstore.db')]
    const folder = join(this.root, 'shops')
    if (existsSync(folder))
      for (const entry of readdirSync(folder, { withFileTypes: true }))
        if (entry.isDirectory()) paths.push(join(folder, entry.name, 'dormstore.db'))
    for (const database of paths)
      for (const candidate of [
        database,
        `${database}-wal`,
        `${database}-shm`,
        `${database}.previous`,
      ])
        if (existsSync(candidate)) {
          const protectedFile = statSync(candidate, { bigint: true })
          if (
            selected.ino !== 0n &&
            selected.dev === protectedFile.dev &&
            selected.ino === protectedFile.ino
          )
            throw new Error(
              'That destination is an application database. Choose an external backup or export file.',
            )
        }
  }
  close() {
    this.closed = true
    for (const store of this.ready.values()) store.close()
    this.ready.clear()
  }
}
