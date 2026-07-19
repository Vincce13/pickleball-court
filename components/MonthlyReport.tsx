'use client'

import { useEffect, useState } from 'react'

type Transaction = {
  group_id: string
  name: string
  booking_date: string
  total_amount: number
  refund_amount: number
  slots: {
    start_time: string
    end_time: string
  }[]
}

type Report = {
  summary: {
    completedTransactions: number
    grossRevenue: number
    refunds: number
    netRevenue: number
  }
  transactions: Transaction[]
}

function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12

  return m === 0
    ? `${hour12}${period}`
    : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

function formatMoney(value: number) {
  return value.toLocaleString()
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function MonthlyReport() {
  const [period, setPeriod] = useState<'this-month' | 'last-month'>('this-month')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  async function loadReport(value: string) {
    setLoading(true)
    setReport(null)
    setHasError(false)

    try {
      const res = await fetch(`/api/admin/reports?period=${value}`)
      const data = await res.json()

      if (!res.ok || !data.summary || !Array.isArray(data.transactions)) {
        setHasError(true)
        return
      }

      setReport(data)
    } catch {
      setHasError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport(period)
  }, [period])

  return (
    <div className="mb-8 rounded-xl border border-[#9ED9B0]/20 bg-[#16332570] p-5">

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">

        <h2 className="text-xl font-semibold">
          Monthly Report
        </h2>

        <div className="flex gap-2">

          <select
            value={period}
            onChange={(e) =>
              setPeriod(e.target.value as 'this-month' | 'last-month')
            }
            className="rounded-lg bg-[#13291F] border border-[#9ED9B0]/20 px-3 py-2"
          >
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
          </select>

          <button
            onClick={() =>
              window.open(`/api/admin/reports/pdf?period=${period}`, '_blank')
            }
            className="rounded-lg bg-[#9ED9B0] text-[#13291F] px-4 py-2 font-medium"
          >
            Export PDF
          </button>

        </div>

      </div>

      {loading && (
        <p>Loading report...</p>
      )}

      {hasError && (
        <p className="text-red-400">
          Failed to load report.
        </p>
      )}

      {report && (

        <>

          {/* Summary */}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">Completed</p>
              <p className="text-2xl font-bold">
                {report.summary.completedTransactions}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">Gross</p>
              <p className="text-2xl font-bold">
                ₱{formatMoney(report.summary.grossRevenue)}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">Refunds</p>
              <p className="text-2xl font-bold">
                ₱{formatMoney(report.summary.refunds)}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">Net</p>
              <p className="text-2xl font-bold text-[#9ED9B0]">
                ₱{formatMoney(report.summary.netRevenue)}
              </p>
            </div>

          </div>

          {report.transactions.length === 0 ? (

            <p>No completed bookings.</p>

          ) : (

            <>
              {/* Desktop */}

              <div className="hidden md:block overflow-x-auto">

                <table className="w-full text-sm">

                  <thead>

                    <tr className="border-b border-white/10">

                      <th className="text-left py-3">Customer</th>

                      <th className="text-left">Date</th>

                      <th className="text-left">Time</th>

                      <th className="text-right">Gross</th>

                      <th className="text-right">Refund</th>

                      <th className="text-right">Net</th>

                    </tr>

                  </thead>

                  <tbody>

                    {report.transactions.map((booking) => {

                      const timeText = booking.slots
                        .map(
                          slot =>
                            `${formatHourShort(slot.start_time)}-${formatHourShort(slot.end_time)}`
                        )
                        .join(', ')

                      return (

                        <tr
                          key={booking.group_id}
                          className="border-b border-white/5"
                        >

                          <td className="py-4">
                            {booking.name}
                          </td>

                          <td>
                            {formatDate(booking.booking_date)}
                          </td>

                          <td>
                            {timeText}
                            {' '}
                            <span className="text-gray-400">
                              ({booking.slots.length} hr{booking.slots.length > 1 ? 's' : ''})
                            </span>
                          </td>

                          <td className="text-right">
                            ₱{formatMoney(booking.total_amount)}
                          </td>

                          <td className="text-right">
                            ₱{formatMoney(booking.refund_amount)}
                          </td>

                          <td className="text-right font-semibold text-[#9ED9B0]">
                            ₱{formatMoney(
                              booking.total_amount - booking.refund_amount
                            )}
                          </td>

                        </tr>

                      )

                    })}

                  </tbody>

                </table>

              </div>

              {/* Mobile */}

              <div className="md:hidden space-y-3">

                {report.transactions.map((booking) => {

                  const timeText = booking.slots
                    .map(
                      slot =>
                        `${formatHourShort(slot.start_time)}-${formatHourShort(slot.end_time)}`
                    )
                    .join(', ')

                  return (

                    <div
                      key={booking.group_id}
                      className="rounded-xl border border-white/10 bg-white/5 p-4"
                    >

                      <div className="flex justify-between mb-2">

                        <h3 className="font-semibold">
                          {booking.name}
                        </h3>

                        <span className="text-xs text-gray-400">
                          {formatDate(booking.booking_date)}
                        </span>

                      </div>

                      <p className="text-sm text-gray-300 mb-3">
                        {timeText} ({booking.slots.length} hr{booking.slots.length > 1 ? 's' : ''})
                      </p>

                      <div className="space-y-1 text-sm">

                        <div className="flex justify-between">
                          <span>Gross</span>
                          <span>₱{formatMoney(booking.total_amount)}</span>
                        </div>

                        <div className="flex justify-between">
                          <span>Refund</span>
                          <span>₱{formatMoney(booking.refund_amount)}</span>
                        </div>

                        <div className="flex justify-between font-semibold text-[#9ED9B0]">
                          <span>Net</span>
                          <span>
                            ₱{formatMoney(
                              booking.total_amount - booking.refund_amount
                            )}
                          </span>
                        </div>

                      </div>

                    </div>

                  )

                })}

              </div>

            </>

          )}

        </>

      )}

    </div>
  )
}