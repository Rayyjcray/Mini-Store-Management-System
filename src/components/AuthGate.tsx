import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { ArrowLeft, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Store } from 'lucide-react'
import type { AccountRole, AuthAccess, AuthState, Result } from '../../shared/contracts'
import { DataForm, Field, Input } from './common'
import { Button } from './ui/button'

const OwnerContext = createContext<{
  username: string
  role: AccountRole
  displayName: string
  userId: number
  shopId: string
  shopName: string
  lockStore: () => Promise<void>
}>(null!)
export const useOwner = () => useContext(OwnerContext)

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [savedCode, setSavedCode] = useState(false)
  const load = useCallback(async () => {
    try {
      if (!window.dormstore) throw new Error('Open DormStore through the desktop application.')
      const result = await window.dormstore.authStatus()
      if (!result.ok) throw new Error(result.error)
      setState(result.data)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    if (!window.dormstore) {
      void load()
      return
    }
    const unsubscribe = window.dormstore.onAuthChanged((next) => {
      setState(next)
      if (!next.authenticated) {
        setRecoveryCode('')
        setSavedCode(false)
        setRecovering(false)
        setRegistering(false)
        setError('')
      }
    })
    void load()
    return unsubscribe
  }, [load])
  useEffect(() => {
    if (!state?.authenticated) return
    let lastSent = 0
    const activity = () => {
      if (Date.now() - lastSent < 15_000) return
      lastSent = Date.now()
      void window.dormstore
        .authActivity()
        .then((result) => {
          if (!result.ok) void load()
        })
        .catch(() => {
          void load()
        })
    }
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel'])
      window.addEventListener(event, activity, { passive: true })
    return () => {
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel'])
        window.removeEventListener(event, activity)
    }
  }, [state?.authenticated, load])
  const lockStore = async () => {
    const result = await window.dormstore.signOut()
    if (result.ok) {
      setState(result.data)
      setRecoveryCode('')
      setSavedCode(false)
    } else {
      setError(result.error)
      await load()
    }
  }
  const submit = async (operation: () => Promise<Result<AuthAccess>>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      if (!result.ok) throw new Error(result.error)
      setRecoveryCode(result.data.recoveryCode || '')
      setSavedCode(false)
      setState(result.data.state)
      setRecovering(false)
      setRegistering(false)
    } catch (e) {
      setError((e as Error).message)
      if (window.dormstore) {
        const latest = await window.dormstore.authStatus().catch(() => null)
        if (latest?.ok) setState(latest.data)
      }
    } finally {
      setBusy(false)
    }
  }
  if (state?.authenticated && !recoveryCode && !state.mustChangePassword)
    return (
      <OwnerContext.Provider
        value={{
          username: state.username!,
          role: state.role!,
          displayName: state.displayName!,
          userId: state.userId!,
          shopId: state.shopId!,
          shopName: state.shopName!,
          lockStore,
        }}
      >
        <Fragment key={`${state.userId}:${state.shopId}`}>{children}</Fragment>
      </OwnerContext.Provider>
    )
  const setup = state && (!state.configured || registering)
  const forced = !!state?.authenticated && state.mustChangePassword && !recoveryCode
  const title = recoveryCode
    ? 'Save your recovery code'
    : !state
      ? 'Opening DormStore'
      : forced
        ? 'Choose your own password'
        : setup
          ? 'Secure your store'
          : recovering
            ? 'Recover your account'
            : 'Welcome back'
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f8f6] px-6 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-white">
            <Store size={27} strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight">
              DormStore<span className="text-primary">.</span>
            </p>
            <p className="text-xs text-muted-foreground">Your everyday store companion</p>
          </div>
        </div>
        <section className="rounded-2xl border bg-white p-8 shadow-sm">
          <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-primary/8 text-primary">
            {recoveryCode || recovering ? <KeyRound size={22} /> : <LockKeyhole size={22} />}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 mb-6 text-sm leading-relaxed text-muted-foreground">
            {recoveryCode
              ? 'Keep this code somewhere private outside this computer. You will need it if you forget your password.'
              : setup
                ? 'Create an owner account and a private shop. This will not grant access to anyone else’s shop.'
                : forced
                  ? 'Replace your temporary password before using the store. Only you should know your new password.'
                  : recovering
                    ? 'Use your username and saved recovery code to choose a new password.'
                    : state
                      ? 'Sign in to access your store. Your records stay safely on this computer.'
                      : 'Checking owner access…'}
          </p>
          {!state ? (
            error ? (
              <>
                <p role="alert" className="mb-4 text-sm text-red-600">
                  {error}
                </p>
                <Button onClick={load}>Try again</Button>
              </>
            ) : (
              <LoaderCircle className="animate-spin text-primary" size={20} />
            )
          ) : recoveryCode ? (
            <>
              <Field label="Recovery code">
                <textarea
                  aria-label="Recovery code"
                  readOnly
                  className="input min-h-24 font-mono text-sm tracking-wider"
                  value={recoveryCode}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Field>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                This is the only time this code is shown. Select it and press Ctrl+C to save it in
                your password manager, or write it down.
              </p>
              <label className="my-5 flex items-start gap-3 text-sm">
                <input
                  className="mt-1 accent-primary"
                  type="checkbox"
                  checked={savedCode}
                  onChange={(e) => setSavedCode(e.target.checked)}
                />
                I have saved my recovery code privately.
              </label>
              <Button className="w-full" disabled={!savedCode} onClick={() => setRecoveryCode('')}>
                Open my store
              </Button>
            </>
          ) : (
            <>
              <DataForm
                key={setup ? 'setup' : forced ? 'forced' : recovering ? 'recover' : 'login'}
                busy={busy}
                onSave={async (form) => {
                  const input = {
                    username: String(form.get('username')),
                    password: String(form.get('password')),
                    confirmPassword: String(form.get('confirmPassword')),
                    recoveryCode: String(form.get('recoveryCode')),
                    currentPassword: String(form.get('currentPassword')),
                    shopName: String(form.get('shopName')),
                  }
                  await submit(() =>
                    forced
                      ? window.dormstore.changePassword(input)
                      : setup
                        ? registering
                          ? window.dormstore.registerOwner(input)
                          : window.dormstore.setupOwner(input)
                        : recovering
                          ? window.dormstore.resetPassword(input)
                          : window.dormstore.signIn({
                              username: input.username,
                              password: input.password,
                            }),
                  )
                }}
              >
                <div className="space-y-5">
                  {setup && (
                    <Field label="Shop name">
                      <Input
                        name="shopName"
                        required
                        maxLength={120}
                        placeholder="e.g. Maria’s Mini Store"
                      />
                    </Field>
                  )}
                  {!forced && (
                    <Field
                      label="Username"
                      hint={
                        setup ? '3–40 letters, numbers, dots, underscores or hyphens.' : undefined
                      }
                    >
                      <Input
                        name="username"
                        required
                        autoFocus
                        autoComplete="username"
                        spellCheck={false}
                        autoCapitalize="none"
                        minLength={3}
                        maxLength={40}
                        pattern="[a-zA-Z0-9._\-]+"
                        placeholder="Your account username"
                      />
                    </Field>
                  )}
                  {forced && (
                    <Field label="Temporary password">
                      <Input
                        name="currentPassword"
                        type="password"
                        required
                        maxLength={128}
                        autoComplete="current-password"
                        autoFocus
                      />
                    </Field>
                  )}
                  {recovering && (
                    <Field label="Saved recovery code">
                      <Input
                        name="recoveryCode"
                        required
                        maxLength={128}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Enter your private recovery code"
                      />
                    </Field>
                  )}
                  <Field
                    label={recovering || forced ? 'New password' : 'Password'}
                    hint={
                      setup || recovering || forced
                        ? 'Use at least 12 characters. Spaces and passphrases are welcome.'
                        : undefined
                    }
                  >
                    <Input
                      name="password"
                      type="password"
                      required
                      minLength={setup || recovering || forced ? 12 : 1}
                      maxLength={128}
                      autoComplete={
                        setup || recovering || forced ? 'new-password' : 'current-password'
                      }
                    />
                  </Field>
                  {(setup || recovering || forced) && (
                    <Field label="Confirm password">
                      <Input
                        name="confirmPassword"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </Field>
                  )}
                </div>
                {error && (
                  <p
                    role="alert"
                    className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-600"
                  >
                    {error}
                  </p>
                )}
                <Button type="submit" className="mt-6 h-11 w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      Please wait…
                    </>
                  ) : forced ? (
                    'Save my password'
                  ) : setup ? (
                    'Create owner account'
                  ) : recovering ? (
                    'Reset password'
                  ) : (
                    'Sign in'
                  )}
                </Button>
              </DataForm>
              {state.configured && !forced && !registering && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRecovering(!recovering)
                    setError('')
                  }}
                  className="mt-5 flex w-full items-center justify-center gap-2 text-xs text-primary"
                >
                  {recovering ? (
                    <>
                      <ArrowLeft size={13} />
                      Back to sign in
                    </>
                  ) : (
                    'Forgot password?'
                  )}
                </button>
              )}
              {state.configured && !forced && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRegistering(!registering)
                    setRecovering(false)
                    setError('')
                  }}
                  className="mt-4 w-full text-center text-xs text-primary"
                >
                  {registering ? 'Back to sign in' : 'Create owner account & shop'}
                </button>
              )}
            </>
          )}
        </section>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={14} />
          Authorized accounts only · Works offline
        </p>
        {state?.configured && !recoveryCode && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Your store locks after {state.idleMinutes} minutes of inactivity.
          </p>
        )}
      </div>
    </main>
  )
}
