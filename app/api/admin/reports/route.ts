import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const period = searchParams.get('period') ?? 'this-month'

    const today = new Date()

    let startDate: Date
    let endDate: Date

    if (period === 'last-month') {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      endDate = new Date(today.getFullYear(), today.getMonth(), 0)
    } else {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1)
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    }

    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('status', 'completed')
      .gte('booking_date', start)
      .lte('booking_date', end)
      .order('booking_date', { ascending: false })

    if (error) {
      throw error
    }

    const grouped = Object.values(
  data.reduce((acc: any, booking: any) => {
    const key = booking.group_id ?? booking.id

    if (!acc[key]) {
      acc[key] = {
        group_id: key,
        name: booking.name,
        booking_date: booking.booking_date,
        total_amount: 0,
        refund_amount: 0,
        slots: [],
      }
    }

    acc[key].total_amount += Number(booking.amount)
    acc[key].refund_amount += Number(booking.refund_amount ?? 0)

    acc[key].slots.push({
      start_time: booking.start_time,
      end_time: booking.end_time,
    })

    return acc
  }, {})
)

const completedTransactions = grouped.length

const grossRevenue = grouped.reduce(
  (sum: number, booking: any) => sum + booking.total_amount,
  0
)

const refunds = grouped.reduce(
  (sum: number, booking: any) => sum + booking.refund_amount,
  0
)

const netRevenue = grossRevenue - refunds

return NextResponse.json({
  summary: {
    completedTransactions,
    grossRevenue,
    refunds,
    netRevenue,
    period,
  },
  transactions: grouped,
})
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        error: 'Failed to load report.',
      },
      {
        status: 500,
      }
    )
  }
}