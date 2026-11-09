import { useState } from 'react'
import { Plus, Users, Pencil, ArrowDownLeft, BookOpen } from 'lucide-react'
import type { Customer, CustomerAccount } from '../../shared/contracts'
import { useStore } from '../context'
import { useOwner } from '../components/AuthGate'
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
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { cents, dateTime, money } from '../lib/utils'
export default function Customers() {
  const owner = useOwner().role === 'owner'
  const { data, busy, act } = useStore()
  const [search, setSearch] = useState(''),
    [onlyDebt, setOnlyDebt] = useState(false),
    [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null),
    [repaying, setRepaying] = useState<Customer | null>(null),
    [account, setAccount] = useState<CustomerAccount | null>(null)
  const customers = data.customers.filter(
    (c) =>
      `${c.name} ${c.room} ${c.phone}`.toLowerCase().includes(search.toLowerCase()) &&
      (!onlyDebt || c.balance > 0),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(customers.length / 20) - 1))
  return (
    <>
      <PageTitle
        title="Customers & credit"
        subtitle="A familiar face, a clear account. Keep every balance in view."
      >
        {owner && (
          <Button onClick={() => setEditing('new')}>
            <Plus />
            Add customer
          </Button>
        )}
      </PageTitle>
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          ['Total customers', String(data.customers.length)],
          ['Outstanding credit', money(data.totalDebt)],
          ['With an open balance', String(data.customers.filter((c) => c.balance > 0).length)],
        ].map(([label, value]) => (
          <div key={label} className="panel p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="flex items-center justify-between border-b p-5">
          <div className="w-80">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(0)
              }}
              placeholder="Search name, room or phone…"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyDebt}
              onChange={(e) => {
                setOnlyDebt(e.target.checked)
                setPage(0)
              }}
              className="accent-primary"
            />
            Only outstanding balances
          </label>
        </div>
        {customers.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Room / contact</th>
                  <th className="text-right">Credit limit</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.slice(currentPage * 20, (currentPage + 1) * 20).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/7 text-xs font-semibold text-primary">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{c.name}</p>
                          {c.notes && (
                            <p className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground">
                              {c.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="text-xs">{c.room || '—'}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {c.phone || 'No phone'}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{money(c.credit_limit)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(c.balance)}</td>
                    <td>
                      <Badge tone={c.balance > 0 ? 'amber' : 'green'}>
                        {c.balance > 0 ? 'Open balance' : 'Settled'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`View account for ${c.name}`}
                          title="Account ledger"
                          disabled={busy}
                          onClick={async () => {
                            const result = await act(
                              () => window.dormstore.customerAccount(c.id),
                              undefined,
                              false,
                            )
                            if (result) setAccount(result.value)
                          }}
                        >
                          <BookOpen />
                        </Button>
                        {owner && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${c.name}`}
                            title="Edit customer"
                            onClick={() => setEditing(c)}
                          >
                            <Pencil />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!c.balance || busy}
                          onClick={() => setRepaying(c)}
                        >
                          <ArrowDownLeft />
                          Payment
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={currentPage} count={customers.length} size={20} onChange={setPage} />
          </>
        ) : (
          <Empty
            title={data.customers.length ? 'No matching customers' : 'Know your regulars'}
            text="Add customers to track purchases on credit and record their repayments."
            action={
              owner &&
              !data.customers.length && (
                <Button onClick={() => setEditing('new')}>
                  <Users />
                  Add customer
                </Button>
              )
            }
          />
        )}
      </section>
      {editing && (
        <CustomerForm
          customer={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {repaying && (
        <Modal
          title="Record a repayment"
          description={`${repaying.name} · Outstanding ${money(repaying.balance)}`}
          onClose={() => !busy && setRepaying(null)}
        >
          <DataForm
            busy={busy}
            onSave={async (f) => {
              if (
                await act(
                  () =>
                    window.dormstore.repay({
                      customer_id: repaying.id,
                      amount: cents(f.get('amount')),
                      method: f.get('method'),
                      notes: f.get('notes'),
                    }),
                  'Repayment recorded',
                )
              )
                setRepaying(null)
            }}
          >
            <div className="space-y-5">
              <Field label="Amount received (₱)">
                <Input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={repaying.balance / 100}
                  required
                  autoFocus
                  defaultValue={(repaying.balance / 100).toFixed(2)}
                />
              </Field>
              <Field label="Payment method">
                <select name="method" className="input">
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                </select>
              </Field>
              <Field label="Note / reference">
                <Input name="notes" maxLength={500} placeholder="Optional payment reference" />
              </Field>
            </div>
            <FormActions busy={busy} onClose={() => setRepaying(null)} label="Record payment" />
          </DataForm>
        </Modal>
      )}
      {account && (
        <Modal
          title={`${account.customer.name}’s account`}
          description={`${account.customer.room || 'Customer account'} · Credit limit ${money(account.customer.credit_limit)}`}
          onClose={() => setAccount(null)}
          wide
        >
          <div className="mb-5 flex items-center justify-between rounded-xl bg-primary/5 p-5">
            <span className="text-sm text-muted-foreground">Outstanding balance</span>
            <strong className="text-2xl text-primary">{money(account.customer.balance)}</strong>
          </div>
          {account.ledger.length ? (
            <div className="overflow-hidden rounded-lg border">
              <table>
                <thead>
                  <tr>
                    <th>Date / note</th>
                    <th>Entry</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {account.ledger.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <p className="text-xs">{dateTime(l.created_at)}</p>
                        <p className="mt-1 max-w-[300px] break-words text-[10px] text-muted-foreground">
                          {l.notes}
                        </p>
                      </td>
                      <td>
                        <Badge tone={l.amount > 0 ? 'amber' : 'green'}>
                          {l.type.replaceAll('_', ' ')}
                        </Badge>
                      </td>
                      <td className="text-right font-medium">
                        {l.amount > 0 ? '+' : '−'}
                        {money(Math.abs(l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="A fresh account"
              text="Credit purchases and repayments will appear in this ledger."
            />
          )}
        </Modal>
      )}
    </>
  )
}
function CustomerForm({ customer: c, onClose }: { customer?: Customer; onClose: () => void }) {
  const { busy, act } = useStore()
  return (
    <Modal
      title={c ? 'Edit customer' : 'Add customer'}
      description="Set a credit limit to allow purchases on account. A zero limit disables new credit."
      onClose={() => !busy && onClose()}
    >
      <DataForm
        busy={busy}
        onSave={async (f) => {
          if (
            await act(
              () =>
                window.dormstore.saveCustomer({
                  id: c?.id,
                  name: f.get('name'),
                  room: f.get('room'),
                  phone: f.get('phone'),
                  credit_limit: cents(f.get('credit_limit')),
                  notes: f.get('notes'),
                }),
              c ? 'Customer updated' : 'Customer added',
            )
          )
            onClose()
        }}
      >
        <div className="space-y-5">
          <Field label="Full name">
            <Input name="name" required maxLength={120} autoFocus defaultValue={c?.name} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Room / dorm">
              <Input name="room" maxLength={50} defaultValue={c?.room} />
            </Field>
            <Field label="Phone number">
              <Input name="phone" maxLength={50} defaultValue={c?.phone} />
            </Field>
          </div>
          <Field label="Credit limit (₱)">
            <Input
              type="number"
              name="credit_limit"
              min={c ? c.balance / 100 : 0}
              step="0.01"
              max="1000000"
              required
              defaultValue={((c?.credit_limit || 0) / 100).toFixed(2)}
            />
          </Field>
          <Field label="Notes">
            <textarea className="input" name="notes" maxLength={1000} defaultValue={c?.notes} />
          </Field>
        </div>
        <FormActions busy={busy} onClose={onClose} label={c ? 'Save customer' : 'Add customer'} />
      </DataForm>
    </Modal>
  )
}
