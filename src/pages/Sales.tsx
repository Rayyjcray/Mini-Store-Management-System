import { useState } from 'react'
import { ReceiptText, Ban, Eye } from 'lucide-react'
import type { Sale } from '../../shared/contracts'
import { useStore } from '../context'
import { useOwner } from '../components/AuthGate'
import {
  Badge,
  DataForm,
  Empty,
  Field,
  Input,
  PageTitle,
  Pagination,
  SearchBox,
} from '../components/common'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { dateTime, money } from '../lib/utils'
export default function Sales() {
  const owner = useOwner().role === 'owner'
  const { data, busy, act, showReceipt } = useStore()
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(0),
    [voiding, setVoiding] = useState<Sale | null>(null)
  const sales = data.sales.filter(
    (s) =>
      `${s.receipt} ${s.customer_name || 'Walk-in'}`.toLowerCase().includes(search.toLowerCase()) &&
      (status === 'all' || s.status === status),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sales.length / 20) - 1))
  return (
    <>
      <PageTitle
        title="Sales history"
        subtitle="Every transaction, with the details that matter."
      />
      <div className="panel">
        <div className="flex items-center gap-3 border-b p-5">
          <div className="w-80">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(0)
              }}
              placeholder="Search receipt or customer…"
            />
          </div>
          <select
            aria-label="Sale status"
            className="input w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
            }}
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </select>
          <p className="ml-auto text-[11px] text-muted-foreground">
            Latest 500 sales · full totals in Reports
          </p>
        </div>
        {sales.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer / date</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Credit at sale</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(currentPage * 20, (currentPage + 1) * 20).map((s) => (
                  <tr key={s.id}>
                    <td className="text-xs font-medium">{s.receipt}</td>
                    <td>
                      <div className="text-xs">{s.customer_name || 'Walk-in customer'}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {dateTime(s.created_at)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={s.payment_method === 'credit' ? 'amber' : 'neutral'}>
                        {s.payment_method === 'gcash' ? 'GCash' : s.payment_method}
                      </Badge>
                    </td>
                    <td className="text-right font-medium tabular-nums">{money(s.total)}</td>
                    <td className="text-right tabular-nums text-muted-foreground">
                      {money(s.total - s.paid)}
                    </td>
                    <td>
                      <Badge tone={s.status === 'voided' ? 'red' : 'green'}>
                        {s.status === 'voided' ? 'Voided' : 'Completed'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`View receipt ${s.receipt}`}
                          title="View receipt"
                          disabled={busy}
                          onClick={async () => {
                            const r = await act(
                              () => window.dormstore.receipt(s.id),
                              undefined,
                              false,
                            )
                            if (r) showReceipt(r.value)
                          }}
                        >
                          <Eye />
                        </Button>
                        {owner && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Void sale ${s.receipt}`}
                            title="Void sale"
                            disabled={busy || s.status === 'voided'}
                            onClick={() => setVoiding(s)}
                          >
                            <Ban />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={currentPage} count={sales.length} size={20} onChange={setPage} />
          </>
        ) : (
          <Empty
            title="A fresh sales book"
            text="Complete your first checkout to see its receipt, payment details and totals here."
            action={<ReceiptText className="text-primary/40" size={24} />}
          />
        )}
      </div>
      {voiding && (
        <Modal
          title="Void this sale?"
          description={voiding.receipt}
          onClose={() => !busy && setVoiding(null)}
        >
          <div className="mb-5 rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
            This returns all items to stock, reverses the credit created by this sale, and removes
            the sale from reports. Only void a sale when all goods have been returned.
            <p className="mt-3 font-semibold">
              Refund {money(voiding.paid)} to the customer separately. DormStore cannot send cash or
              GCash refunds.
            </p>
          </div>
          <DataForm
            busy={busy}
            onSave={async (f) => {
              if (
                await act(
                  () => window.dormstore.voidSale({ id: voiding.id, reason: f.get('reason') }),
                  'Sale voided. Return the paid amount to the customer.',
                )
              )
                setVoiding(null)
            }}
          >
            <Field label="Reason for voiding">
              <Input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                autoFocus
                placeholder="e.g. Entire purchase returned"
              />
            </Field>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setVoiding(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                Void sale
              </Button>
            </div>
          </DataForm>
        </Modal>
      )}
    </>
  )
}
