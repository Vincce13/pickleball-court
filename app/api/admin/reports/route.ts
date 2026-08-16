import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const now = new Date()

    const monthParam = searchParams.get('month')
    const yearParam = searchParams.get('year')

    const month = monthParam ? Number(monthParam) : now.getMonth() + 1 // 1-12
    const year = yearParam ? Number(yearParam) : now.getFullYear()

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0) // last day of that month

    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]

    // Query both the live bookings table AND the archive — once a month
    // rolls over, that month's completed bookings move out of `bookings`
    // and into `archived_bookings`, so a report for a past month would
    // otherwise come back empty the moment archiving runs.
    const [liveResult, archivedResult] = await Promise.all([
      supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('status', 'completed')
        .gte('booking_date', start)
        .lte('booking_date', end),
      supabaseAdmin
        .from('archived_bookings')
        .select('*')
        .eq('status', 'completed')
        .gte('booking_date', start)
        .lte('booking_date', end),
    ])

    if (liveResult.error) throw liveResult.error
    if (archivedResult.error) throw archivedResult.error

    const data = [...(liveResult.data ?? []), ...(archivedResult.data ?? [])]

    const grouped: any[] = Object.values(
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

    // Pull finished Open Play sessions for this month and fold each one in
    // as a single lump-sum row — no per-slot detail, just date + total.
    const { data: openPlayData, error: openPlayError } = await supabaseAdmin
      .from('open_play_sessions')
      .select('id, session_date, title, finished_total')
      .eq('status_finished', true)
      .gte('session_date', start)
      .lte('session_date', end)

    if (openPlayError) throw openPlayError

    const openPlayRows = (openPlayData ?? []).map((s: any) => ({
      group_id: `openplay-${s.id}`,
      name: 'Open Play',
      booking_date: s.session_date,
      total_amount: s.finished_total,
      refund_amount: 0,
      slots: [],
    }))

    const combined = [...grouped, ...openPlayRows]

    // Sort newest-first
    combined.sort((a: any, b: any) => b.booking_date.localeCompare(a.booking_date))

    const completedTransactions = combined.length
    const grossRevenue = combined.reduce((sum: number, b: any) => sum + b.total_amount, 0)
    const refunds = combined.reduce((sum: number, b: any) => sum + b.refund_amount, 0)
    const netRevenue = grossRevenue - refunds

    return NextResponse.json({
      summary: { completedTransactions, grossRevenue, refunds, netRevenue, month, year },
      transactions: combined,
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