import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Given "HH:MM" (or "HH:MM:SS"), returns the time one hour later as "HH:MM".
// Wraps 23:00 -> 00:00, matching how the booking form treats midnight as the
// end of the day rather than the start of a new one.
function addOneHour(time: string) {
  const [h, m] = time.slice(0, 5).split(':').map(Number)
  const totalMinutes = h * 60 + m + 60
  const endH = Math.floor(totalMinutes / 60) % 24
  const endM = totalMinutes % 60
  return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  try {
    const {
      ids,
      bookingDate,
      startTime,
    } = await req.json()

    if (
      !ids ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !bookingDate ||
      !startTime
    ) {
      return NextResponse.json(
        { error: 'Missing required fields.' },
        { status: 400 }
      )
    }

    // Build N consecutive 1-hour slots starting at startTime, one per id —
    // this is what actually fixes the "6PM-8PM, 6PM-8PM" bug. Previously a
    // single { startTime, endTime } pair was applied to every id in one
    // update, so a 2-hour booking's two rows both got the same full range
    // instead of splitting into 6PM-7PM and 7PM-8PM.
    const newSlots: { start: string; end: string }[] = []
    let current = startTime.slice(0, 5)
    for (let i = 0; i < ids.length; i++) {
      const end = addOneHour(current)
      newSlots.push({ start: current, end })
      current = end
    }
    const startTimes = newSlots.map((s) => s.start)

    // Check if any of the new slots are already taken by another booking
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
    const takenConflict = startTimes.find((t) => takenTimes.includes(t))
    if (takenConflict) {
      return NextResponse.json(
        { error: `${takenConflict} on ${bookingDate} is already booked. Please choose another time.` },
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

    const blockedMatch = (blocked ?? []).find((b) => startTimes.includes(b.start_time.slice(0, 5)))
    if (blockedMatch) {
      return NextResponse.json(
        { error: `${blockedMatch.start_time.slice(0, 5)} on ${bookingDate} is blocked (${blockedMatch.reason}). Please choose another time.` },
        { status: 409 }
      )
    }

    // Each id gets its own start/end pair, so this has to be N individual
    // updates rather than one .update().in('id', ids) call — that's exactly
    // what caused every row to receive the same values before.
    const updateResults = await Promise.all(
      ids.map((id: number, i: number) =>
        supabaseAdmin
          .from('bookings')
          .update({
            booking_date: bookingDate,
            start_time: newSlots[i].start,
            end_time: newSlots[i].end,
          })
          .eq('id', id)
      )
    )

    const failed = updateResults.find((r) => r.error)
    if (failed?.error) {
      console.error(failed.error)
      return NextResponse.json(
        { error: failed.error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Booking rescheduled successfully.',
      slots: newSlots,
    })

  } catch (err) {
    console.error(err)

    return NextResponse.json(
      { error: 'Server error.' },
      { status: 500 }
    )
  }
}