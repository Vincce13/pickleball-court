import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
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

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('status', 'completed')
      .gte('booking_date', startDate.toISOString().split('T')[0])
      .lte('booking_date', endDate.toISOString().split('T')[0])
      .order('booking_date', { ascending: true })

    if (error) throw error

    // Group bookings by group_id
const grouped = Object.values(
  data.reduce((acc: any, booking: any) => {
    if (!acc[booking.group_id]) {
      acc[booking.group_id] = {
        booking_date: booking.booking_date,
        name: booking.name,
        refund_amount: Number(booking.refund_amount ?? 0),
        total_amount: 0,
        slots: [],
      }
    }

    acc[booking.group_id].total_amount += Number(booking.amount)

    acc[booking.group_id].slots.push({
      start: booking.start_time,
      end: booking.end_time,
    })

    return acc
  }, {})
)

const grossRevenue = grouped.reduce(
  (sum: number, b: any) => sum + b.total_amount,
  0
)

const refunds = grouped.reduce(
  (sum: number, b: any) => sum + b.refund_amount,
  0
)

const netRevenue = grossRevenue - refunds

    const pdf = await PDFDocument.create()

    const page = pdf.addPage([595, 842])

    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

    let y = 800

    page.drawText('TDA Court Booking System', {
      x: 50,
      y,
      size: 20,
      font: bold,
    })

    y -= 30

    page.drawText('Monthly Revenue Report', {
      x: 50,
      y,
      size: 16,
      font: bold,
    })

    y -= 35

    page.drawText(`Period: ${period}`, {
      x: 50,
      y,
      size: 12,
      font,
    })

    y -= 20

   page.drawText(`Completed Transactions: ${grouped.length}`, {
      x: 50,
      y,
      size: 12,
      font,
    })

    y -= 18

    page.drawText(`Gross Revenue: PHP${grossRevenue}`, {
      x: 50,
      y,
      size: 12,
      font,
    })

    y -= 18

    page.drawText(`Refunds: PHP${refunds}`, {
      x: 50,
      y,
      size: 12,
      font,
    })

    y -= 18

    page.drawText(`Net Revenue: PHP${netRevenue}`, {
      x: 50,
      y,
      size: 12,
      font: bold,
      color: rgb(0, 0.5, 0),
    })

    y -= 40

    page.drawText('Date', { x: 50, y, size: 11, font: bold })
    page.drawText('Customer', { x: 140, y, size: 11, font: bold })
    page.drawText('Time', { x: 290, y, size: 11, font: bold })
    page.drawText('Net', { x: 480, y, size: 11, font: bold })

    y -= 20

for (const booking of grouped as any[]) {
  const times = booking.slots
    .map((slot: any) => `${slot.start}-${slot.end}`)
    .join(', ')

  const hours = booking.slots.length

  page.drawText(booking.booking_date, {
    x: 50,
    y,
    size: 10,
    font,
  })

  page.drawText(booking.name, {
    x: 140,
    y,
    size: 10,
    font,
  })

  page.drawText(
    `${times} (${hours} hr${hours > 1 ? 's' : ''})`,
    {
      x: 290,
      y,
      size: 10,
      font,
    }
  )

  page.drawText(
    `PHP${booking.total_amount - booking.refund_amount}`,
    {
      x: 480,
      y,
      size: 10,
      font,
    }
  )

  y -= 18

  if (y < 60) break
}

const pdfBytes = await pdf.save()

return new Response(new Uint8Array(pdfBytes), {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="monthly-report.pdf"',
  },
})
  } catch (err) {
    console.error("PDF ERROR:", err)

    return NextResponse.json(
      {
        error: String(err),
      },
      { status: 500 }
    )
}
}