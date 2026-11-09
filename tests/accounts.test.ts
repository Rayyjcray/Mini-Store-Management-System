import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scryptSync, createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { OwnerAuth } from '../electron/auth'
import { visibleReceipt, visibleSnapshot } from '../electron/access'
import { Store } from '../electron/store'
const password = 'private owner passphrase',
  temp = 'private temporary password',
  own = 'private staff chosen passphrase'
const setup = { username: 'owner', password, confirmPassword: password }
const create = (username = 'staff', role: 'owner' | 'staff' = 'staff') => ({
  username,
  role,
  displayName: username,
  password: temp,
  confirmPassword: temp,
  currentPassword: password,
})
const change = { currentPassword: temp, password: own, confirmPassword: own }
const cleanup = (folder: string) => {
  const path = resolve(folder)
  assert.equal(dirname(path), resolve(tmpdir()))
  assert.ok(basename(path).startsWith('dormstore-accounts-test-'))
  rmSync(path, { recursive: true, force: true })
}

test('staff must replace temporary passwords and cannot escalate permissions', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    await auth.createAccount(create())
    auth.lock()
    const access = await auth.signIn({ username: 'staff', password: temp, role: 'owner' })
    assert.equal(access.state.role, 'staff')
    assert.equal(access.state.mustChangePassword, true)
    assert.throws(() => auth.authorize('store:snapshot'), /temporary password/)
    assert.throws(() => auth.listAccounts(), /owner/)
    auth.authorize('auth:change-password')
    await assert.rejects(
      () => auth.changePassword({ currentPassword: temp, password: temp, confirmPassword: temp }),
      /different/,
    )
    const changed = await auth.changePassword(change)
    assert.equal(changed.state.mustChangePassword, false)
    assert.ok(changed.recoveryCode)
    auth.authorize('sale:checkout')
    auth.authorize('customer:repay')
    for (const op of [
      'accounts:list',
      'accounts:create',
      'accounts:update',
      'accounts:reset-password',
      'security:events',
      'product:save',
      'product:archive',
      'customer:save',
      'stock:adjust',
      'sale:void',
      'expense:save',
      'expense:delete',
      'report:get',
      'settings:save',
      'database:backup',
      'database:restore',
      'report:export',
      'catalog:seed',
      'unknown:action',
    ])
      assert.throws(() => auth.authorize(op), /permission/)
    await assert.rejects(() => auth.createAccount(create('intruder')), /owner/)
  } finally {
    auth.close()
  }
})
test('account administration requires the owner password and protects the current owner', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    await assert.rejects(
      () => auth.createAccount({ ...create(), currentPassword: 'incorrect' }),
      /incorrect/,
    )
    assert.equal(auth.listAccounts().length, 1)
    await auth.createAccount(create())
    await assert.rejects(() => auth.createAccount(create('STAFF')), /already in use/)
    const owner = auth.listAccounts()[0]
    await assert.rejects(
      () =>
        auth.updateAccount({
          id: owner.id,
          displayName: 'owner',
          role: 'staff',
          active: true,
          currentPassword: password,
        }),
      /own role|own account/,
    )
    await assert.rejects(
      () =>
        auth.updateAccount({
          id: owner.id,
          displayName: 'owner',
          role: 'owner',
          active: false,
          currentPassword: password,
        }),
      /own account/,
    )
    assert.equal(auth.listAccounts().filter((a) => a.role === 'owner' && a.active).length, 1)
  } finally {
    auth.close()
  }
})
test('disabled accounts, unknown names and wrong passwords have the same public error', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    const id = await auth.createAccount(create())
    await auth.updateAccount({
      id,
      displayName: 'staff',
      role: 'staff',
      active: false,
      currentPassword: password,
    })
    auth.lock()
    const errors: string[] = []
    for (const credentials of [
      { username: 'staff', password: temp },
      { username: 'unknown', password: temp },
      { username: 'owner', password: 'incorrect password' },
    ])
      try {
        await auth.signIn(credentials)
      } catch (e) {
        errors.push((e as Error).message)
      }
    assert.equal(errors.length, 3)
    assert.equal(new Set(errors).size, 1)
    assert.equal(auth.status().authenticated, false)
  } finally {
    auth.close()
  }
})
test('a username cooldown does not lock the owner out and can be cleared by the owner', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    const id = await auth.createAccount(create())
    auth.lock()
    for (let i = 0; i < 5; i++)
      await assert.rejects(() => auth.signIn({ username: 'staff', password: 'incorrect password' }))
    await assert.rejects(() => auth.signIn({ username: 'staff', password: temp }), /incorrect/)
    await auth.signIn({ username: 'owner', password })
    assert.equal(auth.listAccounts().find((a) => a.id === id)!.failures, 5)
    await auth.updateAccount({
      id,
      displayName: 'staff',
      role: 'staff',
      active: true,
      unlock: true,
      currentPassword: password,
    })
    auth.lock()
    await auth.signIn({ username: 'staff', password: temp })
    assert.equal(auth.status().role, 'staff')
  } finally {
    auth.close()
  }
})
test('the device auth quota survives restart and covers rotating usernames and recovery', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-accounts-test-')),
    path = join(folder, 'auth.db')
  let now = 1_000_000,
    auth = new OwnerAuth(
      path,
      () => {},
      () => now,
    )
  try {
    await auth.setup(setup)
    auth.lock()
    for (let i = 0; i < 19; i++) await assert.rejects(() => auth.signIn({}))
    await assert.rejects(
      () => auth.signIn({ username: 'other', password }),
      /Too many authentication/,
    )
    await assert.rejects(
      () =>
        auth.resetPassword({
          username: 'owner',
          recoveryCode: 'anything',
          password,
          confirmPassword: password,
        }),
      /Too many authentication/,
    )
    auth.close()
    auth = new OwnerAuth(
      path,
      () => {},
      () => now,
    )
    await assert.rejects(
      () => auth.signIn({ username: 'owner', password }),
      /Too many authentication/,
    )
    now += 60_001
    await auth.signIn({ username: 'owner', password })
    assert.equal(auth.status().authenticated, true)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('deactivation and session version changes revoke an existing session', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-accounts-test-')),
    path = join(folder, 'auth.db'),
    auth = new OwnerAuth(path)
  try {
    await auth.setup(setup)
    const id = await auth.createAccount(create())
    auth.lock()
    await auth.signIn({ username: 'staff', password: temp })
    await auth.changePassword(change)
    const external = new Database(path)
    external
      .prepare('UPDATE accounts SET active=0,session_version=session_version+1 WHERE id=?')
      .run(id)
    external.close()
    assert.throws(() => auth.authorize('sale:checkout'), /locked/)
    assert.equal(auth.status().authenticated, false)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('an owner reset invalidates old passwords and recovery codes and forces another change', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    const id = await auth.createAccount(create())
    auth.lock()
    await auth.signIn({ username: 'staff', password: temp })
    const privateAccess = await auth.changePassword(change)
    auth.lock()
    await auth.signIn({ username: 'owner', password })
    await auth.resetAccountPassword({
      id,
      password: temp,
      confirmPassword: temp,
      currentPassword: password,
    })
    auth.lock()
    await assert.rejects(() => auth.signIn({ username: 'staff', password: own }), /incorrect/)
    await assert.rejects(
      () =>
        auth.resetPassword({
          username: 'staff',
          recoveryCode: privateAccess.recoveryCode,
          password: own,
          confirmPassword: own,
        }),
      /incorrect/,
    )
    await auth.signIn({ username: 'staff', password: temp })
    assert.equal(auth.status().mustChangePassword, true)
    assert.throws(() => auth.authorize('store:snapshot'), /temporary password/)
  } finally {
    auth.close()
  }
})
test('legacy owner password and recovery code migrate without allowing fresh owner signup', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-accounts-test-')),
    path = join(folder, 'auth.db'),
    db = new Database(path)
  const salt = randomBytes(32),
    hash = scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }),
    code = randomBytes(32).toString('hex').toUpperCase()
  db.exec(
    'CREATE TABLE owner_account(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL UNIQUE,salt BLOB NOT NULL,password_hash BLOB NOT NULL,recovery_hash BLOB NOT NULL,failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0)',
  )
  db.prepare('INSERT INTO owner_account VALUES (1,?,?,?,?,3,0)').run(
    'owner',
    salt,
    hash,
    createHash('sha256').update(code).digest(),
  )
  db.close()
  const auth = new OwnerAuth(path)
  try {
    assert.equal(auth.status().configured, true)
    await assert.rejects(() => auth.setup(setup), /already exists/)
    await auth.signIn({ username: 'owner', password })
    assert.equal(auth.status().role, 'owner')
    auth.lock()
    await auth.resetPassword({
      username: 'owner',
      recoveryCode: code,
      password,
      confirmPassword: password,
    })
    const inspect = new Database(path, { readonly: true }),
      legacy = inspect.prepare('SELECT * FROM owner_account').get() as {
        username: string
        password_hash: Buffer
      }
    inspect.close()
    assert.match(legacy.username, /upgrade-required-/)
    assert.notDeepEqual(legacy.password_hash, hash)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('staff snapshots and receipts withhold costs, profits, expenses and file paths', () => {
  const store = new Store(':memory:')
  try {
    const id = store.saveProduct({
      name: 'Coffee',
      sku: 'COFFEE',
      category: 'Coffee & drinks',
      price: 1200,
      cost: 800,
      stock: 10,
      low_stock: 2,
      unit: 'pc',
    })
    const receipt = store.checkout({
      items: [{ product_id: id, quantity: 1 }],
      payment_method: 'cash',
      paid: 1200,
      tendered: 1200,
      notes: '',
    })
    const snapshot = store.snapshot(),
      staff = visibleSnapshot(snapshot, 'staff'),
      visible = visibleReceipt(receipt, 'staff')
    assert.equal(staff.products[0].cost, 0)
    assert.equal(staff.sales[0].cost, 0)
    assert.deepEqual(staff.expenses, [])
    assert.equal(staff.today.cogs, 0)
    assert.equal(staff.weekly.revenue, 0)
    assert.equal(staff.databasePath, '')
    assert.equal(visible.sale.cost, 0)
    assert.equal(visible.items[0].cost, 0)
    assert.equal(snapshot.products[0].cost, 800)
    assert.equal(visibleSnapshot(snapshot, 'owner').today.cogs, 800)
  } finally {
    store.close()
  }
})
test('the security log attributes actions without plaintext passwords or recovery codes', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    const access = await auth.setup(setup)
    await auth.createAccount(create())
    const events = auth.securityEvents(),
      text = JSON.stringify(events)
    assert.ok(
      events.some(
        (e) => e.action === 'account.created' && e.actor === 'owner' && e.target === 'staff',
      ),
    )
    for (const secret of [password, temp, access.recoveryCode!]) assert.ok(!text.includes(secret))
  } finally {
    auth.close()
  }
})
test('business commands are limited to 120 requests per ten seconds', async () => {
  let now = 1_000_000
  const auth = new OwnerAuth(
    ':memory:',
    () => {},
    () => now,
  )
  try {
    await auth.setup(setup)
    for (let i = 0; i < 120; i++) auth.authorize('store:snapshot')
    assert.throws(() => auth.authorize('sale:checkout'), /Too many store requests/)
    now += 10_001
    auth.authorize('sale:checkout')
  } finally {
    auth.close()
  }
})
