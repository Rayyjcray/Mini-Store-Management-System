import { useEffect, useState } from 'react'
import { Download, Banknote, TrendingUp, Wallet, ChartNoAxesCombined } from 'lucide-react'
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import type { Report } from '../../shared/contracts'
import { useStore } from '../context'
import { Empty, Input, PageTitle, Stat } from '../components/common'
import { Button } from '../components/ui/button'
import { day, money } from '../lib/utils'
export default function Reports() {
  const { busy, act, data } = useStore()
  const month = new Date()
  month.setDate(1)
  const [from, setFrom] = useState(day(month)),
    [to, setTo] = useState(day()),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    window.dormstore
      .report({ from, to })
      .then((r) => {
        if (!active) return
        if (r.ok) setReport(r.data)
        else {
          setReport(null)
          setError(r.error)
        }
      })
      .catch((e) => {
        if (active) {
          setReport(null)
          setError(e.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [from, to, data])
  return (
    <>
      <PageTitle
        title="Reports & insights"
        subtitle="Know what’s selling, what you’re spending, and what you’re earning."
      >
        <Button
          variant="outline"
          disabled={busy || loading || !report}
          onClick={() =>
            act(() => window.dormstore.exportReport({ from, to }), 'Export dialog completed', false)
          }
        >
          <Download />
          Export CSV
        </Button>
      </PageTitle>
      <div className="mb-6 flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          To
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFrom(day())
            setTo(day())
          }}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const d = new Date()
            d.setDate(d.getDate() - 6)
            setFrom(day(d))
            setTo(day())
          }}
        >
          Last 7 days
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFrom(day(month))
            setTo(day())
          }}
        >
          This month
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && <p className="mb-4 text-xs text-muted-foreground">Updating report…</p>}
      {report && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Stat
              title="Sales revenue"
              value={money(report.revenue)}
              caption={`${report.count} completed sales · includes credit`}
              icon={<Banknote size={17} />}
              accent
            />
            <Stat
              title="Gross profit"
              value={money(report.revenue - report.cogs)}
              caption={`Cost of goods: ${money(report.cogs)}`}
              icon={<TrendingUp size={17} />}
            />
            <Stat
              title="Operating expenses"
              value={money(report.expenses)}
              caption="Expenses recorded in this period"
              icon={<Wallet size={17} />}
            />
            <Stat
              title="Net profit"
              value={money(report.revenue - report.cogs - report.expenses)}
              caption="Gross profit less operating expenses"
              icon={<ChartNoAxesCombined size={17} />}
            />
          </div>
          <div className="mt-5 rounded-lg border bg-white px-5 py-3 text-xs text-muted-foreground">
            Collections: <strong className="text-foreground">{money(report.collections)}</strong>
            <span className="mx-3">·</span>Includes sale payments and customer repayments received
            in this period. Repayments do not add to sales revenue.
          </div>
          <section className="panel mt-5">
            <div className="px-5 pt-5">
              <h2 className="font-semibold">Daily performance</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Sales revenue and gross profit in your selected period
              </p>
            </div>
            <div className="h-[300px] px-3 pt-7 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.daily} margin={{ right: 20, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#edf0ee" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) =>
                      new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                    tick={{ fill: '#8a948f', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    tickFormatter={(v) => `₱${v / 100}`}
                    tick={{ fill: '#8a948f', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={65}
                  />
                  <Tooltip
                    formatter={(v) => money(Number(v))}
                    contentStyle={{ fontSize: 12, borderRadius: 10 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  <Bar
                    dataKey="revenue"
                    name="Sales revenue"
                    fill="#277e60"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar dataKey="profit" name="Gross profit" fill="#b8d4c5" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <div className="mt-5 grid grid-cols-2 gap-5">
            <section className="panel">
              <h2 className="p-5 font-semibold">Best sellers</h2>
              {report.topProducts.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topProducts.map((p, i) => (
                      <tr key={i}>
                        <td className="text-xs font-medium">
                          <span className="mr-3 text-muted-foreground">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          {p.name}
                        </td>
                        <td className="text-right">{p.quantity}</td>
                        <td className="text-right font-medium">{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty
                  title="Your best sellers will appear here"
                  text="Complete a sale in this period to see which products lead the way."
                />
              )}
            </section>
            <section className="panel">
              <h2 className="p-5 font-semibold">Sales by category</h2>
              {report.categories.length ? (
                <div className="space-y-5 px-5 pb-6">
                  {report.categories.map((c) => (
                    <div key={c.name}>
                      <div className="mb-2 flex justify-between text-xs">
                        <span>{c.name}</span>
                        <span className="font-medium">{money(c.revenue)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{
                            width: `${report.revenue ? (c.revenue / report.revenue) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="A category for every essential"
                  text="See how each part of your catalog contributes to sales."
                />
              )}
            </section>
          </div>
          <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
            Voided transactions are excluded. Product cost is captured at the time of sale. Stock
            adjustments do not automatically record financial losses. Category grouping uses each
            product’s current category.
          </p>
        </>
      )}
    </>
  )
}
