import { _electron as electron } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const expect = baseExpect.configure({ timeout: 30000 })
mkdirSync('test-output', { recursive: true })
const profile = mkdtempSync(resolve('test-output', 'shops-desktop-'))
const external = mkdtempSync(resolve('test-output', 'shops-exports-'))
const env = { ...process.env, DORMSTORE_DATA_DIR: profile }
delete env.ELECTRON_RUN_AS_NODE
const runtime = process.env.DORMSTORE_TEST_EXE || require('electron')
const password = 'private independent owner passphrase'
const temporary = 'private temporary cashier passphrase'
const errors = []
let app, page
const api = async (method, input) => {
  const result = await page.evaluate(({ method, input }) => window.dormstore[method](input), {
    method,
    input,
  })
  expect(result.ok, `${method}: ${result.error}`).toBe(true)
  return result.data
}
const deny = async (method, input, message) => {
  const result = await page.evaluate(({ method, input }) => window.dormstore[method](input), {
    method,
    input,
  })
  expect(result.ok, method).toBe(false)
  expect(result.error).toMatch(message)
}
const nav = async (name) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
const recovery = async () => {
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery code privately.' }).check()
  await page.getByRole('button', { name: 'Open my store' }).click()
  await expect(page.getByRole('navigation')).toBeVisible()
}
const signup = async (username, shopName) => {
  await page.getByLabel('Shop name', { exact: true }).fill(shopName)
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create owner account', exact: true }).click()
  await recovery()
}
const login = async (username, secret = password) => {
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
const lock = async () => {
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
}
const product = (name) => ({
  name,
  sku: 'SAME-SKU',
  barcode: '123456789',
  category: 'Coffee & drinks',
  price: 1200,
  cost: 800,
  stock: 10,
  low_stock: 2,
  unit: 'pc',
})
const saveTo = (path) =>
  app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, path)
const restoreFrom = (path) =>
  app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, path)
const capture = async (path) => {
  const pixels = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    return (await window.webContents.capturePage()).toPNG().toString('base64')
  })
  writeFileSync(path, Buffer.from(pixels, 'base64'))
}
try {
  app = await electron.launch({
    executablePath: runtime,
    args: process.env.DORMSTORE_TEST_EXE ? [] : ['.'],
    env,
    timeout: 45000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await signup('owner1', 'Owner One Shop')
  const first = await api('authStatus')
  const p1 = await api('saveProduct', product('Owner One Coffee'))
  const customer1 = await api('saveCustomer', {
    name: 'Owner One Customer',
    room: '101',
    phone: '',
    notes: '',
    credit_limit: 10000,
  })
  await api('checkout', {
    items: [{ product_id: p1, quantity: 2 }],
    customer_id: customer1,
    payment_method: 'credit',
    paid: 400,
    tendered: 400,
    notes: 'Owner One private sale',
  })
  const firstData = await api('snapshot')
  const staff = await api('createAccount', {
    username: 'cashier1',
    displayName: 'First Shop Cashier',
    role: 'staff',
    password: temporary,
    confirmPassword: temporary,
    currentPassword: password,
  })
  const backup = join(external, 'owner-one.db')
  await saveTo(backup)
  await api('backup')
  await lock()
  await page.getByRole('button', { name: 'Create owner account & shop', exact: true }).click()
  await signup('owner2', 'Owner Two Shop')
  const second = await api('authStatus')
  expect(second.shopId).not.toBe(first.shopId)
  const empty = await api('snapshot')
  expect(empty.products).toEqual([])
  expect(empty.customers).toEqual([])
  expect(empty.sales).toEqual([])
  expect(empty.totalDebt).toBe(0)
  expect(empty.settings.store_name).toBe('Owner Two Shop')
  expect((await api('listShops')).map((s) => s.id)).toEqual([second.shopId])
  expect((await api('listAccounts')).map((a) => a.username)).toEqual(['owner2'])
  await deny('switchShop', first.shopId, /access/)
  await deny(
    'updateAccount',
    {
      id: staff,
      displayName: 'Hacked',
      role: 'staff',
      active: false,
      clearLockout: true,
      currentPassword: password,
    },
    /not found in this shop/,
  )
  await deny(
    'resetAccountPassword',
    {
      id: first.userId,
      password: temporary,
      confirmPassword: temporary,
      currentPassword: password,
    },
    /not found in this shop/,
  )
  const events = await api('securityEvents')
  expect(events.some((e) => e.actor === 'owner1' || e.actor === 'cashier1')).toBe(false)
  const p2 = await api('saveProduct', product('Owner Two Coffee'))
  expect(p2).toBe(p1) // overlapping local IDs must never select records from a different shop
  await api('checkout', {
    items: [{ product_id: p2, quantity: 1 }],
    payment_method: 'cash',
    paid: 1200,
    tendered: 1200,
    notes: 'Owner Two private sale',
  })
  const twoData = await api('snapshot')
  expect(twoData.products[0].name).toBe('Owner Two Coffee')
  expect(twoData.products[0].stock).toBe(9)
  expect(twoData.totalDebt).toBe(0)
  await restoreFrom(backup)
  await deny('restore', undefined, /current shop/)
  expect((await api('snapshot')).sales).toHaveLength(1)
  await saveTo(firstData.databasePath)
  await deny('backup', undefined, /outside the application data/)
  await saveTo(join(profile, 'owner-auth.db'))
  await deny(
    'exportReport',
    { from: '2026-01-01', to: '2026-12-31' },
    /outside the application data/,
  )
  console.log(
    'PASS: independent owner signup, empty private shop, account/audit isolation, overlapping record IDs and cross-shop restore/output rejection',
  )
  await nav('Shops')
  await page.getByRole('button', { name: 'Add shop', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Shop name', { exact: true }).fill('Owner Two Branch')
  await dialog.getByLabel('Your owner password', { exact: true }).fill(password)
  await dialog.getByRole('button', { name: 'Create shop', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const branchCard = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Owner Two Branch', exact: true }) })
  await expect(branchCard).toBeVisible()
  await capture('test-output/private-shops.png')
  await branchCard.getByRole('button', { name: 'Open shop', exact: true }).click()
  await expect(page.getByLabel('Active shop')).toHaveValue((await api('authStatus')).shopId)
  const branch = await api('authStatus')
  expect(branch.shopId).not.toBe(second.shopId)
  expect((await api('snapshot')).products).toEqual([])
  await api('saveProduct', product('Branch Coffee'))
  await page.getByLabel('Active shop').selectOption(second.shopId)
  await expect(page.getByLabel('Active shop')).toHaveValue(second.shopId)
  expect((await api('snapshot')).products[0].name).toBe('Owner Two Coffee')
  // Drafts and account-local views must be discarded at the ownership boundary.
  await nav('Point of sale')
  await page.getByRole('textbox', { name: 'Search or scan product' }).fill('123456789')
  await page.getByRole('textbox', { name: 'Search or scan product' }).press('Enter')
  await expect(page.getByLabel('Quantity for Owner Two Coffee')).toHaveValue('1')
  await page.getByLabel('Active shop').selectOption(branch.shopId)
  await expect(
    dialog.getByRole('heading', { name: 'Switch shop and clear this cart?' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Switch shop', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await nav('Point of sale')
  await expect(page.getByLabel('Quantity for Owner Two Coffee')).toHaveCount(0)
  expect((await api('snapshot')).products[0].name).toBe('Branch Coffee')
  console.log(
    'PASS: owner adds private branch through UI, switches owned shops and discards previous-shop drafts',
  )
  await lock()
  await login('owner1')
  await expect(page.getByRole('navigation')).toBeVisible()
  const original = await api('snapshot')
  expect(original.products[0].name).toBe('Owner One Coffee')
  expect(original.products[0].stock).toBe(8)
  expect(original.totalDebt).toBe(2000)
  expect(original.customers[0].name).toBe('Owner One Customer')
  expect((await api('listShops')).map((s) => s.id)).toEqual([first.shopId])
  expect((await api('listAccounts')).map((a) => a.username)).toEqual(['owner1', 'cashier1'])
  await api('saveProduct', { ...product('Temporary product'), sku: 'TEMP', barcode: null })
  await restoreFrom(backup)
  await api('restore')
  expect((await api('snapshot')).products).toHaveLength(1)
  await lock()
  await login('cashier1', temporary)
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
  const staffPassword = 'private cashier chosen passphrase'
  await page.getByLabel('Temporary password', { exact: true }).fill(temporary)
  await page.getByLabel('New password', { exact: true }).fill(staffPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(staffPassword)
  await page.getByRole('button', { name: 'Save my password', exact: true }).click()
  await recovery()
  expect((await api('listShops')).map((s) => s.id)).toEqual([first.shopId])
  expect((await api('snapshot')).products[0].name).toBe('Owner One Coffee')
  await deny('switchShop', second.shopId, /permission/)
  await expect(page.getByLabel('Active shop')).toHaveCount(0)
  await lock()
  await login('owner2')
  await expect(page.getByRole('navigation')).toBeVisible()
  expect((await api('snapshot')).products[0].name).toBe('Owner Two Coffee')
  expect((await api('snapshot')).sales).toHaveLength(1)
  await page.getByLabel('Active shop').selectOption(branch.shopId)
  await expect(page.getByLabel('Active shop')).toHaveValue(branch.shopId)
  expect((await api('snapshot')).products[0].name).toBe('Branch Coffee')
  expect(errors).toEqual([])
  console.log(
    'PASS: original records preserved, same-shop restore, staff stays assigned, other owner shops unaffected, zero renderer errors',
  )
  writeFileSync(
    process.env.DORMSTORE_TEST_EXE
      ? 'test-output/packaged-shops-e2e-result.json'
      : 'test-output/shops-e2e-result.json',
    JSON.stringify(
      {
        passed: true,
        profile,
        external,
        errors,
        shops: 3,
        checks: [
          'owner registration',
          'private SQLite routing',
          'cross-owner authorization',
          'private accounts/audits',
          'backup identity',
          'protected output paths',
          'multi-shop UI',
          'draft clearing',
          'staff assignment',
          'same-shop restore',
        ],
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  if (app && page) await capture('test-output/shops-failure.png').catch(() => {})
  process.exitCode = 1
} finally {
  if (app) await app.evaluate(({ app }) => app.exit()).catch(() => {})
  await app?.close().catch(() => {})
}
