import {
  ArrowUpRight,
  Banknote,
  ShoppingBag,
  TrendingUp,
  Users,
  Plus,
  Package,
  AlertTriangle,
  Wallet,
  ShoppingBasket,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useStore } from '../context'
import { money, dateTime } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge, Empty, PageTitle, SectionLink, Stat } from '../components/common'
export default function Dashboard() {
  const { data, navigate } = useStore()
  const low = data.products.filter((p) => p.stock <= p.low_stock).sort((a, b) => a.stock - b.stock)
  const firstName = data.settings.owner_name.split(' ')[0]
  const hour = new Date().getHours()
  return (
    <>
      <PageTitle
        title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${firstName ? `, ${firstName}` : ''} 👋`}
        subtitle="Here’s what’s happening at your store today."
      >
        <Button onClick={() => navigate('Point of sale')}>
          <Plus />
          New sale
        </Button>
      </PageTitle>
      {!data.products.length && (
        <div className="mb-6 flex items-center gap-5 rounded-xl border border-primary/15 bg-[#eef6f1] p-5">
          <div className="rounded-xl bg-white p-3 text-primary">
            <Package size={24} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">Welcome to your store’s new home.</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Start with your first product, or load a starter catalog from Settings.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('Products')}>
            Add products
            <ArrowUpRight size={15} />
          </Button>
        </div>
      )}
      <div className="grid grid-cols-4 gap-4">
        <Stat
          title="Today’s sales"
          value={money(data.today.revenue)}
          caption={`${data.today.count} completed transaction${data.today.count === 1 ? '' : 's'} today`}
          icon={<Banknote size={18} />}
          accent
        />
        <Stat
          title="Gross profit"
          value={money(data.today.revenue - data.today.cogs)}
          caption="Sales less the cost of goods sold"
          icon={<TrendingUp size={18} />}
        />
        <Stat
          title="Customer credit"
          value={money(data.totalDebt)}
          caption={`${data.customers.filter((c) => c.balance > 0).length} customers with an open balance`}
          icon={<Users size={18} />}
        />
        <Stat
          title="Low-stock products"
          value={String(low.length)}
          caption={`${data.products.length} active products in your store`}
          icon={<Package size={18} />}
        />
      </div>
      <div className="mt-6 grid grid-cols-[1fr_310px] gap-5">
        <section className="panel">
          <div className="flex items-center justify-between p-5">
            <div>
              <h2 className="font-semibold">Sales overview</h2>
              <p className="mt-1 text-xs text-muted-foreground">A little progress, every day</p>
            </div>
            <span className="rounded-lg border px-3 py-2 text-[11px] text-muted-foreground">
              Last 7 days
            </span>
          </div>
          <div className="px-5">
            <span className="text-2xl font-semibold tracking-tight">
              {money(data.weekly.revenue)}
            </span>
            <span className="ml-3 text-xs text-muted-foreground">total sales this week</span>
          </div>
          <div className="h-[240px] px-3 pt-6 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.weekly.daily}
                margin={{ left: 5, right: 15, top: 5, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#23805f" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#23805f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#edf0ee" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })
                  }
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8a948f', fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8a948f', fontSize: 10 }}
                  tickFormatter={(v) => `₱${v / 100}`}
                  width={60}
                />
                <Tooltip
                  formatter={(v) => [money(Number(v)), 'Sales']}
                  labelFormatter={(d) => String(d)}
                  contentStyle={{ borderRadius: 10, border: '1px solid #e6ebe8', fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#23805f"
                  strokeWidth={2.5}
                  fill="url(#revenueFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel">
          <div className="flex items-center justify-between px-5 pt-5">
            <h2 className="font-semibold">Quick actions</h2>
            <ShoppingBag size={16} className="text-muted-foreground" />
          </div>
          <div className="space-y-2 p-4">
            {[
              {
                title: 'Open checkout',
                text: 'Ring up a new sale',
                icon: ShoppingBasket,
                page: 'Point of sale' as const,
              },
              {
                title: 'Manage inventory',
                text: 'Restock and track your products',
                icon: Package,
                page: 'Inventory' as const,
              },
              {
                title: 'Customer accounts',
                text: 'View credit and repayments',
                icon: Users,
                page: 'Customers' as const,
              },
              {
                title: 'Record an expense',
                text: 'Keep business costs in check',
                icon: Wallet,
                page: 'Expenses' as const,
              },
            ].map((a) => (
              <button
                key={a.title}
                onClick={() => navigate(a.page)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-border hover:bg-muted"
              >
                <span className="rounded-lg bg-[#f1f6f2] p-2.5 text-primary">
                  <a.icon size={17} />
                </span>
                <span className="flex-1">
                  <span className="block text-xs font-semibold">{a.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{a.text}</span>
                </span>
                <ArrowUpRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_310px] gap-5">
        <section className="panel">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-semibold">Recent transactions</h2>
            <SectionLink onClick={() => navigate('Sales history')}>View all</SectionLink>
          </div>
          {data.sales.length ? (
            <table>
              <thead>
                <tr>
                  <th>Receipt / customer</th>
                  <th>Time</th>
                  <th>Payment</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.slice(0, 5).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="text-xs font-medium">{s.receipt}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {s.customer_name || 'Walk-in customer'}
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">{dateTime(s.created_at)}</td>
                    <td>
                      <Badge
                        tone={
                          s.status === 'voided'
                            ? 'red'
                            : s.payment_method === 'credit'
                              ? 'amber'
                              : 'green'
                        }
                      >
                        {s.status === 'voided'
                          ? 'Voided'
                          : s.payment_method === 'gcash'
                            ? 'GCash'
                            : s.payment_method === 'credit'
                              ? 'Credit'
                              : 'Cash'}
                      </Badge>
                    </td>
                    <td className="text-right font-medium tabular-nums">{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty
              title="Your first sale starts here"
              text="Completed transactions will appear here. Open checkout when you’re ready."
            />
          )}
        </section>
        <section className="panel">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-600" />
              <h2 className="font-semibold">Stock watch</h2>
            </div>
            <Badge tone="amber">{low.length}</Badge>
          </div>
          {low.length ? (
            <>
              <div className="px-5">
                {low.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 border-b py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{p.name}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{p.category}</p>
                    </div>
                    <Badge tone={p.stock === 0 ? 'red' : 'amber'}>
                      {p.stock === 0 ? 'Out' : `${p.stock} left`}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="p-4">
                <Button
                  className="w-full"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('Inventory')}
                >
                  View inventory
                  <ArrowUpRight />
                </Button>
              </div>
            </>
          ) : (
            <div className="px-6 py-12 text-center">
              <Package className="mx-auto mb-3 text-primary/50" size={30} />
              <p className="text-sm font-medium">
                {data.products.length ? 'All stocked up' : 'Ready for your products'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {data.products.length
                  ? 'Everything is above its low-stock threshold.'
                  : 'Add products to keep an eye on stock levels here.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
