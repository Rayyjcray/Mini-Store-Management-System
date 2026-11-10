import { useCallback, useEffect, useState } from 'react'
import { Plus, Store, ArrowUpRight } from 'lucide-react'
import type { Shop } from '../../shared/contracts'
import { useOwner } from '../components/AuthGate'
import { useStore } from '../context'
import { Badge, DataForm, Field, Input, PageTitle, PasswordInput } from '../components/common'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
export default function Shops() {
  const { shopId } = useOwner(),
    { act, busy, changeShop } = useStore()
  const [shops, setShops] = useState<Shop[]>([]),
    [creating, setCreating] = useState(false),
    [error, setError] = useState('')
  const load = useCallback(async () => {
    const result = await window.dormstore.listShops()
    if (result.ok) setShops(result.data)
    else setError(result.error)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <>
      <PageTitle
        title="My shops"
        subtitle="Separate stores, separate records. Only shops you own appear here."
      >
        <Button disabled={busy} onClick={() => setCreating(true)}>
          <Plus />
          Add shop
        </Button>
      </PageTitle>
      {error && (
        <p role="alert" className="mb-4 text-red-600">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-5 xl:grid-cols-3">
        {shops.map((shop) => (
          <section key={shop.id} className="panel p-6">
            <div className="mb-5 flex items-center justify-between">
              <span className="rounded-xl bg-primary/8 p-3 text-primary">
                <Store size={23} />
              </span>
              {shop.id === shopId && <Badge tone="green">Active shop</Badge>}
            </div>
            <h2 className="text-lg font-semibold">{shop.name}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Products, customers, sales, debts, expenses, reports and backups are kept separately
              for this shop.
            </p>
            <Button
              className="mt-5 w-full"
              variant={shop.id === shopId ? 'outline' : 'default'}
              disabled={busy || shop.id === shopId}
              onClick={() => changeShop(shop.id)}
            >
              Open shop
              <ArrowUpRight />
            </Button>
          </section>
        ))}
      </div>
      <section className="panel mt-6 p-5 text-sm leading-relaxed">
        <h2 className="font-semibold">Different owner, different shops</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          To create an independent owner account, lock the store and choose “Create owner account &
          shop” on the sign-in screen. New owners cannot see or manage your shops. Use Accounts
          inside each shop to add that shop’s staff.
        </p>
      </section>
      {creating && (
        <Modal
          title="Add a private shop"
          description="This new shop belongs to your account and starts with empty records. Confirm your password to continue."
          onClose={() => !busy && setCreating(false)}
        >
          <DataForm
            busy={busy}
            onSave={async (form) => {
              if (
                await act(
                  () =>
                    window.dormstore.createShop({
                      name: form.get('name'),
                      currentPassword: form.get('password'),
                    }),
                  'Shop created',
                )
              ) {
                setCreating(false)
                await load()
              }
            }}
          >
            <div className="space-y-5">
              <Field label="Shop name">
                <Input name="name" required maxLength={120} autoFocus />
              </Field>
              <Field label="Your owner password">
                <PasswordInput
                  name="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Create shop
              </Button>
            </div>
          </DataForm>
        </Modal>
      )}
    </>
  )
}
