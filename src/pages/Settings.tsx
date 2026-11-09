import { useState } from 'react'
import { DatabaseBackup, Download, Upload, PackagePlus, ShieldCheck, HardDrive } from 'lucide-react'
import { useStore } from '../context'
import { DataForm, Field, Input, PageTitle } from '../components/common'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { useOwner } from '../components/AuthGate'
export default function Settings({ onRestore }: { onRestore: () => void }) {
  const { data, busy, act } = useStore()
  const { username, role } = useOwner()
  const owner = role === 'owner'
  const [changingPassword, setChangingPassword] = useState(false)
  const [seed, setSeed] = useState(false)
  const [backupNotice, setBackupNotice] = useState('')
  const s = data.settings
  return (
    <>
      <PageTitle
        title={owner ? 'Store settings' : 'My account'}
        subtitle="Make this workspace yours, and keep your records safe."
      />
      <section className="panel mb-5 flex items-center gap-4 p-5">
        <div className="rounded-xl bg-primary/8 p-3 text-primary">
          <ShieldCheck size={22} />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">{owner ? 'Owner' : 'Staff'} access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Signed in as {username} · Locks after 10 minutes of inactivity or when Windows locks.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => setChangingPassword(true)}>
          Change password
        </Button>
      </section>
      {owner && (
        <div className="grid grid-cols-[1fr_350px] gap-5">
          <section className="panel p-6">
            <h2 className="font-semibold">Store details</h2>
            <p className="mt-1 mb-6 text-xs text-muted-foreground">
              These details appear in the workspace and on printed receipts.
            </p>
            <DataForm
              key={JSON.stringify(s)}
              busy={busy}
              onSave={async (f) => {
                await act(
                  () =>
                    window.dormstore.saveSettings({
                      store_name: String(f.get('store_name')),
                      owner_name: String(f.get('owner_name')),
                      address: String(f.get('address')),
                      receipt_footer: String(f.get('receipt_footer')),
                    }),
                  'Store settings saved',
                )
              }}
            >
              <div className="space-y-5">
                <Field label="Store name">
                  <Input name="store_name" required maxLength={120} defaultValue={s.store_name} />
                </Field>
                <Field label="Owner name">
                  <Input name="owner_name" maxLength={120} defaultValue={s.owner_name} />
                </Field>
                <Field label="Store address / dormitory">
                  <Input name="address" maxLength={250} defaultValue={s.address} />
                </Field>
                <Field label="Receipt message">
                  <textarea
                    name="receipt_footer"
                    className="input"
                    maxLength={250}
                    defaultValue={s.receipt_footer}
                  />
                </Field>
              </div>
              <div className="mt-6 border-t pt-5">
                <Button disabled={busy} type="submit">
                  {busy ? 'Saving…' : 'Save store details'}
                </Button>
              </div>
            </DataForm>
          </section>
          <div className="space-y-5">
            <section className="panel p-5">
              <div className="mb-4 flex items-center gap-2 text-primary">
                <DatabaseBackup size={20} />
                <h2 className="font-semibold text-foreground">Backups & recovery</h2>
              </div>
              <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
                A daily backup is saved on startup. Save another copy to a USB drive or a separate
                disk to protect against computer failure.
              </p>
              <div className="space-y-3">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    const r = await act(() => window.dormstore.backup(), undefined, false)
                    if (r?.value) setBackupNotice(`Backup saved: ${r.value}`)
                  }}
                >
                  <Download />
                  Save a backup
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    const r = await act(() => window.dormstore.restore())
                    if (r?.value) {
                      onRestore()
                      setBackupNotice(
                        'Database restored. Your safety copy is saved beside the active database.',
                      )
                    }
                  }}
                >
                  <Upload />
                  Restore a backup
                </Button>
              </div>
              {backupNotice && (
                <p role="status" className="mt-4 break-all text-xs leading-relaxed text-primary">
                  {backupNotice}
                </p>
              )}
              <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
                Restoring replaces current records after confirmation and saves a safety copy first.
              </p>
            </section>
            <section className="panel p-5">
              <div className="mb-3 flex items-center gap-2">
                <PackagePlus size={19} className="text-primary" />
                <h2 className="font-semibold">A head start for your catalog</h2>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add 24 common sari-sari store essentials. Review the example costs and prices, then
                enter actual stock.
              </p>
              <Button
                className="mt-4 w-full"
                variant="outline"
                disabled={busy || data.products.length > 0}
                onClick={() => setSeed(true)}
              >
                Load starter catalog
              </Button>
              {data.products.length > 0 && (
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Available only when the catalog is empty.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
      {owner && (
        <section className="panel mt-5 flex items-start gap-4 p-5">
          <ShieldCheck className="mt-1 shrink-0 text-primary" size={22} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Local by design</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Your data is stored in SQLite on this computer. Your owner login works without a cloud
              connection or internet. Use a protected Windows account to control direct access to
              store files.
            </p>
            <p className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <HardDrive size={12} />
              <span className="break-all">{data.databasePath}</span>
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              DormStore Management System · Version 1.3.1 · Philippine peso (PHP)
            </p>
          </div>
        </section>
      )}
      {changingPassword && (
        <Modal
          title="Change your password"
          description="Confirm your current password before choosing a new one. Your existing recovery code will continue to work."
          onClose={() => !busy && setChangingPassword(false)}
        >
          <DataForm
            busy={busy}
            onSave={async (form) => {
              if (
                await act(
                  () =>
                    window.dormstore.changePassword({
                      currentPassword: form.get('currentPassword'),
                      password: form.get('password'),
                      confirmPassword: form.get('confirmPassword'),
                    }),
                  'Your password has been changed',
                  false,
                )
              )
                setChangingPassword(false)
            }}
          >
            <div className="space-y-5">
              <Field label="Current password">
                <Input
                  type="password"
                  name="currentPassword"
                  required
                  maxLength={128}
                  autoFocus
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password" hint="Use at least 12 characters.">
                <Input
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  name="confirmPassword"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setChangingPassword(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save new password
              </Button>
            </div>
          </DataForm>
        </Modal>
      )}
      {seed && (
        <Modal
          title="Load the starter catalog?"
          description="This adds 24 products with example prices and zero stock. No sales, customer accounts or debts will be created."
          onClose={() => !busy && setSeed(false)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Check every price and cost against your supplier’s rates before selling. Add your real
            opening quantities through Inventory.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSeed(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (
                  await act(
                    () => window.dormstore.seedCatalog(),
                    'Starter catalog loaded. Review prices and restock before selling.',
                  )
                )
                  setSeed(false)
              }}
            >
              Load 24 products
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
