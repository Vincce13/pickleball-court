import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'Missing date' }, { status: 400 })
  }

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('bookings')
    .select('start_time, end_time, name, status')
    .eq('booking_date', date)
    .neq('status', 'cancelled')

  if (bookingsError) {
    return NextResponse.json({ error: bookingsError.message }, { status: 500 })
  }

  const { data: blocked, error: blockedError } = await supabaseAdmin
    .from('blocked_slots')
    .select('start_time, end_time, reason')
    .eq('booking_date', date)

  if (blockedError) {
    return NextResponse.json({ error: blockedError.message }, { status: 500 })
  }

  return NextResponse.json({ bookings: bookings ?? [], blocked: blocked ?? [] })
}