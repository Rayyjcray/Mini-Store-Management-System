import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Store,
  LayoutDashboard,
  ShoppingBasket,
  Package,
  Boxes,
  Users,
  ReceiptText,
  Wallet,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  CircleHelp,
  Check,
  X,
  WifiOff,
  LoaderCircle,
  ChevronRight,
  RefreshCw,
  LockKeyhole,
} from 'lucide-react'
import type { Receipt, Result, Snapshot, Shop } from '../shared/contracts'
import { AppContext, type Page } from './context'
import { Button } from './components/ui/button'
import { Modal } from './components/ui/dialog'
import { money, dateTime, cn } from './lib/utils'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Sales from './pages/Sales'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import POS, { type CartLine } from './pages/POS'
import AuthGate, { useOwner } from './components/AuthGate'
import Accounts from './pages/Accounts'
import Shops from './pages/Shops'

const navigation = [
  {
    group: 'WORKSPACE',
    items: [
      { name: 'Dashboard', icon: LayoutDashboard },
      { name: 'Point of sale', icon: ShoppingBasket },
    ],
  },
  {
    group: 'MANAGEMENT',
    items: [
      { name: 'Products', icon: Package },
      { name: 'Inventory', icon: Boxes },
      { name: 'Customers', icon: Users },
      { name: 'Sales history', icon: ReceiptText },
      { name: 'Expenses', icon: Wallet },
    ],
  },
  {
    group: 'INSIGHTS',
    items: [
      { name: 'Reports', icon: ChartNoAxesCombined },
      { name: 'Settings', icon: SettingsIcon },
      { name: 'Accounts', icon: Users },
      { name: 'Shops', icon: Store },
    ],
  },
] as const

export default function App() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  )
}

function Workspace() {
  const { lockStore, username, role, displayName, shopId, shopName } = useOwner()
  const [shops, setShops] = useState<Shop[]>([])
  const [nextShop, setNextShop] = useState<string | null>(null)
  const [confirmLock, setConfirmLock] = useState(false)
  const [data, setData] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState<Page>(role === 'owner' ? 'Dashboard' : 'Point of sale')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [help, setHelp] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  useEffect(() => {
    if (role === 'owner')
      void window.dormstore.listShops().then((result) => {
        if (result.ok) setShops(result.data)
      })
  }, [role, shopName, data])
  const refresh = useCallback(async () => {
    if (!window.dormstore)
      throw new Error(
        'Open DormStore through the desktop application. The database bridge is unavailable in a normal web browser.',
      )
    const result = await window.dormstore.snapshot()
    if (!result.ok) throw new Error(result.error)
    setData(result.data)
    setLoadError('')
  }, [])
  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message))
  }, [refresh])
  useEffect(() => {
    let lastDay = new Date().toDateString()
    const timer = setInterval(() => {
      const currentDay = new Date().toDateString()
      if (!lock.current && currentDay !== lastDay) {
        refresh()
          .then(() => {
            lastDay = currentDay
          })
          .catch(() => {})
      }
    }, 60_000)
    return () => clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500)
      return () => clearTimeout(timer)
    }
  }, [toast])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault()
        setPage('Point of sale')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (cart.length) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [cart.length])
  const act = async <T,>(
    op: () => Promise<Result<T>>,
    message?: string,
    reload = true,
  ): Promise<{ value: T } | null> => {
    if (lock.current) return null
    lock.current = true
    setBusy(true)
    try {
      const result = await op()
      if (!result.ok) throw new Error(result.error)
      if (reload) {
        try {
          await refresh()
        } catch (e) {
          setToast({
            text: `Saved, but the screen could not refresh: ${(e as Error).message}`,
            error: true,
          })
          return { value: result.data }
        }
      }
      if (message) setToast({ text: message })
      return { value: result.data }
    } catch (e) {
      setToast({ text: (e as Error).message, error: true })
      return null
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const performSwitch = async (id: string) => {
    await act(() => window.dormstore.switchShop(id), undefined, false)
  }
  const changeShop = (id: string) => {
    if (id === shopId || busy) return
    if (cart.length) setNextShop(id)
    else void performSwitch(id)
  }
  if (!data)
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-lg px-8 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary text-white">
            <Store size={32} />
          </div>
          <h1 className="text-2xl font-semibold">DormStore</h1>
          {loadError ? (
            <>
              <p role="alert" className="my-5 text-sm text-red-600">
                {loadError}
              </p>
              <Button
                onClick={() => {
                  setLoadError('')
                  refresh().catch((e) => setLoadError(e.message))
                }}
              >
                Try again
              </Button>
            </>
          ) : (
            <p className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
              <LoaderCircle size={16} className="animate-spin" />
              Opening your store…
            </p>
          )}
        </div>
      </div>
    )
  const lowCount = data.products.filter((p) => p.stock <= p.low_stock).length
  return (
    <AppContext.Provider
      value={{ data, busy, act, navigate: setPage, showReceipt: setReceipt, changeShop }}
    >
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-[218px] shrink-0 flex-col border-r bg-white">
          <div className="flex items-center gap-3 px-6 py-8">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
              <Store size={23} strokeWidth={1.7} />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">
                DormStore<span className="text-primary">.</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Your everyday store companion</div>
            </div>
          </div>
          <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3">
            {navigation.map((group) => (
              <div key={group.group}>
                <div className="mb-2 px-3 text-[9px] font-semibold tracking-[.14em] text-muted-foreground/80">
                  {group.group}
                </div>
                <div className="space-y-1">
                  {group.items
                    .filter(
                      (item) =>
                        role === 'owner' ||
                        [
                          'Point of sale',
                          'Products',
                          'Customers',
                          'Sales history',
                          'Settings',
                        ].includes(item.name),
                    )
                    .map((item) => (
                      <button
                        key={item.name}
                        aria-label={item.name}
                        aria-current={page === item.name ? 'page' : undefined}
                        onClick={() => setPage(item.name)}
                        className={cn(
                          'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors',
                          page === item.name
                            ? 'bg-primary/9 font-semibold text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <item.icon size={17} strokeWidth={1.7} />
                        {item.name}
                        {item.name === 'Inventory' && lowCount > 0 && (
                          <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            {lowCount}
                          </span>
                        )}
                        {item.name === 'Point of sale' && (
                          <span className="ml-auto text-[9px] opacity-50">F2</span>
                        )}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto p-4">
            <div className="rounded-xl border bg-[#f8faf9] p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Local & offline
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Your store data stays on this computer.
              </p>
            </div>
            <button
              onClick={() => setHelp(true)}
              className="mt-4 flex w-full items-center gap-2 px-2 text-xs text-muted-foreground"
            >
              <CircleHelp size={15} />
              Quick start guide
              <ChevronRight className="ml-auto" size={14} />
            </button>
            <button
              aria-label="Lock store"
              disabled={busy}
              onClick={() => (cart.length ? setConfirmLock(true) : void lockStore())}
              className="mt-4 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-50"
            >
              <LockKeyhole size={15} />
              Lock store<span className="ml-auto max-w-20 truncate text-[10px]">{username}</span>
            </button>
          </div>
          <div className="flex items-center gap-3 border-t px-5 py-4">
            <div className="flex size-8 items-center justify-center rounded-full bg-[#e9efeb] text-xs font-semibold text-primary">
              {displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{displayName}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {role === 'owner' ? 'Owner' : 'Staff'} workspace
              </p>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[70px] shrink-0 items-center justify-between border-b bg-white px-8">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Workspace</span>
              <ChevronRight size={12} className="text-muted-foreground" />
              <span className="font-medium">{page}</span>
            </div>
            <div className="flex items-center gap-5">
              {role === 'owner' ? (
                <select
                  aria-label="Active shop"
                  className="input max-w-52 text-xs"
                  value={shopId}
                  disabled={busy}
                  onChange={(event) => changeShop(event.target.value)}
                >
                  {shops.length ? (
                    shops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.name}
                      </option>
                    ))
                  ) : (
                    <option value={shopId}>{shopName}</option>
                  )}
                </select>
              ) : (
                <span className="max-w-52 truncate text-xs font-medium text-primary">
                  {shopName}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date().toLocaleDateString('en-PH', {
                  weekday: 'short',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span className="flex items-center gap-1.5 border-l pl-5 text-[11px] text-primary">
                <WifiOff size={13} />
                Offline ready
              </span>
              <button
                aria-label="Refresh store data"
                disabled={busy}
                onClick={() => act(() => window.dormstore.snapshot(), 'Store data refreshed')}
                className="text-muted-foreground hover:text-primary"
              >
                <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
              </button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto px-8 py-7">
            {page === 'Dashboard' && <Dashboard />}
            {page === 'Point of sale' && <POS cart={cart} setCart={setCart} />}
            {(page === 'Products' || page === 'Inventory') && (
              <Products key={page} inventory={page === 'Inventory'} />
            )}
            {page === 'Customers' && <Customers />}
            {page === 'Sales history' && <Sales />}
            {page === 'Expenses' && <Expenses />}
            {page === 'Reports' && <Reports />}
            {page === 'Settings' && <Settings onRestore={() => setCart([])} />}
            {page === 'Accounts' && role === 'owner' && <Accounts />}
            {page === 'Shops' && role === 'owner' && <Shops />}
          </main>
          <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-white px-8 text-[10px] text-muted-foreground">
            <span>{data.settings.store_name} · Management System</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-primary" />
              All changes saved locally <span className="ml-3 text-slate-400">v1.4.0</span>
            </span>
          </footer>
        </div>
        {toast && (
          <div
            role={toast.error ? 'alert' : 'status'}
            className={cn(
              'fixed right-6 bottom-12 z-[60] flex max-w-lg items-start gap-3 rounded-xl border bg-white px-5 py-4 shadow-lg',
              toast.error && 'border-red-200',
            )}
          >
            <span className={toast.error ? 'text-red-600' : 'text-primary'}>
              {toast.error ? <X size={18} /> : <Check size={18} />}
            </span>
            <p className="text-sm leading-relaxed">{toast.text}</p>
            <button onClick={() => setToast(null)} aria-label="Dismiss notification">
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        )}
        {confirmLock && (
          <Modal
            title="Lock your store?"
            description="Your unfinished cart will be cleared. Completed sales and saved records are kept."
            onClose={() => setConfirmLock(false)}
          >
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmLock(false)}>
                Keep working
              </Button>
              <Button onClick={() => void lockStore()}>Lock and clear cart</Button>
            </div>
          </Modal>
        )}
        {nextShop && (
          <Modal
            title="Switch shop and clear this cart?"
            description="The unfinished cart will be discarded. Saved records remain in their own shop."
            onClose={() => setNextShop(null)}
          >
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNextShop(null)}>
                Keep working
              </Button>
              <Button disabled={busy} onClick={() => void performSwitch(nextShop)}>
                Switch shop
              </Button>
            </div>
          </Modal>
        )}
        {receipt && (
          <Modal
            title={receipt.sale.status === 'voided' ? 'Voided transaction' : 'Sale receipt'}
            description={receipt.sale.receipt}
            onClose={() => setReceipt(null)}
          >
            <div className="rounded-xl border border-dashed p-5">
              <div className="text-center">
                <h3 className="text-lg font-semibold">{receipt.settings.store_name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{receipt.settings.address}</p>
                <p className="mt-2 text-xs">
                  {dateTime(receipt.sale.created_at)} · {receipt.sale.customer_name || 'Walk-in'}
                </p>
              </div>
              <div className="my-5 border-t border-dashed" />
              {receipt.items.map((i) => (
                <div key={i.id} className="mb-3 flex justify-between gap-5 text-sm">
                  <div>
                    {i.name}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {i.quantity} × {money(i.price)}
                    </div>
                  </div>
                  <span className="tabular-nums">{money(i.price * i.quantity)}</span>
                </div>
              ))}
              <div className="my-4 border-t border-dashed" />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>{money(receipt.sale.total)}</span>
              </div>
              {[
                ['Paid', receipt.sale.paid],
                ['Received', receipt.sale.tendered],
                ['Change', receipt.sale.change_amount],
                ['Added to customer credit', receipt.sale.total - receipt.sale.paid],
              ].map(([label, value]) => (
                <div key={label} className="mt-2 flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span>{money(Number(value))}</span>
                </div>
              ))}
              <p className="mt-6 text-center text-xs text-muted-foreground">
                {receipt.settings.receipt_footer}
              </p>
              <p className="mt-3 text-center text-[10px] text-muted-foreground">
                Store transaction record · Not a BIR tax invoice
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReceipt(null)}>
                Close
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  act(() => window.dormstore.printReceipt(receipt.sale.id), undefined, false)
                }
              >
                Print receipt
              </Button>
            </div>
          </Modal>
        )}
        {help && (
          <Modal
            title="A little store, all sorted."
            description="Get your workspace ready in a few minutes."
            onClose={() => setHelp(false)}
          >
            <ol className="space-y-5 text-sm leading-relaxed">
              {[
                [
                  'Set up your store',
                  'Open Settings to add your store name, owner details and receipt message.',
                ],
                [
                  'Build your catalog',
                  'Add products with cost, selling price and opening stock. A starter catalog is available in Settings; review its example prices and restock before selling.',
                ],
                [
                  'Make your first sale',
                  'Press F2 to open checkout. Search a product or scan its barcode, enter payment, and complete the sale.',
                ],
                [
                  'Keep customer credit clear',
                  'Create a customer and set a credit limit before recording a credit sale. Record repayments from Customers.',
                ],
                [
                  'Protect your records',
                  'An automatic backup is made on startup each day. Regularly save an extra backup to a USB drive from Settings.',
                ],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Button className="mt-7 w-full" onClick={() => setHelp(false)}>
              Got it, let’s get started
            </Button>
          </Modal>
        )}
      </div>
    </AppContext.Provider>
  )
}
