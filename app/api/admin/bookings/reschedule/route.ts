import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const {
      ids,
      bookingDate,
      startTime,
      endTime,
    } = await req.json()

    if (
      !ids ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !bookingDate ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        { error: 'Missing required fields.' },
        { status: 400 }
      )
    }

    // Check if the new date/time is already taken by another booking
    const { data: existingBookings, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, start_time')
      .eq('booking_date', bookingDate)
      .neq('status', 'cancelled')
      .not('id', 'in', `(${ids.join(',')})`)

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const takenTimes = (existingBookings ?? []).map((b) => b.start_time.slice(0, 5))
    if (takenTimes.includes(startTime)) {
      return NextResponse.json(
        { error: `${startTime} on ${bookingDate} is already booked. Please choose another time.` },
        { status: 409 }
      )
    }

    // Also check against blocked/maintenance slots
    const { data: blocked, error: blockedError } = await supabaseAdmin
      .from('blocked_slots')
      .select('start_time, reason')
      .eq('booking_date', bookingDate)

    if (blockedError) {
      return NextResponse.json({ error: blockedError.message }, { status: 500 })
    }

    const blockedMatch = (blocked ?? []).find((b) => b.start_time.slice(0, 5) === startTime)
    if (blockedMatch) {
      return NextResponse.json(
        { error: `${startTime} on ${bookingDate} is blocked (${blockedMatch.reason}). Please choose another time.` },
        { status: 409 }
      )
    }

    const { error } = await supabaseAdmin
      .from('bookings')
      .update({
        booking_date: bookingDate,
        start_time: startTime,
        end_time: endTime,
      })
      .in('id', ids)

    if (error) {
      console.error(error)

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Booking rescheduled successfully.',
    })

  } catch (err) {
    console.error(err)

    return NextResponse.json(
      { error: 'Server error.' },
      { status: 500 }
    )
  }
}