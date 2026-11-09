import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Banknote,
  CreditCard,
  Minus,
  Plus,
  Search,
  ShoppingBasket,
  Smartphone,
  Trash2,
  X,
  Package,
  CheckCircle2,
} from 'lucide-react'
import { categories } from '../../shared/contracts'
import { useStore } from '../context'
import { Badge, Empty, Field, Input, PageTitle } from '../components/common'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { cents, cn, money } from '../lib/utils'
export interface CartLine {
  product_id: number
  quantity: number
}
export default function POS({
  cart,
  setCart,
}: {
  cart: CartLine[]
  setCart: Dispatch<SetStateAction<CartLine[]>>
}) {
  const { data, busy, act, showReceipt } = useStore()
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all')
  const [customerId, setCustomerId] = useState(''),
    [method, setMethod] = useState<'cash' | 'gcash' | 'credit'>('cash')
  const [received, setReceived] = useState(''),
    [downPayment, setDownPayment] = useState('0'),
    [notes, setNotes] = useState(''),
    [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false),
    [clearing, setClearing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const items = cart.map((line) => ({
    ...line,
    product: data.products.find((p) => p.id === line.product_id),
  }))
  const total = items.reduce((sum, i) => sum + (i.product?.price || 0) * i.quantity, 0)
  const selectedCustomer = data.customers.find((c) => c.id === Number(customerId))
  const receivedAmount = Number(received || 0) * 100,
    downAmount = Number(downPayment || 0) * 100
  const applied = method === 'credit' ? downAmount : total
  const debt = total - applied
  const invalid =
    !cart.length ||
    items.some((i) => !i.product || i.quantity > i.product.stock) ||
    (method === 'cash' && receivedAmount < total) ||
    (method === 'credit' &&
      (!selectedCustomer ||
        debt < 0 ||
        selectedCustomer.balance + debt > selectedCustomer.credit_limit))
  const add = (id: number) => {
    const product = data.products.find((p) => p.id === id)
    if (!product) return
    setError('')
    if ((cart.find((i) => i.product_id === id)?.quantity || 0) >= product.stock) {
      setError(`Only ${product.stock} ${product.unit} available for ${product.name}.`)
      return
    }
    setCart((old) => {
      const existing = old.find((i) => i.product_id === id)
      return existing
        ? old.map((i) => (i.product_id === id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...old, { product_id: id, quantity: 1 }]
    })
  }
  const changeQuantity = (id: number, quantity: number) => {
    if (quantity <= 0) setCart((old) => old.filter((i) => i.product_id !== id))
    else setCart((old) => old.map((i) => (i.product_id === id ? { ...i, quantity } : i)))
  }
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const products = data.products.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <>
      <PageTitle title="Point of sale" subtitle="Everyday essentials. Easy checkouts." />
      <div className="grid grid-cols-[1fr_355px] items-start gap-5">
        <div>
          <form
            className="relative mb-4"
            onSubmit={(e) => {
              e.preventDefault()
              const exact = data.products.find(
                (p) =>
                  p.barcode === search.trim() ||
                  p.sku.toLowerCase() === search.trim().toLowerCase(),
              )
              if (exact) {
                add(exact.id)
                setSearch('')
              } else if (products.length === 1) {
                add(products[0].id)
                setSearch('')
              }
            }}
          >
            <Search size={17} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              ref={searchRef}
              className="input h-11 pl-10"
              aria-label="Search or scan product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products or scan a barcode, then press Enter…"
            />
          </form>
          <div className="mb-5 flex flex-wrap gap-2">
            {['all', ...categories].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-lg border bg-white px-3 py-2 text-[11px] transition-colors',
                  category === c
                    ? 'border-primary bg-primary text-white'
                    : 'text-muted-foreground hover:border-primary/40',
                )}
              >
                {c === 'all' ? 'All products' : c}
              </button>
            ))}
          </div>
          {products.length ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  disabled={!p.stock || busy}
                  onClick={() => add(p.id)}
                  className="group rounded-xl border bg-white p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
                >
                  <div className="mb-5 flex items-start justify-between">
                    <div className="rounded-xl bg-[#f0f5f1] p-3 text-primary/65">
                      <Package size={23} strokeWidth={1.5} />
                    </div>
                    <span
                      className={cn(
                        'text-[10px]',
                        p.stock <= p.low_stock ? 'text-amber-600' : 'text-muted-foreground',
                      )}
                    >
                      {p.stock} in stock
                    </span>
                  </div>
                  <div className="min-h-10 text-xs font-semibold leading-relaxed">{p.name}</div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{p.category}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-semibold text-primary">{money(p.price)}</span>
                    <span className="rounded-md bg-muted p-1 text-primary group-hover:bg-primary group-hover:text-white">
                      <Plus size={15} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title="No products to show"
                text="Add products and opening stock from the Products page, or try another search."
              />
            </div>
          )}
        </div>
        <section className="panel sticky top-0 max-h-[calc(100vh_-_210px)] overflow-y-auto">
          <div className="flex items-center justify-between border-b p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShoppingBasket size={17} />
              Current sale{' '}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({cart.reduce((s, i) => s + i.quantity, 0)})
              </span>
            </h2>
            <button
              disabled={!cart.length || busy}
              className="text-xs text-muted-foreground hover:text-red-600 disabled:opacity-30"
              onClick={() => setClearing(true)}
            >
              Clear
            </button>
          </div>
          <div className="max-h-[310px] overflow-y-auto">
            {items.length ? (
              items.map((i) => (
                <div key={i.product_id} className="border-b px-5 py-4">
                  <div className="flex justify-between gap-3">
                    <div className="text-xs font-medium">
                      {i.product?.name || 'Unavailable product'}
                    </div>
                    <button
                      aria-label="Remove item"
                      disabled={busy}
                      onClick={() => changeQuantity(i.product_id, 0)}
                    >
                      <X size={13} className="text-muted-foreground" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center rounded-md border">
                      <button
                        className="p-1.5"
                        disabled={busy}
                        aria-label="Decrease quantity"
                        onClick={() => changeQuantity(i.product_id, i.quantity - 1)}
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        className="w-10 border-x py-1 text-center text-xs outline-none"
                        type="number"
                        min="1"
                        aria-label={`Quantity for ${i.product?.name}`}
                        value={i.quantity}
                        disabled={busy}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isInteger(n) && n >= 1 && n <= 1000000)
                            changeQuantity(i.product_id, n)
                        }}
                      />
                      <button
                        className="p-1.5"
                        disabled={busy}
                        aria-label="Increase quantity"
                        onClick={() => add(i.product_id)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="text-xs font-medium tabular-nums">
                      {money((i.product?.price || 0) * i.quantity)}
                    </span>
                  </div>
                  {(!i.product || i.quantity > i.product.stock) && (
                    <p className="mt-2 text-[10px] text-red-600">
                      Insufficient stock. Available: {i.product?.stock || 0}.
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="px-5 py-10 text-center">
                <ShoppingBasket size={30} className="mx-auto mb-3 text-slate-300" />
                <p className="text-xs text-muted-foreground">Pick a product to start a sale.</p>
              </div>
            )}
          </div>
          <div className="space-y-4 p-5">
            <Field label="Customer">
              <select
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Walk-in customer</option>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.room ? ` · ${c.room}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center justify-between border-t pt-4">
              <span className="font-medium">Total</span>
              <span className="text-2xl font-semibold tracking-tight">{money(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'cash', label: 'Cash', icon: Banknote },
                { id: 'gcash', label: 'GCash', icon: Smartphone },
                { id: 'credit', label: 'Credit', icon: CreditCard },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMethod(m.id as typeof method)
                    setError('')
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border p-3 text-[11px]',
                    method === m.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  <m.icon size={17} />
                  {m.label}
                </button>
              ))}
            </div>
            {method === 'cash' && (
              <Field label="Cash received (₱)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                />
              </Field>
            )}
            {method === 'gcash' && (
              <p className="rounded-lg bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-700">
                Confirm {money(total)} was received in your GCash account before completing this
                sale.
              </p>
            )}
            {method === 'credit' && (
              <>
                <Field label="Cash down payment (₱)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                  />
                </Field>
                {selectedCustomer ? (
                  <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800">
                    <div className="flex justify-between">
                      <span>Available credit</span>
                      <span>{money(selectedCustomer.credit_limit - selectedCustomer.balance)}</span>
                    </div>
                    <div className="mt-2 flex justify-between">
                      <span>Add to balance</span>
                      <strong>{money(debt)}</strong>
                    </div>
                    {selectedCustomer.balance + debt > selectedCustomer.credit_limit && (
                      <p className="mt-2 text-red-600">This exceeds the credit limit.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">Select a customer with a credit limit.</p>
                )}
              </>
            )}
            {method === 'cash' && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Change</span>
                <strong className="text-primary">
                  {money(Math.max(0, Math.round(receivedAmount - total)))}
                </strong>
              </div>
            )}
            <Input
              placeholder="Sale note (optional)"
              aria-label="Sale note"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
            <Button
              className="h-11 w-full"
              disabled={busy || invalid}
              onClick={() => setConfirming(true)}
            >
              <CheckCircle2 />
              Review sale · {money(total)}
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              Stock updates automatically when you complete the sale.
            </p>
          </div>
        </section>
      </div>
      {confirming && (
        <Modal
          title="Complete this sale?"
          description="Review the payment before saving. A completed sale updates stock and customer credit immediately."
          onClose={() => !busy && setConfirming(false)}
        >
          <div className="space-y-3 rounded-xl bg-muted p-5 text-sm">
            <div className="flex justify-between">
              <span>Customer</span>
              <strong>{selectedCustomer?.name || 'Walk-in'}</strong>
            </div>
            <div className="flex justify-between">
              <span>Payment</span>
              <Badge tone="green">{method === 'gcash' ? 'GCash' : method}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            {method === 'credit' && (
              <div className="flex justify-between">
                <span>New credit</span>
                <strong>{money(Math.round(debt))}</strong>
              </div>
            )}
            {method === 'cash' && (
              <div className="flex justify-between">
                <span>Change to give</span>
                <strong>{money(Math.round(receivedAmount - total))}</strong>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              disabled={busy || invalid}
              onClick={async () => {
                try {
                  const paid = method === 'credit' ? cents(downPayment) : total
                  const tendered = method === 'cash' ? cents(received) : paid
                  const result = await act(
                    () =>
                      window.dormstore.checkout({
                        items: cart,
                        customer_id: customerId ? Number(customerId) : undefined,
                        payment_method: method,
                        paid,
                        tendered,
                        notes,
                      }),
                    'Sale completed',
                  )
                  if (result) {
                    setConfirming(false)
                    setCart([])
                    setReceived('')
                    setDownPayment('0')
                    setNotes('')
                    setCustomerId('')
                    setMethod('cash')
                    showReceipt(result.value)
                  }
                } catch (e) {
                  setError((e as Error).message)
                  setConfirming(false)
                }
              }}
            >
              {busy ? 'Completing…' : 'Complete sale'}
            </Button>
          </div>
        </Modal>
      )}
      {clearing && (
        <Modal
          title="Clear current sale?"
          description="All items in this cart will be removed."
          onClose={() => setClearing(false)}
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClearing(false)}>
              Keep cart
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setCart([])
                setClearing(false)
              }}
            >
              <Trash2 />
              Clear cart
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
