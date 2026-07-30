import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  // Protect this endpoint — only Vercel's Cron (or you manually with the secret) can trigger it
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  // "Previous month" relative to today — e.g. if run on Aug 1, this targets all of July
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const prevMonthStart = firstOfPrevMonth.toISOString().split('T')[0]
  const prevMonthEnd = new Date(firstOfThisMonth.getTime() - 1).toISOString().split('T')[0]

  // 1. Fetch all non-cancelled bookings from the previous month
  const { data: toArchive, error: fetchError } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .gte('booking_date', prevMonthStart)
    .lte('booking_date', prevMonthEnd)
    .neq('status', 'cancelled')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  // 2. Insert them into archived_bookings
  if (toArchive && toArchive.length > 0) {
    const archiveRows = toArchive.map((b) => ({
      id: b.id,
      group_id: b.group_id,
      name: b.name,
      email: b.email,
      phone: b.phone,
      booking_date: b.booking_date,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
      amount: b.amount,
      refund_amount: b.refund_amount,
      rain_start: b.rain_start,
      proof_url: b.proof_url,
      created_at: b.created_at,
    }))

    const { error: insertError } = await supabaseAdmin
      .from('archived_bookings')
      .insert(archiveRows)

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  // 3. Delete ALL previous-month bookings from the live table —
  //    both the ones we just archived AND cancelled ones (which are never archived, just dropped)
  const { error: deleteError } = await supabaseAdmin
    .from('bookings')
    .delete()
    .gte('booking_date', prevMonthStart)
    .lte('booking_date', prevMonthEnd)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    archivedCount: toArchive?.length ?? 0,
    period: `${prevMonthStart} to ${prevMonthEnd}`,
  })
}