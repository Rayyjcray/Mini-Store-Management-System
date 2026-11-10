import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import type { SecurityEvent, UserAccount } from '../../shared/contracts'
import { useStore } from '../context'
import { useOwner } from '../components/AuthGate'
import {
  Badge,
  DataForm,
  Empty,
  Field,
  Input,
  PageTitle,
  PasswordInput,
} from '../components/common'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
type Edit = { kind: 'new' } | { kind: 'edit' | 'reset'; account: UserAccount }
const labels: Record<string, string> = {
  'sign_in.succeeded': 'Signed in',
  'sign_in.failed': 'Authentication failed',
  'session.locked': 'Store locked',
  'auth.rate_limited': 'Authentication rate limit reached',
  'account.cooldown': 'Account temporarily locked',
  'account.owner_created': 'First owner created',
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.password_reset': 'Temporary password issued',
  'password.changed': 'Password changed',
  'password.recovered': 'Account recovered',
  'access.denied': 'Permission denied',
  'sale:checkout': 'Sale completed',
  'sale:void': 'Sale voided',
  'stock:adjust': 'Stock adjusted',
  'product:save': 'Product saved',
  'product:archive': 'Product archived',
  'customer:save': 'Customer saved',
  'customer:repay': 'Repayment recorded',
  'expense:save': 'Expense saved',
  'expense:delete': 'Expense deleted',
  'settings:save': 'Store settings changed',
  'catalog:seed': 'Starter catalog loaded',
  'database:backup': 'Backup operation completed',
  'database:restore': 'Restore operation completed',
  'shop.created': 'Shop created',
  'shop.switched': 'Shop opened',
}
export default function Accounts() {
  const { busy, act } = useStore()
  const { userId, shopName } = useOwner()
  const [accounts, setAccounts] = useState<UserAccount[]>([])
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [tab, setTab] = useState<'accounts' | 'security'>('accounts')
  const [edit, setEdit] = useState<Edit | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [users, logs] = await Promise.all([
        window.dormstore.listAccounts(),
        window.dormstore.securityEvents(),
      ])
      if (!users.ok) throw new Error(users.error)
      if (!logs.ok) throw new Error(logs.error)
      setAccounts(users.data)
      setEvents(logs.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <>
      <PageTitle
        title="Accounts & security"
        subtitle={`People and security activity for ${shopName}. Other owners’ accounts are private.`}
      >
        <Button variant="outline" disabled={busy || loading} onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
        <Button disabled={busy} onClick={() => setEdit({ kind: 'new' })}>
          <Plus />
          Add account
        </Button>
      </PageTitle>
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          ['Accounts', accounts.length],
          ['Active owners', accounts.filter((a) => a.active && a.role === 'owner').length],
          ['Active staff', accounts.filter((a) => a.active && a.role === 'staff').length],
        ].map(([label, value]) => (
          <div key={label} className="panel p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mb-5 flex gap-2">
        <Button
          variant={tab === 'accounts' ? 'default' : 'outline'}
          onClick={() => setTab('accounts')}
        >
          <Users />
          Accounts
        </Button>
        <Button
          variant={tab === 'security' ? 'default' : 'outline'}
          onClick={() => setTab('security')}
        >
          <ShieldCheck />
          Security activity
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && (
        <p className="mb-4 text-xs text-muted-foreground">Loading accounts and activity…</p>
      )}
      {tab === 'accounts' ? (
        <>
          <section className="panel">
            <table>
              <thead>
                <tr>
                  <th>Person / username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Sign-in protection</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <p className="font-medium">
                        {account.display_name}
                        {account.id === userId ? ' (you)' : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{account.username}</p>
                    </td>
                    <td>
                      <Badge tone={account.role === 'owner' ? 'green' : 'neutral'}>
                        {account.role === 'owner' ? 'Owner' : 'Staff'}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={account.active ? 'green' : 'red'}>
                        {account.active ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                    <td>
                      <div className="space-y-1">
                        {account.locked_until > Date.now() ? (
                          <Badge tone="amber">
                            Cooldown until {new Date(account.locked_until).toLocaleTimeString()}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {account.failures
                              ? `${account.failures} failed attempts`
                              : 'Ready to sign in'}
                          </span>
                        )}
                        {!!account.must_change_password && (
                          <p className="text-[11px] text-amber-700">
                            Must change temporary password
                          </p>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setEdit({ kind: 'edit', account })}
                        >
                          <Pencil />
                          Manage
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || account.id === userId}
                          onClick={() => setEdit({ kind: 'reset', account })}
                        >
                          <KeyRound />
                          Reset password
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel mt-5 p-5">
            <h2 className="font-semibold">Access by role</h2>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Owner:</strong> full store access, accounts,
              financial reports, stock changes, credit limits, expenses, backups and security
              activity.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Staff:</strong> checkout, selling prices and stock
              lookup, customer balances and repayments, shared sales/receipt lookup, and personal
              password changes. Product costs, profits, expenses and database files are withheld.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Staff added here can only access this shop. A different owner registers a private shop
              from the sign-in screen. Use My shops to switch between shops you own.
            </p>
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="border-b px-5 py-4 text-xs text-muted-foreground">
            Latest 300 events · up to 5,000 retained locally · passwords and recovery codes are
            never logged
          </div>
          {events.length ? (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Account</th>
                  <th>Activity</th>
                  <th>Target / details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString('en-PH')}
                    </td>
                    <td className="text-xs font-medium">{event.actor || 'Not signed in'}</td>
                    <td className="text-xs">
                      {labels[event.action] || event.action.replace(/[:._]/g, ' ')}
                    </td>
                    <td className="max-w-80 break-words text-xs text-muted-foreground">
                      {event.target || '—'}
                      {event.details && <p className="mt-1">{event.details}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty
              title="Security activity will appear here"
              text="Sign-ins, account changes, permission denials and store changes leave a local record."
            />
          )}
        </section>
      )}
      <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 p-5 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-primary">
          Authentication rate limits stay active after restarting.
        </strong>
        <p className="mt-2">
          Five failed attempts for a username trigger a 60-second cooldown, increasing up to 15
          minutes. Login, recovery and password checks share a limit of 20 requests per minute
          across this app. Store commands also have a burst limit of 120 requests per 10 seconds.
        </p>
      </div>
      {edit && (
        <AccountForm edit={edit} selfId={userId} onClose={() => setEdit(null)} onSaved={load} />
      )}
    </>
  )
}
function AccountForm({
  edit,
  selfId,
  onClose,
  onSaved,
}: {
  edit: Edit
  selfId: number
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { busy, act } = useStore()
  const account = edit.kind === 'new' ? undefined : edit.account
  const self = account?.id === selfId
  return (
    <Modal
      title={
        edit.kind === 'new'
          ? 'Add account'
          : edit.kind === 'reset'
            ? 'Issue a temporary password'
            : 'Manage account'
      }
      description={
        edit.kind === 'new'
          ? 'Create a separate sign-in. The person must choose a private password on their first sign-in.'
          : edit.kind === 'reset'
            ? `Reset ${account!.username}’s password. Their old password and recovery code will stop working.`
            : `${account!.username} · Confirm your owner password to save changes.`
      }
      onClose={() => !busy && onClose()}
      wide
    >
      <DataForm
        busy={busy}
        onSave={async (form) => {
          const common = {
            currentPassword: form.get('currentPassword'),
            password: form.get('password'),
            confirmPassword: form.get('confirmPassword'),
          }
          const result = await act<number | void>(
            () =>
              edit.kind === 'new'
                ? window.dormstore.createAccount({
                    ...common,
                    username: form.get('username'),
                    displayName: form.get('displayName'),
                    role: form.get('role'),
                  })
                : edit.kind === 'reset'
                  ? window.dormstore.resetAccountPassword({ ...common, id: account!.id })
                  : window.dormstore.updateAccount({
                      id: account!.id,
                      displayName: form.get('displayName'),
                      role: self ? account!.role : form.get('role'),
                      active: self ? true : form.get('active') === 'on',
                      unlock: form.get('unlock') === 'on',
                      currentPassword: common.currentPassword,
                    }),
            edit.kind === 'new'
              ? 'Account created. Share the temporary password privately.'
              : edit.kind === 'reset'
                ? 'Temporary password set. The user must change it before accessing the store.'
                : 'Account updated',
            false,
          )
          if (result) {
            onClose()
            await onSaved()
          }
        }}
      >
        <div className="space-y-5">
          {edit.kind !== 'reset' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Display name">
                  <Input
                    name="displayName"
                    required
                    maxLength={120}
                    defaultValue={account?.display_name}
                    autoFocus
                  />
                </Field>
                {edit.kind === 'new' ? (
                  <Field label="Username">
                    <Input
                      name="username"
                      required
                      minLength={3}
                      maxLength={40}
                      pattern="[a-zA-Z0-9._\-]+"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                ) : (
                  <Field label="Username">
                    <Input value={account!.username} disabled />
                  </Field>
                )}
              </div>
              <Field label="Role">
                <select
                  className="input"
                  name="role"
                  defaultValue={account?.role || 'staff'}
                  disabled={self}
                >
                  <option value="staff">Staff — checkout and customer service</option>
                  {self && <option value="owner">Owner — this shop belongs to you</option>}
                </select>
              </Field>
              {edit.kind === 'edit' && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={!!account!.active}
                      disabled={self}
                      className="accent-primary"
                    />
                    Account enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="unlock" className="accent-primary" />
                    Clear this account’s failed sign-in attempts and cooldown
                  </label>
                  {self && (
                    <p className="text-xs text-muted-foreground">
                      Your own account must remain enabled with its current role.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {edit.kind !== 'edit' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Temporary password" hint="At least 12 characters.">
                <PasswordInput
                  name="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm temporary password">
                <PasswordInput
                  name="confirmPassword"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          )}
          <div className="border-t pt-5">
            <Field
              label="Your owner password"
              hint="Account management requires your current password."
            >
              <PasswordInput
                name="currentPassword"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </Field>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy
              ? 'Saving…'
              : edit.kind === 'new'
                ? 'Create account'
                : edit.kind === 'reset'
                  ? 'Set temporary password'
                  : 'Save account'}
          </Button>
        </div>
      </DataForm>
    </Modal>
  )
}
