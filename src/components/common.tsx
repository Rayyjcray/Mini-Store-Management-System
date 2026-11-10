import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Search, PackageOpen, ArrowUpRight, Eye, EyeOff } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('input', className)} {...props} />
)
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-12', className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 -translate-y-1/2"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? 'Hide password' : 'Show password'}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  const generatedId = useId()
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? children
    : null
  const id = control?.props.id || generatedId
  return (
    <div className="block space-y-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {control
        ? cloneElement(control, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })
        : children}
      {hint && (
        <span id={`${id}-hint`} className="block text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  )
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-3 text-muted-foreground" size={16} />
      <Input
        aria-label={placeholder}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
export function PageTitle({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children?: ReactNode
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-5">
      <div>
        <h1 className="text-[27px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}
export function Empty({ title, text, icon }: { title: string; text: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
      <div className="mb-4 rounded-2xl bg-muted p-4">
        {icon ?? <PackageOpen className="text-muted-foreground" size={25} />}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'green' | 'amber' | 'red' | 'neutral'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium',
        {
          green: 'bg-emerald-50 text-emerald-700',
          amber: 'bg-amber-50 text-amber-700',
          red: 'bg-red-50 text-red-600',
          neutral: 'bg-slate-100 text-slate-600',
        }[tone],
      )}
    >
      {children}
    </span>
  )
}
export function Stat({
  title,
  value,
  caption,
  icon,
  accent = false,
}: {
  title: string
  value: string
  caption: string
  icon: ReactNode
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-5',
        accent && 'border-primary/20 bg-primary/[0.025]',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{title}</span>
        <span
          className={cn(
            'rounded-lg bg-muted p-2 text-muted-foreground',
            accent && 'bg-primary/10 text-primary',
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3 text-[27px] font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{caption}</div>
    </div>
  )
}
export function SectionLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </Button>
  )
}
export function FormActions({
  busy,
  onClose,
  label = 'Save changes',
}: {
  busy: boolean
  onClose: () => void
  label?: string
}) {
  return (
    <div className="mt-7 flex justify-end gap-2 border-t pt-5">
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : label}
      </Button>
    </div>
  )
}
export function DataForm({
  children,
  onSave,
  busy,
}: {
  children: ReactNode
  onSave: (form: FormData) => Promise<void>
  busy: boolean
}) {
  const [error, setError] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        setError('')
        try {
          await onSave(form)
        } catch (error) {
          setError((error as Error).message)
        }
      }}
    >
      <fieldset disabled={busy} className="min-w-0">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
export function Pagination({
  page,
  count,
  size,
  onChange,
}: {
  page: number
  count: number
  size: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(count / size))
  return (
    <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
      <span>
        {count
          ? `${Math.min(page * size + 1, count)}–${Math.min((page + 1) * size, count)} of ${count}`
          : '0 records'}
      </span>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <span>
          {Math.min(page + 1, pages)} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
