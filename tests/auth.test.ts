import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { OwnerAuth } from '../electron/auth'
import { Store } from '../electron/store'

const password = 'a private store passphrase'
const setup = { username: 'owner', password, confirmPassword: password }
const replacement = 'another private store phrase'
const cleanup = (folder: string) => {
  const target = resolve(folder)
  assert.equal(dirname(target), resolve(tmpdir()))
  assert.ok(basename(target).startsWith('dormstore-auth-test-'))
  rmSync(target, { recursive: true, force: true })
}

test('new installs fail closed and validate password confirmation and length', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    assert.equal(auth.status().configured, false)
    assert.equal(auth.status().authenticated, false)
    assert.throws(() => auth.requireSession(), /locked/)
    await assert.rejects(() =>
      auth.setup({ ...setup, password: 'short', confirmPassword: 'short' }),
    )
    await assert.rejects(() => auth.setup({ ...setup, confirmPassword: 'different' }))
    assert.equal(auth.status().configured, false)
  } finally {
    auth.close()
  }
})
test('owner creation stores a unique salted hash and only one owner can be created', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-auth-test-')),
    path = join(folder, 'auth.db'),
    auth = new OwnerAuth(path)
  try {
    const result = await auth.setup({ ...setup, username: 'OWNER' })
    assert.equal(result.state.username, 'owner')
    assert.equal(result.state.authenticated, true)
    assert.match(result.recoveryCode!, /^[A-F0-9]{8}(-[A-F0-9]{8}){7}$/)
    const inspect = new Database(path, { readonly: true })
    const row = inspect.prepare('SELECT * FROM accounts').get() as {
      password_hash: Buffer
      salt: Buffer
      recovery_hash: Buffer
    }
    inspect.close()
    assert.equal(row.password_hash.length, 64)
    assert.equal(row.salt.length, 32)
    assert.notEqual(row.password_hash.toString(), password)
    assert.notEqual(
      row.recovery_hash.toString('hex').toUpperCase(),
      result.recoveryCode!.replaceAll('-', ''),
    )
    await assert.rejects(() => auth.setup(setup), /already exists/)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('wrong credentials never open a session, logout invalidates old session generations', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    const generation = auth.requireSession()
    auth.lock()
    assert.equal(auth.status().username, null)
    await assert.rejects(
      () => auth.signIn({ username: 'owner', password: 'wrong password here' }),
      /incorrect/,
    )
    await assert.rejects(() => auth.signIn({ username: 'unknown', password }), /incorrect/)
    assert.throws(() => auth.requireSession(), /locked/)
    await auth.signIn({ username: 'OWNER', password })
    assert.throws(() => auth.requireSession(generation), /locked/)
  } finally {
    auth.close()
  }
})
test('owner credentials survive restart, but authenticated sessions do not', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-auth-test-')),
    path = join(folder, 'auth.db')
  let auth = new OwnerAuth(path)
  try {
    await auth.setup(setup)
    auth.close()
    auth = new OwnerAuth(path)
    assert.equal(auth.status().configured, true)
    assert.equal(auth.status().authenticated, false)
    await auth.signIn({ username: 'owner', password })
    assert.equal(auth.status().authenticated, true)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('five failed attempts cause a persistent cooldown across process restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-auth-test-')),
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
    for (let i = 0; i < 5; i++)
      await assert.rejects(() => auth.signIn({ username: 'owner', password: 'invalid password' }))
    const inspect = new Database(path, { readonly: true })
    assert.equal(
      (
        inspect
          .prepare('SELECT locked_until FROM login_attempts WHERE username=?')
          .get('owner') as { locked_until: number }
      ).locked_until,
      now + 60_000,
    )
    inspect.close()
    auth.close()
    auth = new OwnerAuth(
      path,
      () => {},
      () => now,
    )
    await assert.rejects(() => auth.signIn({ username: 'owner', password }), /incorrect/)
    now += 60_001
    await auth.signIn({ username: 'owner', password })
    assert.equal(auth.status().lockedUntil, 0)
  } finally {
    auth.close()
    cleanup(folder)
  }
})
test('inactivity locks the session and activity refreshes only a valid session', async () => {
  let now = 1000,
    lockedEvents = 0
  const auth = new OwnerAuth(
    ':memory:',
    () => {
      lockedEvents++
    },
    () => now,
  )
  try {
    await auth.setup(setup)
    now += 9 * 60_000
    auth.activity()
    now += 9 * 60_000
    assert.equal(auth.status().authenticated, true)
    now += 60_000
    assert.equal(auth.status().authenticated, false)
    assert.equal(lockedEvents, 1)
    assert.throws(() => auth.activity(), /locked/)
  } finally {
    auth.close()
  }
})
test('password changes require the current password and preserve the existing recovery code', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    const account = await auth.setup(setup)
    await assert.rejects(
      () =>
        auth.changePassword({
          currentPassword: 'incorrect',
          password: replacement,
          confirmPassword: replacement,
        }),
      /incorrect/,
    )
    await auth.changePassword({
      currentPassword: password,
      password: replacement,
      confirmPassword: replacement,
    })
    auth.lock()
    await assert.rejects(() => auth.signIn({ username: 'owner', password }), /incorrect/)
    await auth.signIn({ username: 'owner', password: replacement })
    auth.lock()
    await auth.resetPassword({
      username: 'owner',
      recoveryCode: account.recoveryCode,
      password,
      confirmPassword: password,
    })
    assert.equal(auth.status().authenticated, true)
  } finally {
    auth.close()
  }
})
test('recovery codes rotate on reset and a wrong or previously consumed code cannot reset the password', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    const account = await auth.setup(setup)
    auth.lock()
    await assert.rejects(
      () =>
        auth.resetPassword({
          username: 'owner',
          recoveryCode: 'wrong',
          password: replacement,
          confirmPassword: replacement,
        }),
      /incorrect/,
    )
    const recovered = await auth.resetPassword({
      username: 'owner',
      recoveryCode: account.recoveryCode!.toLowerCase(),
      password: replacement,
      confirmPassword: replacement,
    })
    assert.notEqual(account.recoveryCode, recovered.recoveryCode)
    auth.lock()
    await assert.rejects(
      () =>
        auth.resetPassword({
          username: 'owner',
          recoveryCode: account.recoveryCode,
          password,
          confirmPassword: password,
        }),
      /incorrect/,
    )
    await auth.signIn({ username: 'owner', password: replacement })
  } finally {
    auth.close()
  }
})
test('locking cancels an in-flight password verification instead of reopening the session', async () => {
  const auth = new OwnerAuth(':memory:')
  try {
    await auth.setup(setup)
    auth.lock()
    const pending = auth.signIn({ username: 'owner', password })
    auth.lock()
    await assert.rejects(() => pending, /locked during/)
    assert.equal(auth.status().authenticated, false)
  } finally {
    auth.close()
  }
})
test('business backup restoration does not change owner credentials', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-auth-test-')),
    auth = new OwnerAuth(join(folder, 'auth.db')),
    store = new Store(join(folder, 'store.db'))
  try {
    await auth.setup(setup)
    const backup = join(folder, 'backup.db')
    await store.backup(backup)
    await auth.changePassword({
      currentPassword: password,
      password: replacement,
      confirmPassword: replacement,
    })
    await store.restore(backup)
    auth.lock()
    await assert.rejects(() => auth.signIn({ username: 'owner', password }), /incorrect/)
    await auth.signIn({ username: 'owner', password: replacement })
  } finally {
    store.close()
    auth.close()
    cleanup(folder)
  }
})
test('adding login to an existing store preserves its catalog, sales and customer debt', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dormstore-auth-test-')),
    storePath = join(folder, 'store.db')
  let store = new Store(storePath)
  let auth: OwnerAuth | undefined
  try {
    const product = store.saveProduct({
      name: 'Existing coffee',
      sku: 'EXISTING-001',
      category: 'Coffee & drinks',
      price: 1200,
      cost: 800,
      stock: 10,
      low_stock: 2,
      unit: 'pc',
    })
    const customer = store.saveCustomer({
      name: 'Existing customer',
      room: '204',
      phone: '',
      notes: '',
      credit_limit: 50000,
    })
    store.checkout({
      items: [{ product_id: product, quantity: 2 }],
      customer_id: customer,
      payment_method: 'credit',
      paid: 400,
      tendered: 400,
      notes: '',
    })
    const before = store.snapshot()
    store.close()
    store = new Store(storePath)
    auth = new OwnerAuth(join(folder, 'owner-auth.db'))
    assert.equal(auth.status().configured, false)
    assert.throws(() => auth!.requireSession(), /locked/)
    await auth.setup(setup)
    const after = store.snapshot()
    assert.deepEqual(after.products, before.products)
    assert.deepEqual(after.sales, before.sales)
    assert.deepEqual(after.customers, before.customers)
    assert.equal(after.totalDebt, 2000)
  } finally {
    auth?.close()
    store.close()
    cleanup(folder)
  }
})
