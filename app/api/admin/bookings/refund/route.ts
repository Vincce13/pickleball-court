import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ids, rainStart } = await req.json()

  if (!Array.isArray(ids) || ids.length === 0 || !rainStart) {
    return NextResponse.json({ error: 'Missing ids or rainStart' }, { status: 400 })
  }

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('bookings')
    .select('id, start_time, end_time, amount')
    .in('id', ids)

  if (fetchError || !rows) {
    return NextResponse.json({ error: fetchError?.message ?? 'Rows not found' }, { status: 500 })
  }

  const rainMinutes = toMinutes(rainStart)
  let totalRefund = 0

  const updates = rows.map((row) => {
    const startMin = toMinutes(row.start_time.slice(0, 5))
    const endMin = toMinutes(row.end_time.slice(0, 5))
    const duration = endMin - startMin

    let refundForRow = 0
    if (rainMinutes <= startMin) {
      // Rain started before this slot even began — fully unused
      refundForRow = row.amount
    } else if (rainMinutes >= endMin) {
      // Rain started after this slot already ended — fully used, no refund
      refundForRow = 0
    } else {
      // Rain started partway through this slot — refund the unused fraction
      const unusedMinutes = endMin - rainMinutes
      refundForRow = Math.round(row.amount * (unusedMinutes / duration))
    }

    totalRefund += refundForRow
    return { id: row.id, refund_amount: refundForRow }
  })

  for (const u of updates) {
    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({ refund_amount: u.refund_amount, rain_start: rainStart })
      .eq('id', u.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, totalRefund })
}