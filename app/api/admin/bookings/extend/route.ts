import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const {
      groupId,
      existingIds,
      name,
      email,
      phone,
      bookingDate,
      startTime,
      endTime,
      amount,
      status,
    } = await req.json()

    if (!bookingDate || !startTime || !endTime || !name) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    // Re-check vacancy server-side right before inserting — the dashboard's
    // check was based on state that could be a few seconds stale.
    const { data: conflict } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('booking_date', bookingDate)
      .eq('start_time', startTime)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (conflict) {
      return NextResponse.json(
        { error: 'That hour was just taken by another booking. Please refresh and try again.' },
        { status: 409 }
      )
    }

    const { data: blocked } = await supabaseAdmin
      .from('blocked_slots')
      .select('id')
      .eq('booking_date', bookingDate)
      .eq('start_time', startTime)
      .maybeSingle()

    if (blocked) {
      return NextResponse.json({ error: 'That hour is blocked.' }, { status: 409 })
    }

    // If this booking doesn't have a group_id yet (a lone single-slot
    // booking), give it one now so the new hour and the original slot are
    // grouped together going forward.
    let resolvedGroupId = groupId as string | null

    if (!resolvedGroupId) {
      resolvedGroupId = crypto.randomUUID()

      const { error: backfillError } = await supabaseAdmin
        .from('bookings')
        .update({ group_id: resolvedGroupId })
        .in('id', existingIds ?? [])

      if (backfillError) {
        return NextResponse.json({ error: backfillError.message }, { status: 500 })
      }
    }

    const { error: insertError } = await supabaseAdmin.from('bookings').insert({
      group_id: resolvedGroupId,
      name,
      email,
      phone,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
      status: status ?? 'confirmed',
      amount,
      refund_amount: 0,
      proof_url: null,
    })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('EXTEND BOOKING ERROR:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}