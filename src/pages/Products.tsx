import { useState } from 'react'
import { Plus, Pencil, Archive, ArrowDownUp, Package, Boxes, History } from 'lucide-react'
import { categories, type Product } from '../../shared/contracts'
import { useStore } from '../context'
import { useOwner } from '../components/AuthGate'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import {
  Badge,
  DataForm,
  Empty,
  Field,
  FormActions,
  Input,
  PageTitle,
  Pagination,
  SearchBox,
} from '../components/common'
import { cents, cn, dateTime, money } from '../lib/utils'

export default function Products({ inventory }: { inventory: boolean }) {
  const owner = useOwner().role === 'owner'
  const { data, busy, act } = useStore()
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [status, setStatus] = useState('all')
  const [editing, setEditing] = useState<Product | 'new' | null>(null),
    [adjusting, setAdjusting] = useState<Product | null>(null),
    [archiving, setArchiving] = useState<Product | null>(null)
  const [tab, setTab] = useState('products'),
    [page, setPage] = useState(0)
  const products = data.products.filter(
    (p) =>
      `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(search.toLowerCase()) &&
      (category === 'all' || p.category === category) &&
      (status === 'all' || (status === 'out' ? p.stock === 0 : p.stock <= p.low_stock)),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(products.length / 20) - 1))
  const stockValue = data.products.reduce((sum, p) => sum + p.cost * p.stock, 0)
  return (
    <>
      <PageTitle
        title={inventory ? 'Inventory' : 'Products'}
        subtitle={
          inventory
            ? 'A clear view of what’s in stock, and what needs a refill.'
            : 'All your everyday essentials, neatly organized.'
        }
      >
        {owner && (
          <Button onClick={() => setEditing('new')}>
            <Plus />
            Add product
          </Button>
        )}
      </PageTitle>
      {inventory && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          {[
            ['Stock value at cost', money(stockValue)],
            [
              'Total units on hand',
              data.products.reduce((n, p) => n + p.stock, 0).toLocaleString(),
            ],
            [
              'Needs restocking',
              String(data.products.filter((p) => p.stock <= p.low_stock).length),
            ],
          ].map(([label, value]) => (
            <div key={label} className="panel p-5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {inventory && (
        <div className="mb-5 flex gap-2">
          {[
            ['products', 'Stock levels', Boxes],
            ['history', 'Movement history', History],
          ].map(([key, label, Icon]) => {
            const Component = Icon as typeof Boxes
            return (
              <Button
                key={String(key)}
                variant={tab === key ? 'default' : 'outline'}
                onClick={() => setTab(String(key))}
              >
                <Component />
                {String(label)}
              </Button>
            )
          })}
        </div>
      )}
      {tab === 'history' ? (
        <section className="panel">
          {data.movements.length ? (
            <>
              <div className="border-b px-5 py-4 text-xs text-muted-foreground">
                Latest 300 stock movements · sales, restocks and adjustments
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Movement</th>
                    <th>Quantity</th>
                    <th>Reference / note</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.product_name}</td>
                      <td>{m.reason}</td>
                      <td>
                        <Badge tone={m.quantity > 0 ? 'green' : 'red'}>
                          {m.quantity > 0 ? '+' : ''}
                          {m.quantity}
                        </Badge>
                      </td>
                      <td className="max-w-[260px] break-words text-xs text-muted-foreground">
                        {m.reference || '—'}
                      </td>
                      <td className="text-xs text-muted-foreground">{dateTime(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <Empty
              title="No stock movements yet"
              text="Restock a product or make a sale to start your inventory history."
            />
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="flex items-center gap-3 border-b p-5">
            <div className="max-w-sm flex-1">
              <SearchBox
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(0)
                }}
                placeholder="Search name, SKU or barcode…"
              />
            </div>
            <select
              aria-label="Category filter"
              className="input w-auto"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                setPage(0)
              }}
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Stock filter"
              className="input w-auto"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(0)
              }}
            >
              <option value="all">All stock levels</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
            <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
              {products.length} products
            </span>
          </div>
          {products.length ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    {owner && <th className="text-right">Cost</th>}
                    <th className="text-right">Selling price</th>
                    <th>Stock</th>
                    {owner && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {products.slice(currentPage * 20, (currentPage + 1) * 20).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary/60">
                            <Package size={17} />
                          </div>
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {p.sku} · {p.unit}
                              {p.barcode ? ` · ${p.barcode}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="text-xs text-muted-foreground">{p.category}</td>
                      {owner && <td className="text-right tabular-nums">{money(p.cost)}</td>}
                      <td className="text-right font-medium tabular-nums">{money(p.price)}</td>
                      <td>
                        <Badge
                          tone={p.stock === 0 ? 'red' : p.stock <= p.low_stock ? 'amber' : 'green'}
                        >
                          {p.stock} {p.unit}
                          {p.stock <= p.low_stock ? ' · Low' : ''}
                        </Badge>
                      </td>
                      {owner && (
                        <td>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Adjust stock"
                              aria-label={`Adjust stock for ${p.name}`}
                              onClick={() => setAdjusting(p)}
                            >
                              <ArrowDownUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit product"
                              aria-label={`Edit ${p.name}`}
                              onClick={() => setEditing(p)}
                            >
                              <Pencil />
                            </Button>
                            {!inventory && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Archive product"
                                aria-label={`Archive ${p.name}`}
                                onClick={() => setArchiving(p)}
                              >
                                <Archive />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={currentPage} count={products.length} size={20} onChange={setPage} />
            </>
          ) : (
            <Empty
              title={
                data.products.length ? 'No matching products' : 'Make room for your first product'
              }
              text={
                data.products.length
                  ? 'Try another search or category.'
                  : 'Add a product with its cost, selling price and opening stock.'
              }
              action={
                owner &&
                !data.products.length && (
                  <Button onClick={() => setEditing('new')}>
                    <Plus />
                    Add product
                  </Button>
                )
              }
            />
          )}
        </section>
      )}
      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {adjusting && <StockForm product={adjusting} onClose={() => setAdjusting(null)} />}
      {archiving && (
        <Modal
          title="Archive product?"
          description="The product will be removed from checkout. Its sales and stock history stay in your records."
          onClose={() => !busy && setArchiving(null)}
        >
          <p className="text-sm">{archiving.name}</p>
          {archiving.stock > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              Adjust its {archiving.stock} remaining units to zero before archiving.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || archiving.stock > 0}
              onClick={async () => {
                if (
                  await act(() => window.dormstore.archiveProduct(archiving.id), 'Product archived')
                )
                  setArchiving(null)
              }}
            >
              Archive product
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
function ProductForm({ product: p, onClose }: { product?: Product; onClose: () => void }) {
  const { busy, act } = useStore()
  return (
    <Modal
      title={p ? 'Edit product' : 'Add a product'}
      description="Keep prices in Philippine pesos. Stock changes are recorded in your inventory history."
      onClose={() => !busy && onClose()}
      wide
    >
      <DataForm
        busy={busy}
        onSave={async (f) => {
          const result = await act(
            () =>
              window.dormstore.saveProduct({
                id: p?.id,
                name: f.get('name'),
                sku: f.get('sku'),
                barcode: f.get('barcode') || null,
                category: f.get('category'),
                price: cents(f.get('price')),
                cost: cents(f.get('cost')),
                stock: p?.stock ?? Number(f.get('stock')),
                low_stock: Number(f.get('low_stock')),
                unit: f.get('unit'),
              }),
            p ? 'Product updated' : 'Product added',
          )
          if (result) onClose()
        }}
      >
        <div className="grid grid-cols-2 gap-5">
          <div className="col-span-2">
            <Field label="Product name">
              <Input
                name="name"
                required
                maxLength={120}
                autoFocus
                defaultValue={p?.name}
                placeholder="e.g. Lucky Me Pancit Canton"
              />
            </Field>
          </div>
          <Field label="SKU">
            <Input
              name="sku"
              required
              maxLength={60}
              defaultValue={p?.sku}
              placeholder="e.g. ND-001"
            />
          </Field>
          <Field label="Barcode (optional)">
            <Input
              name="barcode"
              maxLength={80}
              defaultValue={p?.barcode || ''}
              placeholder="Scan or enter barcode"
            />
          </Field>
          <Field label="Category">
            <select className="input" name="category" defaultValue={p?.category || categories[0]}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <Input name="unit" required maxLength={30} defaultValue={p?.unit || 'pc'} />
          </Field>
          <Field label="Cost price (₱)">
            <Input
              name="cost"
              type="number"
              step="0.01"
              min="0"
              max="1000000"
              required
              defaultValue={p ? (p.cost / 100).toFixed(2) : ''}
              placeholder="0.00"
            />
          </Field>
          <Field label="Selling price (₱)">
            <Input
              name="price"
              type="number"
              step="0.01"
              min="0"
              max="1000000"
              required
              defaultValue={p ? (p.price / 100).toFixed(2) : ''}
              placeholder="0.00"
            />
          </Field>
          <Field
            label={p ? 'Current stock' : 'Opening stock'}
            hint={p ? 'Use Adjust stock to change this quantity.' : undefined}
          >
            <Input
              name="stock"
              type="number"
              min="0"
              max="1000000"
              required
              disabled={!!p}
              defaultValue={p?.stock ?? 0}
            />
          </Field>
          <Field label="Low-stock threshold">
            <Input
              name="low_stock"
              type="number"
              min="0"
              max="1000000"
              required
              defaultValue={p?.low_stock ?? 5}
            />
          </Field>
        </div>
        <FormActions busy={busy} onClose={onClose} label={p ? 'Save product' : 'Add product'} />
      </DataForm>
    </Modal>
  )
}
function StockForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const { busy, act } = useStore()
  const [reason, setReason] = useState('Restock'),
    [direction, setDirection] = useState('add'),
    [quantity, setQuantity] = useState('1')
  const sign = reason === 'Restock' || (reason === 'Correction' && direction === 'add') ? 1 : -1
  const next = product.stock + sign * Number(quantity)
  return (
    <Modal title="Adjust stock" description={product.name} onClose={() => !busy && onClose()}>
      <DataForm
        busy={busy}
        onSave={async (f) => {
          if (
            await act(
              () =>
                window.dormstore.adjustStock({
                  product_id: product.id,
                  quantity: sign * Number(quantity),
                  reason,
                  notes: String(f.get('notes')),
                }),
              'Stock updated',
            )
          )
            onClose()
        }}
      >
        <div className="mb-5 flex justify-between rounded-lg bg-muted p-4 text-sm">
          <span>Current stock</span>
          <strong>
            {product.stock} {product.unit}
          </strong>
        </div>
        <div className="space-y-5">
          <Field label="Reason">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {['Restock', 'Damaged', 'Expired', 'Correction', 'Personal use'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          {reason === 'Correction' && (
            <Field label="Direction">
              <select
                className="input"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="add">Add stock</option>
                <option value="remove">Remove stock</option>
              </select>
            </Field>
          )}
          <Field label="Quantity">
            <Input
              type="number"
              required
              min="1"
              max="1000000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Note / supplier reference">
            <Input name="notes" maxLength={500} placeholder="e.g. Weekly delivery" />
          </Field>
          <div
            className={cn(
              'flex justify-between text-sm',
              next < 0 ? 'text-red-600' : 'text-primary',
            )}
          >
            <span>Stock after adjustment</span>
            <strong>
              {next} {product.unit}
            </strong>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Restocking changes inventory quantity. Product cost is used when goods are sold; enter
            operating costs in Expenses.
          </p>
        </div>
        <FormActions busy={busy} onClose={onClose} label="Record adjustment" />
      </DataForm>
    </Modal>
  )
}
