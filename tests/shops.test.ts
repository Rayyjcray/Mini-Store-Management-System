import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, linkSync, existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { OwnerAuth } from '../electron/auth'
import { Store } from '../electron/store'
import { ShopStores } from '../electron/shops'
import type { Shop } from '../shared/contracts'
const password = 'private shop owner password',
  temp = 'private temporary staff password'
const owner = (username: string, shopName: string) => ({
  username,
  shopName,
  password,
  confirmPassword: password,
})
const staff = (username: string) => ({
  username,
  displayName: username,
  role: 'staff',
  password: temp,
  confirmPassword: temp,
  currentPassword: password,
})
const product = (name: string) => ({
  name,
  sku: 'SHARED-SKU',
  barcode: '123456789',
  category: 'Coffee & drinks',
  price: 1200,
  cost: 800,
  stock: 10,
  low_stock: 2,
  unit: 'pc',
})
const cleanup = (folder: string) => {
  const path = resolve(folder)
  assert.equal(dirname(path), resolve(tmpdir()))
  assert.ok(basename(path).startsWith('dormstore-shops-test-'))
  rmSync(path, { recursive: true, force: true })
}
const shop = (name: string, legacy = 0): Shop => ({ id: randomUUID(), name, owner_id: 1, legacy })

test('different owners cannot list, switch into or manage each other’s shops and accounts', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    const first = await auth.setup(owner('owner1', 'First shop')),
      firstShop = auth.currentShop(),
      staffId = await auth.createAccount(staff('staff1'))
    auth.record('first.private.event', 'first-secret')
    auth.lock()
    const second = await auth.registerOwner({
      ...owner('owner2', 'Second shop'),
      shop_id: firstShop.id,
      owner_id: first.state.userId,
    })
    assert.notEqual(first.state.shopId, second.state.shopId)
    assert.equal(auth.listShops().length, 1)
    assert.throws(() => auth.switchShop(firstShop.id), /access to this shop/)
    assert.deepEqual(
      auth.listAccounts().map((a) => a.username),
      ['owner2'],
    )
    await assert.rejects(
      () =>
        auth.updateAccount({
          id: staffId,
          displayName: 'stolen',
          role: 'staff',
          active: false,
          currentPassword: password,
        }),
      /not found in this shop/,
    )
    await assert.rejects(
      () =>
        auth.resetAccountPassword({
          id: staffId,
          password: temp,
          confirmPassword: temp,
          currentPassword: password,
        }),
      /not found in this shop/,
    )
    assert.ok(!JSON.stringify(auth.securityEvents()).includes('first-secret'))
    const secondStaff = await auth.createAccount(staff('staff2'))
    assert.ok(secondStaff !== staffId)
    auth.lock()
    await auth.signIn({ username: 'owner1', password })
    assert.deepEqual(
      auth.listAccounts().map((a) => a.username),
      ['owner1', 'staff1'],
    )
    assert.ok(JSON.stringify(auth.securityEvents()).includes('first-secret'))
    await assert.rejects(
      () => auth.createAccount({ ...staff('illegal-owner'), role: 'owner' }),
      /register a separate shop/,
    )
  } finally {
    auth.close()
  }
})
test('one owner can switch their own shops while staff stay assigned to a single shop', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(owner('owner1', 'Shop A'))
    const a = auth.currentShop()
    await auth.createAccount(staff('cashier'))
    const b = await auth.createShop({ name: 'Shop B', currentPassword: password }),
      generation = auth.requireSession()
    auth.switchShop(b.id)
    assert.equal(auth.status().shopName, 'Shop B')
    assert.throws(() => auth.requireSession(generation), /locked/)
    assert.deepEqual(
      auth.listAccounts().map((a) => a.username),
      ['owner1'],
    )
    auth.lock()
    await auth.signIn({ username: 'cashier', password: temp })
    await auth.changePassword({
      currentPassword: temp,
      password: 'my private cashier password',
      confirmPassword: 'my private cashier password',
    })
    assert.equal(auth.currentShop().id, a.id)
    assert.equal(auth.listShops().length, 1)
    assert.throws(() => auth.authorize('shops:switch'), /permission/)
    assert.throws(() => auth.switchShop(b.id), /owner/)
  } finally {
    auth.close()
  }
})
test('per-shop SQLite files isolate identical SKUs, customers, sales, debts, expenses and settings', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-shops-test-')),
    stores = new ShopStores(folder),
    a = shop('Alpha', 1),
    b = shop('Beta')
  try {
    const first = await stores.forShop(a),
      second = await stores.forShop(b)
    const p = first.saveProduct(product('Alpha coffee'))
    second.saveProduct(product('Beta coffee'))
    const c = first.saveCustomer({
      name: 'Alpha customer',
      room: 'A1',
      phone: '',
      notes: '',
      credit_limit: 10000,
    })
    first.checkout({
      items: [{ product_id: p, quantity: 2 }],
      customer_id: c,
      payment_method: 'credit',
      paid: 400,
      tendered: 400,
      notes: '',
    })
    first.saveExpense({
      description: 'Alpha rent',
      category: 'Rent',
      amount: 100,
      date: new Date().toISOString().slice(0, 10),
      notes: '',
    })
    assert.equal(first.snapshot().totalDebt, 2000)
    assert.equal(first.snapshot().sales.length, 1)
    assert.equal(second.snapshot().totalDebt, 0)
    assert.equal(second.snapshot().customers.length, 0)
    assert.equal(second.snapshot().sales.length, 0)
    assert.equal(second.snapshot().expenses.length, 0)
    assert.equal(second.products()[0].name, 'Beta coffee')
    assert.equal(second.products()[0].stock, 10)
    assert.equal(first.settings().store_name, 'Alpha')
    assert.equal(second.settings().store_name, 'Beta')
    assert.notEqual(first.path, second.path)
    assert.equal(
      readdirSync(join(dirname(first.path), 'backups')).filter((f) => f.startsWith('auto-')).length,
      1,
    )
    assert.equal(
      readdirSync(join(dirname(second.path), 'backups')).filter((f) => f.startsWith('auto-'))
        .length,
      1,
    )
  } finally {
    stores.close()
    cleanup(folder)
  }
})
test('restores reject another shop’s backup and leave both shops intact', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-shops-test-')),
    stores = new ShopStores(folder)
  try {
    const first = await stores.forShop(shop('Alpha', 1)),
      second = await stores.forShop(shop('Beta'))
    first.saveProduct(product('Alpha coffee'))
    second.saveProduct(product('Beta coffee'))
    const backup = join(folder, 'alpha-backup.db')
    await first.backup(backup)
    await assert.rejects(() => second.restore(backup), /current shop|other shops/)
    assert.equal(first.products()[0].name, 'Alpha coffee')
    assert.equal(second.products()[0].name, 'Beta coffee')
    first.adjustStock({
      product_id: first.products()[0].id,
      quantity: 3,
      reason: 'Restock',
      notes: '',
    })
    await first.restore(backup)
    assert.equal(first.products()[0].stock, 10)
  } finally {
    stores.close()
    cleanup(folder)
  }
})
test('legacy records and unlabelled backups remain available only to the migrated original shop', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-shops-test-')),
    path = join(folder, 'dormstore.db'),
    legacy = new Store(path)
  const id = legacy.saveProduct(product('Existing inventory'))
  const backup = join(folder, 'old-backup.db')
  await legacy.backup(backup)
  legacy.close()
  const stores = new ShopStores(folder)
  try {
    const first = await stores.forShop(shop('Existing shop', 1)),
      second = await stores.forShop(shop('New private shop'))
    assert.equal(first.path, path)
    assert.equal(first.products()[0].id, id)
    assert.equal(second.products().length, 0)
    await first.restore(backup)
    assert.equal(first.products()[0].name, 'Existing inventory')
    await assert.rejects(() => second.restore(backup), /current shop|other shops/)
  } finally {
    stores.close()
    cleanup(folder)
  }
})
test('manual backup/export destinations cannot overwrite managed databases or hard-link aliases', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-shops-test-')),
    root = join(folder, 'data'),
    stores = new ShopStores(root)
  try {
    const first = await stores.forShop(shop('One', 1)),
      second = await stores.forShop(shop('Two'))
    for (const target of [
      first.path,
      second.path,
      join(root, 'owner-auth.db'),
      join(root, 'new.csv'),
    ])
      assert.throws(
        () => stores.assertExternalDestination(target),
        /outside the application data folder/,
      )
    const alias = join(folder, 'outside-alias.db')
    linkSync(second.path, alias)
    assert.throws(() => stores.assertExternalDestination(alias), /application database/)
    stores.assertExternalDestination(join(folder, 'safe-backup.db'))
  } finally {
    stores.close()
    cleanup(folder)
  }
})
test('legacy shared owners migrate into private shops while staff and audit history remain with the earliest active owner', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-shops-test-')),
    path = join(folder, 'auth.db')
  let auth = new OwnerAuth(path)
  try {
    await auth.setup(owner('owner1', 'Legacy'))
    await auth.createAccount(staff('cashier'))
    auth.record('legacy.business', 'legacy-secret')
    auth.close()
    const db = new Database(path)
    db.pragma('foreign_keys=OFF')
    // Recreate the actual v1.2 account schema, retaining its hashes and existing shared history.
    db.exec(`CREATE TABLE old_accounts(id INTEGER PRIMARY KEY,username TEXT NOT NULL COLLATE NOCASE UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,must_change_password INTEGER NOT NULL,salt BLOB NOT NULL,password_hash BLOB NOT NULL,recovery_hash BLOB,session_version INTEGER NOT NULL);
    INSERT INTO old_accounts SELECT id,username,display_name,role,active,must_change_password,salt,password_hash,recovery_hash,session_version FROM accounts;
    DROP TABLE accounts;ALTER TABLE old_accounts RENAME TO accounts;
    CREATE TABLE old_events(id INTEGER PRIMARY KEY,actor TEXT,action TEXT NOT NULL,target TEXT,details TEXT NOT NULL,created_at INTEGER NOT NULL);
    INSERT INTO old_events SELECT id,actor,action,target,details,created_at FROM security_events;
    DROP TABLE security_events;ALTER TABLE old_events RENAME TO security_events;
    DROP TABLE shops;PRAGMA user_version=2;`)
    db.prepare(
      "INSERT INTO accounts SELECT 3,'owner2','Owner two','owner',1,0,salt,password_hash,recovery_hash,session_version FROM accounts WHERE id=1",
    ).run()
    db.close()
    auth = new OwnerAuth(path)
    await auth.signIn({ username: 'owner1', password })
    const original = auth.currentShop()
    assert.equal(original.legacy, 1)
    assert.ok(auth.listAccounts().some((a) => a.username === 'cashier'))
    assert.ok(JSON.stringify(auth.securityEvents()).includes('legacy-secret'))
    auth.lock()
    await auth.signIn({ username: 'owner2', password })
    assert.equal(auth.currentShop().legacy, 0)
    assert.notEqual(auth.currentShop().id, original.id)
    assert.deepEqual(
      auth.listAccounts().map((a) => a.username),
      ['owner2'],
    )
    assert.ok(!JSON.stringify(auth.securityEvents()).includes('legacy-secret'))
    assert.throws(() => auth.switchShop(original.id), /access to this shop/)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
