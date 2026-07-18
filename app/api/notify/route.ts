import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

export async function POST(req: NextRequest) {
  const { email, name, bookingDate, slots, totalAmount, status } = await req.json()

  if (!email || !name || !bookingDate || !slots || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const slotsList = slots
    .map((s: { start: string; end: string }) => `${formatHourShort(s.start)} - ${formatHourShort(s.end)}`)
    .join(', ')

  // Admin notification — sent to you, not the customer, whenever a new booking comes in
 if (status === 'new_booking') {
    const dashboardUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/admin`

    try {
      await resend.emails.send({
        from: 'TDA Pickleball Court <onboarding@resend.dev>',
        to: process.env.ADMIN_EMAIL!,
        subject: `New booking from ${name} — needs review`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #3F6B52;">New Booking Received</h2>
            <p>A new booking just came in and is waiting for payment verification.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 8px 0; color: #666;">Customer</td><td style="padding: 8px 0; font-weight: bold;">${name}</td></tr>
              <tr><td style="padding: 8px 0; color: #666;">Email</td><td style="padding: 8px 0; font-weight: bold;">${email}</td></tr>
              <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: bold;">${bookingDate}</td></tr>
              <tr><td style="padding: 8px 0; color: #666;">Time</td><td style="padding: 8px 0; font-weight: bold;">${slotsList}</td></tr>
              <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: bold;">₱${totalAmount}</td></tr>
            </table>
            
              href="${dashboardUrl}"
              style="display: inline-block; background: #3F6B52; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: bold; margin-top: 8px;"
            >
              Open Admin Dashboard
            </a>
            <p style="color: #999; font-size: 12px; margin-top: 16px;">
              If the button doesn't work, copy this link: ${dashboardUrl}
            </p>
          </div>
        `,
      })
      return NextResponse.json({ success: true })
    } catch (err) {
      console.error('Admin notify email error:', err)
      return NextResponse.json({ error: 'Failed to send admin email' }, { status: 500 })
    }
  }

  let subject = ''
  let html = ''

  if (status === 'received') {
    subject = 'We received your TDA Pickleball Court booking'
    html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #3F6B52;">Booking Received</h2>
        <p>Hi ${name},</p>
        <p>Thanks for booking! We've received your reservation request and payment screenshot. We'll verify it shortly and send you a confirmation email.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: bold;">${bookingDate}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Time</td><td style="padding: 8px 0; font-weight: bold;">${slotsList}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Total</td><td style="padding: 8px 0; font-weight: bold;">₱${totalAmount}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px;">TDA Pickleball Court</p>
      </div>
    `
  } else if (status === 'confirmed') {
    subject = 'Your TDA Pickleball Court booking is confirmed!'
    html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #3F6B52;">Booking Confirmed ✅</h2>
        <p>Hi ${name},</p>
        <p>Your payment has been verified and your court reservation is now confirmed:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: bold;">${bookingDate}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Time</td><td style="padding: 8px 0; font-weight: bold;">${slotsList}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Total Paid</td><td style="padding: 8px 0; font-weight: bold;">₱${totalAmount}</td></tr>
        </table>
        <p>See you on the court!</p>
        <p style="color: #999; font-size: 12px;">TDA Pickleball Court</p>
      </div>
    `
  } else if (status === 'cancelled') {
    subject = 'Your TDA Pickleball Court booking was cancelled'
    html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #C0392B;">Booking Cancelled</h2>
        <p>Hi ${name},</p>
        <p>Your reservation for the following has been cancelled:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: bold;">${bookingDate}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Time</td><td style="padding: 8px 0; font-weight: bold;">${slotsList}</td></tr>
        </table>
        <p>If you believe this was a mistake, please contact us or make a new booking.</p>
        <p style="color: #999; font-size: 12px;">TDA Pickleball Court</p>
      </div>
    `
  } else {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  try {
    await resend.emails.send({
      from: 'TDA Pickleball Court <onboarding@resend.dev>',
      to: email,
      subject,
      html,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email send error:', err)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}