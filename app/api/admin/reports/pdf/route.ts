import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { supabaseAdmin } from '@/lib/supabase-admin'

function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

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

    const grouped = Object.values(
      (data ?? []).reduce((acc: any, booking: any) => {
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

    const grossRevenue = grouped.reduce((sum: number, b: any) => sum + b.total_amount, 0)
    const refunds = grouped.reduce((sum: number, b: any) => sum + b.refund_amount, 0)
    const netRevenue = grossRevenue - refunds

    const pdf = await PDFDocument.create()
    let page = pdf.addPage([595, 842])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

    let y = 800

    page.drawText('TDA Court Booking System', { x: 50, y, size: 20, font: bold })
    y -= 30
    page.drawText('Monthly Revenue Report', { x: 50, y, size: 16, font: bold })
    y -= 35
    page.drawText(`Period: ${period}`, { x: 50, y, size: 12, font })
    y -= 20
    page.drawText(`Completed Transactions: ${grouped.length}`, { x: 50, y, size: 12, font })
    y -= 18
    page.drawText(`Gross Revenue: PHP${grossRevenue}`, { x: 50, y, size: 12, font })
    y -= 18
    page.drawText(`Refunds: PHP${refunds}`, { x: 50, y, size: 12, font })
    y -= 18
    page.drawText(`Net Revenue: PHP${netRevenue}`, { x: 50, y, size: 12, font: bold, color: rgb(0, 0.5, 0) })
    y -= 40

    // Column x-positions, widened + Net pushed right for breathing room
    const COL_DATE = 50
    const COL_CUSTOMER = 120
    const COL_TIME = 220
    const COL_NET = 520
    const TIME_MAX_WIDTH = 290 // available width before Net column starts

    function drawHeader() {
      page.drawText('Date', { x: COL_DATE, y, size: 11, font: bold })
      page.drawText('Customer', { x: COL_CUSTOMER, y, size: 11, font: bold })
      page.drawText('Time', { x: COL_TIME, y, size: 11, font: bold })
      page.drawText('Net', { x: COL_NET, y, size: 11, font: bold })
      y -= 20
    }

    drawHeader()

    // Wraps a long time string into multiple lines that fit within TIME_MAX_WIDTH
    function wrapText(text: string, size: number, maxWidth: number): string[] {
      const words = text.split(', ')
      const lines: string[] = []
      let current = ''

      for (const word of words) {
        const candidate = current ? `${current}, ${word}` : word
        const width = font.widthOfTextAtSize(candidate, size)
        if (width > maxWidth && current) {
          lines.push(current)
          current = word
        } else {
          current = candidate
        }
      }
      if (current) lines.push(current)
      return lines
    }

    for (const booking of grouped as any[]) {
      const timeParts = booking.slots.map(
        (slot: any) => `${formatHourShort(slot.start)}-${formatHourShort(slot.end)}`
      )
      const hours = booking.slots.length
      const timeLabel = `${timeParts.join(', ')} (${hours}hr${hours > 1 ? 's' : ''})`

      const fontSize = 9
      const timeLines = wrapText(timeLabel, fontSize, TIME_MAX_WIDTH)
      const rowHeight = Math.max(18, timeLines.length * 12)

      if (y - rowHeight < 60) {
        page = pdf.addPage([595, 842])
        y = 800
        drawHeader()
      }

      page.drawText(booking.booking_date, { x: COL_DATE, y, size: 10, font })
      page.drawText(booking.name, { x: COL_CUSTOMER, y, size: 10, font })

      timeLines.forEach((line, i) => {
        page.drawText(line, { x: COL_TIME, y: y - i * 12, size: fontSize, font })
      })

      page.drawText(`PHP${booking.total_amount - booking.refund_amount}`, {
        x: COL_NET,
        y,
        size: 10,
        font,
      })

      y -= rowHeight
    }

    const pdfBytes = await pdf.save()

    return new Response(new Uint8Array(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="monthly-report.pdf"',
      },
    })
  } catch (err) {
    console.error('PDF ERROR:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}