import { _electron as electron } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const expect = baseExpect.configure({ timeout: 30000 })
mkdirSync('test-output', { recursive: true })
const profile = mkdtempSync(resolve('test-output', 'desktop-'))
const external = mkdtempSync(resolve('test-output', 'exports-'))
const runtime = process.env.DORMSTORE_TEST_EXE || require('electron')
const resultPath = process.env.DORMSTORE_TEST_EXE
  ? 'test-output/packaged-e2e-result.json'
  : 'test-output/e2e-result.json'
const args = process.env.DORMSTORE_TEST_EXE ? [] : ['.']
const env = { ...process.env, DORMSTORE_DATA_DIR: profile }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = []
// Capture the native desktop surface without asking Chromium to resize its viewport.
const capture = async (path) => {
  const pixels = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().startsWith('data:'),
    )
    if (!window) throw new Error('The store window is unavailable for capture.')
    window.webContents.setBackgroundThrottling(false)
    return (await window.webContents.capturePage()).toPNG().toString('base64')
  })
  expect(pixels.length).toBeGreaterThan(100)
  writeFileSync(path, Buffer.from(pixels, 'base64'))
}
const initialPassword = 'a private test store passphrase'
let ownerPassword = initialPassword
let recoveryCode = ''
const assertLocked = async () => {
  const results = await page.evaluate(async () => {
    const methods = [
      'snapshot',
      'saveProduct',
      'archiveProduct',
      'adjustStock',
      'saveCustomer',
      'customerAccount',
      'repay',
      'checkout',
      'receipt',
      'voidSale',
      'saveExpense',
      'deleteExpense',
      'report',
      'saveSettings',
      'seedCatalog',
      'backup',
      'restore',
      'exportReport',
      'printReceipt',
      'changePassword',
      'listAccounts',
      'createAccount',
      'updateAccount',
      'resetAccountPassword',
      'securityEvents',
      'listShops',
      'createShop',
      'switchShop',
    ]
    return Promise.all(
      methods.map(async (method) => ({ method, result: await window.dormstore[method]({}) })),
    )
  })
  for (const { method, result } of results) {
    expect(result.ok, `${method} must be blocked`).toBe(false)
    expect(result.error).toMatch(/locked/i)
  }
  await expect(page.getByRole('navigation')).toHaveCount(0)
}
const signIn = async (password = ownerPassword) => {
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible()
}
const acknowledgeRecovery = async () => {
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible()
  const code = await page.getByRole('textbox', { name: 'Recovery code', exact: true }).inputValue()
  expect(code).toMatch(/^[A-F0-9]{8}(-[A-F0-9]{8}){7}$/)
  await page.getByRole('checkbox', { name: 'I have saved my recovery code privately.' }).check()
  await page.getByRole('button', { name: 'Open my store' }).click()
  await expect(page.getByRole('navigation')).toBeVisible()
  return code
}
const nav = async (name) => {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}
const snapshot = async () => {
  const r = await page.evaluate(() => window.dormstore.snapshot())
  if (!r.ok) throw new Error(r.error)
  return r.data
}
const ok = async (promise) => {
  const r = await promise
  expect(r.ok, r.error).toBe(true)
  return r.data
}
try {
  app = await electron.launch({ executablePath: runtime, args, env, timeout: 45000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await expect(page.getByRole('heading', { name: 'Secure your store' })).toBeVisible()
  await assertLocked()
  await capture('test-output/owner-setup.png')
  await page.getByLabel('Shop name', { exact: true }).fill('DormStore')
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Password', { exact: true }).fill(ownerPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(ownerPassword)
  await page.getByRole('button', { name: 'Create owner account' }).click()
  recoveryCode = await acknowledgeRecovery()
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await assertLocked()
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Password', { exact: true }).fill('this password is wrong')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await assertLocked()
  await capture('test-output/sign-in.png')
  await signIn()
  console.log(
    'PASS: first-run owner setup, recovery acknowledgement, wrong-password rejection, and all protected IPC denied while locked',
  )
  expect(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      bridge: typeof window.dormstore.checkout,
    })),
  ).toEqual({ require: 'undefined', process: 'undefined', bridge: 'function' })
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  )
  expect(preferences.contextIsolation).toBe(true)
  expect(preferences.nodeIntegration).toBe(false)
  expect(preferences.sandbox).toBe(true)
  await capture('test-output/dashboard-empty.png')
  console.log('PASS: real Electron starts with sandboxed renderer and working preload IPC')
  await nav('Settings')
  await page.getByLabel('Owner name', { exact: true }).fill('Maria Santos')
  await page.getByLabel('Store address / dormitory').fill('Mabini Dormitory, Quezon City')
  await page.getByRole('button', { name: 'Save store details' }).click()
  await expect(page.getByRole('status')).toContainText('Store settings saved')
  await page.getByRole('button', { name: 'Change password', exact: true }).click()
  const passwordDialog = page.getByRole('dialog')
  await passwordDialog.getByLabel('Current password', { exact: true }).fill(ownerPassword)
  ownerPassword = 'a changed private store passphrase'
  await passwordDialog.getByLabel('New password', { exact: true }).fill(ownerPassword)
  await passwordDialog.getByLabel('Confirm new password', { exact: true }).fill(ownerPassword)
  await passwordDialog.getByRole('button', { name: 'Save new password' }).click()
  await expect(passwordDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Load starter catalog', exact: true }).click()
  await page.getByRole('button', { name: 'Load 24 products' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await snapshot()).products).toHaveLength(24)
  await nav('Products')
  await page.getByRole('button', { name: 'Add product', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Product name').fill('Test Coffee')
  await dialog.getByLabel('SKU', { exact: true }).fill('QA-COFFEE')
  await dialog.getByLabel('Barcode (optional)').fill('1234567890123')
  await dialog.getByLabel('Category', { exact: true }).selectOption('Coffee & drinks')
  await dialog.getByLabel('Cost price (₱)').fill('8.00')
  await dialog.getByLabel('Selling price (₱)').fill('12.00')
  await dialog.getByLabel('Opening stock').fill('10')
  await dialog.getByRole('button', { name: 'Add product', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const search = page.getByRole('textbox', { name: 'Search name, SKU or barcode…' })
  await search.fill('Test Coffee')
  await expect(page.getByRole('cell', { name: 'Test Coffee', exact: false }).first()).toBeVisible()
  console.log('PASS: store settings, starter catalog, and product creation through the UI')
  await nav('Customers')
  await page.getByRole('button', { name: 'Add customer', exact: true }).click()
  await dialog.getByLabel('Full name').fill('Ana Test')
  await dialog.getByLabel('Room / dorm').fill('204')
  await dialog.getByLabel('Credit limit (₱)').fill('500.00')
  await dialog.getByRole('button', { name: 'Add customer', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const created = await snapshot(),
    coffee = created.products.find((p) => p.sku === 'QA-COFFEE'),
    customer = created.customers.find((c) => c.name === 'Ana Test')
  await page.keyboard.press('F2')
  const scanner = page.getByRole('textbox', { name: 'Search or scan product' })
  expect(
    await scanner.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
  ).toBeGreaterThanOrEqual(32)
  await scanner.fill('1234567890123')
  await scanner.press('Enter')
  await expect(page.getByLabel('Quantity for Test Coffee')).toHaveValue('1')
  await page.getByLabel('Cash received (₱)').fill('20.00')
  await page.getByRole('button', { name: /Review sale/ }).click()
  await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Sale receipt' })).toBeVisible()
  await expect(dialog).toContainText('₱8.00')
  // Exercise the actual receipt handler and HTML renderer; replace only the OS printer call.
  await app.evaluate(({ app }) => {
    app.once('web-contents-created', (_event, contents) => {
      contents.print = (_options, callback) => {
        contents
          .executeJavaScript('document.body.innerText')
          .then((text) => {
            globalThis.__dormstorePrintedReceipt = text
            callback(true)
          })
          .catch((error) => callback(false, String(error)))
      }
    })
  })
  await dialog.getByRole('button', { name: 'Print receipt' }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.__dormstorePrintedReceipt || ''))
    .toContain('Test Coffee')
  expect(await app.evaluate(() => globalThis.__dormstorePrintedReceipt)).toContain('PHP 8.00')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  let current = await snapshot()
  expect(current.products.find((p) => p.id === coffee.id).stock).toBe(9)
  expect(current.today.revenue).toBe(1200)
  console.log(
    'PASS: barcode checkout, payment, change, native receipt rendering, and stock deduction',
  )
  await scanner.fill('QA-COFFEE')
  await scanner.press('Enter')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByLabel('Customer', { exact: true }).selectOption(String(customer.id))
  await page.getByRole('button', { name: 'Credit', exact: true }).click()
  await page.getByLabel('Cash down payment (₱)').fill('4.00')
  await page.getByRole('button', { name: /Review sale/ }).click()
  await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Sale receipt' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  current = await snapshot()
  expect(current.customers.find((c) => c.id === customer.id).balance).toBe(2000)
  await nav('Customers')
  await page.getByRole('button', { name: 'Payment', exact: true }).click()
  await dialog.getByLabel('Amount received (₱)').fill('5.00')
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(dialog).toHaveCount(0)
  current = await snapshot()
  expect(current.customers.find((c) => c.id === customer.id).balance).toBe(1500)
  console.log('PASS: customer credit with down payment and debt repayment')
  await nav('Inventory')
  await page.getByRole('textbox', { name: 'Search name, SKU or barcode…' }).fill('Test Coffee')
  await page.getByRole('button', { name: 'Adjust stock for Test Coffee' }).click()
  await dialog.getByLabel('Quantity', { exact: true }).fill('5')
  await dialog.getByLabel('Note / supplier reference').fill('UI test delivery')
  await dialog.getByRole('button', { name: 'Record adjustment' }).click()
  await expect(dialog).toHaveCount(0)
  current = await snapshot()
  expect(current.products.find((p) => p.id === coffee.id).stock).toBe(12)
  await nav('Expenses')
  await page.getByRole('button', { name: 'Record expense', exact: true }).click()
  await dialog.getByLabel('Description', { exact: true }).fill('Store electricity share')
  await dialog.getByLabel('Amount (₱)').fill('2.00')
  await dialog.getByRole('button', { name: 'Save expense' }).click()
  await expect(dialog).toHaveCount(0)
  await nav('Reports')
  await expect(page.getByText('Updating report…')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Daily performance' })).toBeVisible()
  await capture('test-output/reports.png')
  const csv = join(external, 'report.csv')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, csv)
  await page.getByRole('button', { name: 'Export CSV' }).click()
  await expect.poll(() => existsSync(csv)).toBe(true)
  expect(readFileSync(csv, 'utf8')).toContain('Revenue')
  console.log('PASS: inventory restock, operating expense, reports and CSV export')
  const backup = join(external, 'manual-backup.db')
  await nav('Settings')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, backup)
  await page.getByRole('button', { name: 'Save a backup' }).click()
  await expect.poll(() => existsSync(backup)).toBe(true)
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  const savedCount = (await snapshot()).expenses.length
  await ok(
    page.evaluate(() =>
      window.dormstore.saveExpense({
        description: 'After backup',
        category: 'Other',
        amount: 100,
        date: new Date().toLocaleDateString('en-CA'),
        notes: '',
      }),
    ),
  )
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, backup)
  await page.getByRole('button', { name: 'Restore a backup' }).click()
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  await expect.poll(async () => (await snapshot()).expenses.length).toBe(savedCount)
  console.log('PASS: native backup and restore handlers preserve the selected snapshot')
  const csvBackup = join(external, 'manual-backup.csv')
  const stockBeforeCSV = (await snapshot()).products.find((p) => p.id === coffee.id).stock
  await page.getByLabel('Backup format', { exact: true }).selectOption('csv')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__backupSaveOptions = options
      return { canceled: false, filePath: path }
    }
  }, csvBackup)
  await page.getByRole('button', { name: 'Save a backup' }).click()
  await expect.poll(() => existsSync(csvBackup)).toBe(true)
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  expect(readFileSync(csvBackup, 'utf8')).toContain('"DormStore shop backup","2"')
  expect(readFileSync(csvBackup, 'utf8')).toContain('"Unpaid customer balances"')
  expect(readFileSync(csvBackup, 'utf8')).toContain('"price (PHP)"')
  expect(await app.evaluate(() => globalThis.__backupSaveOptions.filters[0].extensions)).toEqual([
    'csv',
  ])
  expect(await app.evaluate(() => globalThis.__backupSaveOptions.defaultPath)).toMatch(/\.csv$/)
  await capture('test-output/settings-backup-formats.png')
  await ok(
    page.evaluate(
      (id) =>
        window.dormstore.adjustStock({
          product_id: id,
          quantity: 3,
          reason: 'Restock',
          notes: 'After CSV backup',
        }),
      coffee.id,
    ),
  )
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.__backupOpenOptions = options
      return { canceled: false, filePaths: [path] }
    }
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, csvBackup)
  // Cancelling the confirmation must leave current stock untouched.
  expect((await page.evaluate(() => window.dormstore.restore())).data).toBe(false)
  expect((await snapshot()).products.find((p) => p.id === coffee.id).stock).toBe(stockBeforeCSV + 3)
  expect(await app.evaluate(() => globalThis.__backupOpenOptions.filters[0].extensions)).toEqual([
    'db',
    'csv',
    'xlsx',
  ])
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await page.getByRole('button', { name: 'Restore a backup' }).click()
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  await expect
    .poll(async () => (await snapshot()).products.find((p) => p.id === coffee.id).stock)
    .toBe(stockBeforeCSV)
  expect((await page.evaluate(() => window.dormstore.backup('invalid'))).ok).toBe(false)
  await page.getByLabel('Backup format', { exact: true }).selectOption('db')
  console.log('PASS: CSV backup format selector, dialog filters, cancellation and full restore')
  const excelBackup = join(external, 'owner-backup.xlsx')
  await page.getByLabel('Backup format', { exact: true }).selectOption('xlsx')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__backupSaveOptions = options
      return { canceled: false, filePath: path }
    }
  }, excelBackup)
  await page.getByRole('button', { name: 'Save a backup' }).click()
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  await expect.poll(() => existsSync(excelBackup)).toBe(true)
  expect(await app.evaluate(() => globalThis.__backupSaveOptions.filters[0].extensions)).toEqual([
    'xlsx',
  ])
  await capture('test-output/settings-excel-backup.png')
  await ok(
    page.evaluate(
      (id) =>
        window.dormstore.adjustStock({
          product_id: id,
          quantity: 2,
          reason: 'Restock',
          notes: 'After Excel backup',
        }),
      coffee.id,
    ),
  )
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, excelBackup)
  await page.getByRole('button', { name: 'Restore a backup' }).click()
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeEnabled()
  await expect
    .poll(async () => (await snapshot()).products.find((p) => p.id === coffee.id).stock)
    .toBe(stockBeforeCSV)
  await page.getByLabel('Backup format', { exact: true }).selectOption('db')
  console.log('PASS: Excel workbook selector, save filter and complete restore through Settings')
  await nav('Sales history')
  const cashSale = (await snapshot()).sales.find((s) => s.payment_method === 'cash')
  await page.getByRole('button', { name: `Void sale ${cashSale.receipt}` }).click()
  await dialog.getByLabel('Reason for voiding').fill('All goods returned')
  await dialog.getByRole('button', { name: 'Void sale', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  current = await snapshot()
  expect(current.today.revenue).toBe(2400)
  expect(current.today.cogs).toBe(1600)
  expect(current.today.expenses).toBe(200)
  expect(current.today.collections).toBe(900)
  await nav('Dashboard')
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' })
  if (await dismiss.count()) await dismiss.click()
  await capture('test-output/dashboard.png')
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await nav('Point of sale')
  await page.getByRole('button', { name: /Review sale/ }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: /Review sale/ })).toBeInViewport()
  await capture('test-output/checkout-1100.png')
  await nav('Inventory')
  await page.getByRole('button', { name: 'Movement history' }).click()
  await expect(page.getByRole('cell', { name: 'UI test delivery' })).toBeVisible()
  expect(errors).toEqual([])
  console.log(
    'PASS: sale void, dashboard totals, minimum window layout, stock ledger, and zero renderer errors',
  )
  await nav('Point of sale')
  await page.getByRole('textbox', { name: 'Search or scan product' }).fill('QA-COFFEE')
  await page.getByRole('textbox', { name: 'Search or scan product' }).press('Enter')
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock and clear cart' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await assertLocked()
  await signIn()
  await nav('Point of sale')
  await expect(page.getByLabel('Quantity for Test Coffee')).toHaveCount(0)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await assertLocked()
  await signIn()
  console.log(
    'PASS: logout clears private workspace/cart state and Windows lock invalidates the session',
  )
  await app.evaluate(({ app }) => app.exit())
  await app.close()
  app = await electron.launch({ executablePath: runtime, args, env, timeout: 45000 })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await assertLocked()
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Password', { exact: true }).fill(initialPassword)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await signIn()
  const restarted = await snapshot()
  expect(restarted.customers.find((c) => c.id === customer.id).balance).toBe(1500)
  expect(restarted.sales).toHaveLength(2)
  expect(restarted.settings.owner_name).toBe('Maria Santos')
  console.log('PASS: real desktop restart preserves sales, customer debt, and settings')
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Saved recovery code', { exact: true }).fill(recoveryCode)
  ownerPassword = 'a recovered private owner passphrase'
  await page.getByLabel('New password', { exact: true }).fill(ownerPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(ownerPassword)
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  const rotated = await acknowledgeRecovery()
  expect(rotated).not.toBe(recoveryCode)
  expect((await snapshot()).today.revenue).toBe(2400)
  expect(errors).toEqual([])
  console.log(
    'PASS: owner password change persists and offline account recovery rotates the recovery code without changing store records',
  )
  await nav('Accounts')
  await page.getByRole('button', { name: 'Add account', exact: true }).click()
  let accountDialog = page.getByRole('dialog')
  const staffTemporary = 'staff temporary secret phrase',
    staffPrivate = 'staff private chosen phrase'
  await accountDialog.getByLabel('Display name', { exact: true }).fill('Test Cashier')
  await accountDialog.getByLabel('Username', { exact: true }).fill('cashier')
  await accountDialog.getByLabel('Temporary password', { exact: true }).fill(staffTemporary)
  await accountDialog.getByLabel('Confirm temporary password', { exact: true }).fill(staffTemporary)
  await accountDialog.getByLabel('Your owner password', { exact: true }).fill(ownerPassword)
  await accountDialog.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(accountDialog).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Test Cashier cashier' })).toBeVisible()
  const accountResult = await page.evaluate(() => window.dormstore.listAccounts())
  expect(accountResult.ok).toBe(true)
  const staff = accountResult.data.find((a) => a.username === 'cashier')
  expect(staff.role).toBe('staff')
  await capture('test-output/accounts.png')
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await page.getByLabel('Username', { exact: true }).fill('cashier')
  await page.getByLabel('Password', { exact: true }).fill(staffTemporary)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
  const forced = await page.evaluate(() => window.dormstore.snapshot())
  expect(forced.ok).toBe(false)
  expect(forced.error).toContain('temporary password')
  await page.getByLabel('Temporary password', { exact: true }).fill(staffTemporary)
  await page.getByLabel('New password', { exact: true }).fill(staffPrivate)
  await page.getByLabel('Confirm password', { exact: true }).fill(staffPrivate)
  await page.getByRole('button', { name: 'Save my password', exact: true }).click()
  await acknowledgeRecovery()
  await expect(page.getByRole('heading', { name: 'Point of sale', exact: true })).toBeVisible()
  for (const name of ['Dashboard', 'Inventory', 'Expenses', 'Reports', 'Accounts'])
    await expect(
      page.getByRole('navigation').getByRole('button', { name, exact: true }),
    ).toHaveCount(0)
  const denied = await page.evaluate(async () => {
    const methods = [
      'saveProduct',
      'archiveProduct',
      'adjustStock',
      'saveCustomer',
      'voidSale',
      'saveExpense',
      'deleteExpense',
      'report',
      'saveSettings',
      'seedCatalog',
      'backup',
      'restore',
      'exportReport',
      'listAccounts',
      'createAccount',
      'updateAccount',
      'resetAccountPassword',
      'securityEvents',
    ]
    return Promise.all(
      methods.map(async (method) => ({ method, result: await window.dormstore[method]({}) })),
    )
  })
  for (const { method, result } of denied) {
    expect(result.ok, method).toBe(false)
    expect(result.error).toMatch(/permission/)
  }
  const staffData = await snapshot()
  expect(staffData.products.every((p) => p.cost === 0)).toBe(true)
  expect(staffData.sales.every((s) => s.cost === 0)).toBe(true)
  expect(staffData.expenses).toEqual([])
  expect(staffData.databasePath).toBe('')
  expect(staffData.today.cogs).toBe(0)
  await nav('Products')
  await expect(page.getByRole('button', { name: 'Add product', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Cost', exact: true })).toHaveCount(0)
  await nav('Customers')
  await expect(page.getByRole('button', { name: 'Add customer', exact: true })).toHaveCount(0)
  await nav('Settings')
  await expect(page.getByRole('button', { name: 'Save a backup' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save store details' })).toHaveCount(0)
  const staffCheckout = await page.evaluate(
    (id) =>
      window.dormstore.checkout({
        items: [{ product_id: id, quantity: 1 }],
        payment_method: 'cash',
        paid: 1200,
        tendered: 1200,
        notes: 'Staff test sale',
      }),
    coffee.id,
  )
  expect(staffCheckout.ok).toBe(true)
  expect(staffCheckout.data.sale.cost).toBe(0)
  expect(staffCheckout.data.items[0].cost).toBe(0)
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await signIn()
  expect((await snapshot()).today.revenue).toBe(3600)
  expect((await snapshot()).today.cogs).toBe(2400)
  await nav('Accounts')
  let row = page.getByRole('row').filter({ hasText: 'cashier' })
  await row.getByRole('button', { name: 'Manage', exact: true }).click()
  accountDialog = page.getByRole('dialog')
  await accountDialog.getByRole('checkbox', { name: 'Account enabled', exact: true }).uncheck()
  await accountDialog.getByLabel('Your owner password', { exact: true }).fill(ownerPassword)
  await accountDialog.getByRole('button', { name: 'Save account', exact: true }).click()
  await expect(accountDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Lock store', exact: true }).click()
  await page.getByLabel('Username', { exact: true }).fill('cashier')
  await page.getByLabel('Password', { exact: true }).fill(staffPrivate)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await assertLocked()
  await signIn()
  await nav('Accounts')
  row = page.getByRole('row').filter({ hasText: 'cashier' })
  await row.getByRole('button', { name: 'Manage', exact: true }).click()
  accountDialog = page.getByRole('dialog')
  await accountDialog.getByRole('checkbox', { name: 'Account enabled', exact: true }).check()
  await accountDialog
    .getByRole('checkbox', { name: 'Clear this account’s failed sign-in attempts and cooldown' })
    .check()
  await accountDialog.getByLabel('Your owner password', { exact: true }).fill(ownerPassword)
  await accountDialog.getByRole('button', { name: 'Save account', exact: true }).click()
  await expect(accountDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Security activity', exact: true }).click()
  await expect(
    page.getByRole('cell', { name: 'Account created', exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Permission denied', exact: true }).first(),
  ).toBeVisible()
  await capture('test-output/security-activity.png')
  const quota = await page.evaluate(async () => {
    const errors = []
    for (let i = 0; i < 21; i++) {
      const result = await window.dormstore.signIn({})
      if (!result.ok) errors.push(result.error)
    }
    return errors
  })
  expect(quota.some((error) => error.includes('Too many authentication requests'))).toBe(true)
  expect((await snapshot()).today.revenue).toBe(3600)
  console.log(
    'PASS: owner-managed accounts, forced private passwords, staff permissions and data redaction, staff checkout, disabling/unlocking accounts, security audit and application-wide authentication rate limit',
  )
  writeFileSync(
    resultPath,
    JSON.stringify({ ok: true, runtime, profile, rendererErrors: errors }, null, 2),
  )
} catch (error) {
  if (page) await capture('test-output/e2e-failure.png').catch(() => {})
  writeFileSync(
    resultPath,
    JSON.stringify({ ok: false, error: String(error), rendererErrors: errors, profile }, null, 2),
  )
  console.error(error)
  process.exitCode = 1
} finally {
  if (app) await app.evaluate(({ app }) => app.exit()).catch(() => {})
  await app?.close().catch(() => {})
}
