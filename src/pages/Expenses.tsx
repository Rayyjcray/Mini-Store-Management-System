import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { Expense } from '../../shared/contracts'
import { useStore } from '../context'
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
import { cents, day, money } from '../lib/utils'
export default function Expenses() {
  const { data, busy, act } = useStore()
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Expense | 'new' | null>(null),
    [deleting, setDeleting] = useState<Expense | null>(null),
    [page, setPage] = useState(0)
  const expenses = data.expenses.filter((e) =>
    `${e.description} ${e.category}`.toLowerCase().includes(search.toLowerCase()),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(expenses.length / 20) - 1))
  const month = day().slice(0, 7),
    monthTotal = data.expenses
      .filter((e) => e.date.startsWith(month))
      .reduce((sum, e) => sum + e.amount, 0)
  return (
    <>
      <PageTitle title="Expenses" subtitle="Small costs add up. Give every peso a place.">
        <Button onClick={() => setEditing('new')}>
          <Plus />
          Record expense
        </Button>
      </PageTitle>
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          ['This month’s expenses', money(monthTotal)],
          ['Today’s expenses', money(data.today.expenses)],
          ['Recorded expenses', String(data.expenses.length)],
        ].map(([label, value]) => (
          <div key={label} className="panel p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="flex items-center justify-between border-b p-5">
          <div className="w-80">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(0)
              }}
              placeholder="Search expense or category…"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Operating costs · inventory cost is counted when sold
          </p>
        </div>
        {expenses.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.slice(currentPage * 20, (currentPage + 1) * 20).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="font-medium">{e.description}</div>
                      {e.notes && (
                        <p className="mt-1 max-w-[400px] truncate text-[10px] text-muted-foreground">
                          {e.notes}
                        </p>
                      )}
                    </td>
                    <td>
                      <Badge>{e.category}</Badge>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(`${e.date}T12:00:00`).toLocaleDateString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="text-right font-medium tabular-nums">{money(e.amount)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${e.description}`}
                          onClick={() => setEditing(e)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${e.description}`}
                          onClick={() => setDeleting(e)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={currentPage} count={expenses.length} size={20} onChange={setPage} />
          </>
        ) : (
          <Empty
            title="A clean expense book"
            text="Record rent, utilities, transport and other operating costs to see your store’s net profit."
          />
        )}
      </div>
      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Modal
          title="Delete expense?"
          description="The expense will be removed from your totals. The deletion is retained in the local audit log."
          onClose={() => !busy && setDeleting(null)}
        >
          <div className="flex justify-between rounded-lg bg-muted p-4 text-sm">
            <span>{deleting.description}</span>
            <strong>{money(deleting.amount)}</strong>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await act(() => window.dormstore.deleteExpense(deleting.id), 'Expense deleted'))
                  setDeleting(null)
              }}
            >
              Delete expense
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
function ExpenseForm({ expense: e, onClose }: { expense?: Expense; onClose: () => void }) {
  const { busy, act } = useStore()
  return (
    <Modal
      title={e ? 'Edit expense' : 'Record an expense'}
      description="Record operating costs here. Product purchases are reflected in cost of goods sold, so avoid counting them twice."
      onClose={() => !busy && onClose()}
    >
      <DataForm
        busy={busy}
        onSave={async (f) => {
          if (
            await act(
              () =>
                window.dormstore.saveExpense({
                  id: e?.id,
                  description: f.get('description'),
                  category: f.get('category'),
                  amount: cents(f.get('amount')),
                  date: f.get('date'),
                  notes: f.get('notes'),
                }),
              'Expense saved',
            )
          )
            onClose()
        }}
      >
        <div className="space-y-5">
          <Field label="Description">
            <Input
              name="description"
              required
              maxLength={200}
              autoFocus
              defaultValue={e?.description}
              placeholder="e.g. Store electricity share"
            />
          </Field>
          <Field label="Category">
            <select name="category" className="input" defaultValue={e?.category || 'Utilities'}>
              {['Rent', 'Utilities', 'Transportation', 'Supplies', 'Maintenance', 'Other'].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount (₱)">
              <Input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                max="1000000"
                required
                defaultValue={e ? (e.amount / 100).toFixed(2) : ''}
              />
            </Field>
            <Field label="Date">
              <Input name="date" type="date" required defaultValue={e?.date || day()} />
            </Field>
          </div>
          <Field label="Note / reference">
            <textarea name="notes" className="input" maxLength={1000} defaultValue={e?.notes} />
          </Field>
        </div>
        <FormActions busy={busy} onClose={onClose} label="Save expense" />
      </DataForm>
    </Modal>
  )
}
