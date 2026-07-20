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