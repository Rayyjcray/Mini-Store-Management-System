import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  type IpcMainInvokeEvent,
} from 'electron'
import { extname, join } from 'node:path'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { Store, errorMessage, localDay } from './store'
import type { Receipt } from '../shared/contracts'
import { backupFormatSchema, rangeSchema } from '../shared/validation'
import { OwnerAuth } from './auth'
import { visibleReceipt, visibleSnapshot } from './access'
import { ShopStores } from './shops'

app.setName('DormStore')
app.setAppUserModelId('com.dormstore.management')
if (process.env.DORMSTORE_DATA_DIR || !app.isPackaged) {
  // Keep development instances away from the installed app's database, cache and lock.
  const profile = process.env.DORMSTORE_DATA_DIR || join(app.getPath('appData'), 'DormStore-dev')
  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
  // Chromium's session path must also be set explicitly before app readiness.
  app.setPath('sessionData', profile)
}
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()
let window: BrowserWindow | null = null
let stores: ShopStores
let auth: OwnerAuth
let authTimer: ReturnType<typeof setInterval> | undefined
let maintenance = false
const dataPath = process.env.DORMSTORE_DATA_DIR || join(app.getPath('userData'), 'data')
const developmentURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (v) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[v]!,
  )
const money = (cents: number) => `PHP ${(cents / 100).toFixed(2)}`
function receiptHTML({ sale, items, settings }: Receipt) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{margin:8mm}body{font:12px monospace;color:#111;max-width:72mm;margin:auto}h2{text-align:center;margin-bottom:5px}p{text-align:center}table{width:100%;border-collapse:collapse}td{padding:5px 0;vertical-align:top}td:last-child{text-align:right}hr{border:0;border-top:1px dashed #333}.small{font-size:10px}</style></head><body>
    <h2>${escape(settings.store_name)}</h2><p>${escape(settings.address)}</p><hr><div>${escape(sale.receipt)}</div><div>${escape(sale.created_at.replace('T', ' '))}</div><div>${escape(sale.customer_name || 'Walk-in customer')}</div>${sale.status === 'voided' ? '<h2>VOIDED</h2>' : ''}<hr><table>${items.map((i) => `<tr><td>${escape(i.name)}<br><span class="small">${i.quantity} × ${money(i.price)}</span></td><td>${money(i.quantity * i.price)}</td></tr>`).join('')}</table><hr><table><tr><td>TOTAL</td><td>${money(sale.total)}</td></tr><tr><td>Paid (${escape(sale.payment_method)})</td><td>${money(sale.paid)}</td></tr><tr><td>Received</td><td>${money(sale.tendered)}</td></tr><tr><td>Change</td><td>${money(sale.change_amount)}</td></tr><tr><td>Credit balance from sale</td><td>${money(sale.total - sale.paid)}</td></tr></table><hr><p>${escape(settings.receipt_footer)}</p><p class="small">Store transaction record · Not a BIR tax invoice</p></body></html>`
}
function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Unauthorized request.')
  const url = event.senderFrame.url
  if (
    developmentURL
      ? new URL(url).origin !== new URL(developmentURL).origin
      : url !== window.webContents.getURL() || !url.startsWith('file:')
  )
    throw new Error('Unauthorized origin.')
}
function register() {
  const handle = (
    channel: string,
    fn: (input: unknown, generation?: number) => unknown,
    publicAccess = false,
  ) =>
    ipcMain.handle(channel, async (event, input) => {
      try {
        trusted(event)
        const generation = publicAccess ? undefined : auth.authorize(channel)
        const actor = publicAccess ? null : auth.currentUser().username
        const shopId = publicAccess ? null : auth.currentShop().id
        if (maintenance && !publicAccess)
          throw new Error('A database operation is in progress. Try again in a moment.')
        const data = await fn(input, generation)
        if (!publicAccess) auth.requireSession(channel === 'shops:switch' ? undefined : generation)
        if (
          [
            'product:save',
            'product:archive',
            'stock:adjust',
            'customer:save',
            'customer:repay',
            'sale:checkout',
            'sale:void',
            'expense:save',
            'expense:delete',
            'settings:save',
            'catalog:seed',
            'database:backup',
            'database:restore',
          ].includes(channel)
        ) {
          auth.record(
            channel,
            typeof data === 'number'
              ? String(data)
              : channel === 'sale:checkout'
                ? (data as Receipt).sale.receipt
                : null,
            '',
            actor,
            shopId,
          )
        }
        return { ok: true, data }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    })
  const business = (
    channel: string,
    fn: (store: Store, input: unknown, generation?: number) => unknown,
  ) =>
    handle(channel, async (input, generation) => {
      const shop = auth.currentShop(),
        store = await stores.forShop(shop)
      auth.requireSession(generation)
      if (auth.currentUser().role === 'owner' && store.settings().store_name !== shop.name)
        auth.renameCurrentShop(store.settings().store_name)
      return fn(store, input, generation)
    })
  handle('auth:status', () => auth.status(), true)
  handle('auth:setup', (input) => auth.setup(input), true)
  handle('auth:register-owner', (input) => auth.registerOwner(input), true)
  handle('shops:list', () => auth.listShops())
  handle('shops:create', (input) => auth.createShop(input))
  handle('shops:switch', (input) => auth.switchShop(input))
  handle('auth:sign-in', (input) => auth.signIn(input), true)
  handle('auth:sign-out', () => auth.lock(), true)
  handle('auth:reset-password', (input) => auth.resetPassword(input), true)
  handle('auth:change-password', (input) => auth.changePassword(input))
  handle('auth:activity', () => auth.activity(), true)
  handle('accounts:list', () => auth.listAccounts())
  handle('accounts:create', (input) => auth.createAccount(input))
  handle('accounts:update', (input) => auth.updateAccount(input))
  handle('accounts:reset-password', (input) => auth.resetAccountPassword(input))
  handle('security:events', () => auth.securityEvents())
  business('store:snapshot', (store) => visibleSnapshot(store.snapshot(), auth.currentUser().role))
  business('product:save', (store, p) => store.saveProduct(p))
  business('product:archive', (store, id) => store.archiveProduct(id))
  business('stock:adjust', (store, input) => store.adjustStock(input))
  business('customer:save', (store, input) => store.saveCustomer(input))
  business('customer:account', (store, id) => store.customerAccount(id))
  business('customer:repay', (store, input) => store.repay(input))
  business('sale:checkout', (store, input) =>
    visibleReceipt(store.checkout(input), auth.currentUser().role),
  )
  business('sale:receipt', (store, id) =>
    visibleReceipt(store.receipt(id), auth.currentUser().role),
  )
  business('sale:void', (store, input) => store.voidSale(input))
  business('expense:save', (store, input) => store.saveExpense(input))
  business('expense:delete', (store, id) => store.deleteExpense(id))
  business('report:get', (store, input) => store.report(input))
  business('settings:save', (store, input) => {
    store.saveSettings(input)
    auth.renameCurrentShop(store.settings().store_name)
  })
  business('catalog:seed', (store) => store.seedCatalog())
  business('database:backup', async (store, input, generation) => {
    const format = backupFormatSchema.parse(input)
    maintenance = true
    try {
      const { filePath, canceled } = await dialog.showSaveDialog(window!, {
        title: 'Save shop backup',
        defaultPath: `DormStore-${auth.currentShop().id.slice(0, 8)}-${localDay()}.${format}`,
        filters: [
          {
            name:
              format === 'xlsx'
                ? 'Excel workbook backup'
                : format === 'csv'
                  ? 'CSV shop backup'
                  : 'SQLite database backup',
            extensions: [format],
          },
        ],
      })
      if (canceled || !filePath) return null
      auth.requireSession(generation)
      if (extname(filePath).toLowerCase() !== `.${format}`)
        throw new Error(`Use a .${format} filename for the selected backup format.`)
      stores.assertExternalDestination(filePath)
      await store.backup(filePath)
      return filePath
    } finally {
      maintenance = false
    }
  })
  business('database:restore', async (store, _input, generation) => {
    maintenance = true
    try {
      const selected = await dialog.showOpenDialog(window!, {
        title: 'Choose a DormStore backup',
        properties: ['openFile'],
        filters: [
          { name: 'DormStore backups', extensions: ['db', 'csv', 'xlsx'] },
          { name: 'SQLite database backup', extensions: ['db'] },
          { name: 'CSV shop backup', extensions: ['csv'] },
          { name: 'Excel workbook backup', extensions: ['xlsx'] },
        ],
      })
      if (selected.canceled || !selected.filePaths[0]) return false
      auth.requireSession(generation)
      const answer = await dialog.showMessageBox(window!, {
        type: 'warning',
        title: 'Restore database',
        message: `Replace records in ${auth.currentShop().name} with this shop's backup?`,
        detail:
          'A safety copy of the current database will be saved beside the database before replacement. The current checkout cart will be cleared.',
        buttons: ['Cancel', 'Restore backup'],
        defaultId: 0,
        cancelId: 0,
      })
      if (answer.response !== 1) return false
      auth.requireSession(generation)
      await store.restore(selected.filePaths[0])
      return true
    } finally {
      maintenance = false
    }
  })
  business('report:export', async (store, input, generation) => {
    const range = rangeSchema.parse(input),
      report = store.report(range)
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export report',
      defaultPath: `DormStore-${auth.currentShop().id.slice(0, 8)}-report-${range.from}-${range.to}.csv`,
      filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return null
    auth.requireSession(generation)
    stores.assertExternalDestination(result.filePath)
    const csv = (v: unknown) => {
      const s = String(v)
      return `"${(/^[=+@\-\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`
    }
    const rows: unknown[][] = [
      ['DormStore sales report', range.from, range.to],
      ['Metric', 'PHP / count'],
      ['Revenue', (report.revenue / 100).toFixed(2)],
      ['Cost of goods sold', (report.cogs / 100).toFixed(2)],
      ['Gross profit', ((report.revenue - report.cogs) / 100).toFixed(2)],
      ['Operating expenses', (report.expenses / 100).toFixed(2)],
      ['Net profit', ((report.revenue - report.cogs - report.expenses) / 100).toFixed(2)],
      ['Collections incl. repayments', (report.collections / 100).toFixed(2)],
      ['Sales count', report.count],
      [],
      ['Date', 'Sales PHP', 'Gross profit PHP'],
      ...report.daily.map((d) => [
        d.date,
        (d.revenue / 100).toFixed(2),
        (d.profit / 100).toFixed(2),
      ]),
      [],
      ['Product', 'Units sold', 'Sales PHP'],
      ...report.topProducts.map((p) => [p.name, p.quantity, (p.revenue / 100).toFixed(2)]),
    ]
    writeFileSync(
      result.filePath,
      '\ufeff' + rows.map((r) => r.map(csv).join(',')).join('\r\n'),
      'utf8',
    )
    return result.filePath
  })
  business('receipt:print', async (store, id, generation) => {
    const receipt = store.receipt(id)
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    try {
      await printWindow.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(receiptHTML(receipt)),
      )
      auth.requireSession(generation)
      await new Promise<void>((resolve, reject) =>
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, reason) =>
            success ? resolve() : reject(new Error(reason || 'Printing canceled.')),
        ),
      )
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
    }
  })
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: 'DormStore Management System',
    icon: join(app.getAppPath(), 'build/icon.ico'),
    backgroundColor: '#f7f8fa',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  })
  Menu.setApplicationMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault()
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window!, {
      type: 'question',
      title: 'Unfinished sale',
      message: 'Close DormStore and discard the current cart?',
      buttons: ['Keep working', 'Discard and close'],
      defaultId: 0,
      cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })
  window.on('close', (event) => {
    if (maintenance) {
      event.preventDefault()
      return
    }
  })
  if (developmentURL) await window.loadURL(developmentURL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}
if (hasLock) {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      mkdirSync(dataPath, { recursive: true })
      stores = new ShopStores(dataPath)
      let lastShop: string | null = null
      auth = new OwnerAuth(join(dataPath, 'owner-auth.db'), (state) => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('auth:changed', state)
        // Any receipt preview opened for printing must disappear when access is locked.
        if (!state.authenticated || state.shopId !== lastShop)
          for (const extra of BrowserWindow.getAllWindows()) if (extra !== window) extra.destroy()
        lastShop = state.shopId
      })
      register()
      await createWindow()
      authTimer = setInterval(() => auth.status(), 1000)
      powerMonitor.on('lock-screen', () => auth.lock())
      powerMonitor.on('suspend', () => auth.lock())
    })
    .catch((error) => {
      dialog.showErrorBox('DormStore could not start', errorMessage(error))
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    if (authTimer) clearInterval(authTimer)
    auth?.close()
    stores?.close()
  })
  process.on('uncaughtException', (error) => {
    try {
      appendFileSync(join(dataPath, 'errors.log'), `${new Date().toISOString()} ${error.stack}\n`)
    } catch {
      /* No usable data folder. */
    }
    dialog.showErrorBox('DormStore error', errorMessage(error))
  })
}
