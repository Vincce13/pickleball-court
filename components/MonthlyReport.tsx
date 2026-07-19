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

export default function MonthlyReport() {
  const [period, setPeriod] = useState<'this-month' | 'last-month'>('this-month')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadReport(value: string) {
    setLoading(true)

    const res = await fetch(`/api/admin/reports?period=${value}`)
    const data = await res.json()

    setReport(data)
    setLoading(false)
  }

  useEffect(() => {
    loadReport(period)
  }, [period])

  return (
    <div className="mb-8 rounded-xl border border-[#9ED9B0]/20 bg-[#16332570] p-5">

      <div className="flex items-center justify-between mb-5">

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

      {report && (
        <>

          <div className="grid grid-cols-4 gap-4 mb-6">

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">
                Completed
              </p>
              <p className="text-2xl font-bold">
                {report.summary.completedTransactions}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">
                Gross
              </p>
              <p className="text-2xl font-bold">
                ₱{report.summary.grossRevenue}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">
                Refunds
              </p>
              <p className="text-2xl font-bold">
                ₱{report.summary.refunds}
              </p>
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <p className="text-sm text-gray-400">
                Net
              </p>
              <p className="text-2xl font-bold text-[#9ED9B0]">
                ₱{report.summary.netRevenue}
              </p>
            </div>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full text-sm">

              <thead>

                <tr className="border-b border-white/10">

                  <th className="text-left py-3">
                    Customer
                  </th>

                  <th className="text-left">
                    Date
                  </th>

                  <th className="text-left">
                    Time
                  </th>

                  <th className="text-right">
                    Gross
                  </th>

                  <th className="text-right">
                    Refund
                  </th>

                  <th className="text-right">
                    Net
                  </th>

                </tr>

              </thead>

              <tbody>
  {report.transactions.map((booking) => {
    const timeText = booking.slots
      .map((slot) => `${slot.start_time}-${slot.end_time}`)
      .join(', ')

    return (
      <tr
        key={booking.group_id}
        className="border-b border-white/5"
      >
        <td className="py-3">
          {booking.name}
        </td>

        <td>
          {booking.booking_date}
        </td>

        <td>
          {timeText} ({booking.slots.length}hr
          {booking.slots.length > 1 ? 's' : ''})
        </td>

        <td className="text-right">
          ₱{booking.total_amount}
        </td>

        <td className="text-right">
          ₱{booking.refund_amount}
        </td>

        <td className="text-right text-[#9ED9B0]">
          ₱{booking.total_amount - booking.refund_amount}
        </td>
      </tr>
    )
  })}
</tbody>

            </table>

          </div>

        </>
      )}

    </div>
  )
}