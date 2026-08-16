import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)

  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12

  return m === 0
    ? `${hour12}${period}`
    : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

export async function POST(req: NextRequest) {
  try {
    const {
      email,
      name,
      bookingDate,
      slots,
      totalAmount,
      status,
      oldDate,
      oldSlots,
      isOpenPlay,
      sessionTitle,
      slotNumbers,
    } = await req.json()

    // Basic validation
    // Open Play flows send `slotNumbers` instead of `slots`, so validate
    // whichever field the given status actually relies on.
    const isOpenPlayStatus = [
      'new_openplay_join',
      'openplay_received',
      'openplay_confirmed',
      'openplay_cancelled',
    ].includes(status)

    const missingSlotsInfo = isOpenPlayStatus
      ? !slotNumbers || slotNumbers.length === 0
      : !slots || slots.length === 0

    if (!email || !name || !bookingDate || !status || missingSlotsInfo) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Format court booking slots
    const slotsList = (slots ?? [])
      .map(
        (s: { start: string; end: string }) =>
          `${formatHourShort(s.start)} - ${formatHourShort(s.end)}`
      )
      .join(', ')

    const dashboardUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/admin`

    /*
    ============================================================
    NEW COURT BOOKING
    ============================================================
    */

    if (status === 'new_booking') {
      try {
        const result = await resend.emails.send({
          from: 'TDA Pickleball Court <noreply@tdacourt.jo3.org>',
          to: process.env.ADMIN_EMAIL!,
          subject: `New booking from ${name} — needs review`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              
              <h2 style="color: #3F6B52;">
                New Booking Received
              </h2>

              <p>
                A new booking just came in and is waiting for payment verification.
              </p>

              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Customer</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${name}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Email</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${email}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Date</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${bookingDate}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Time</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${slotsList}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Amount</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ₱${totalAmount}
                  </td>
                </tr>
              </table>

              <a
                href="${dashboardUrl}"
                style="
                  display: inline-block;
                  background: #3F6B52;
                  color: #ffffff;
                  text-decoration: none;
                  padding: 12px 24px;
                  border-radius: 999px;
                  font-weight: bold;
                  margin-top: 8px;
                "
              >
                Open Admin Dashboard
              </a>

              <p style="color: #999; font-size: 12px; margin-top: 16px;">
                TDA Pickleball Court
              </p>

            </div>
          `,
        })

        console.log('Admin booking email sent:', result)

        return NextResponse.json({
          success: true,
          message: 'Admin booking notification sent',
        })
      } catch (err) {
        console.error('Admin booking email error:', err)

        return NextResponse.json(
          { error: 'Failed to send admin booking email' },
          { status: 500 }
        )
      }
    }

    /*
    ============================================================
    NEW OPEN PLAY JOIN
    ============================================================
    */

    if (status === 'new_openplay_join') {
      try {
        const result = await resend.emails.send({
          from: 'TDA Pickleball Court <noreply@tdacourt.jo3.org>',
          to: process.env.ADMIN_EMAIL!,
          subject: `New Open Play join from ${name} — needs review`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

              <h2 style="color: #3F6B52;">
                New Open Play Join
              </h2>

              <p>
                Someone just joined an Open Play session and is waiting
                for payment verification.
              </p>

              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

                <tr>
                  <td style="padding: 8px 0; color: #666;">Customer</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${name}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Email</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${email}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Session</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${sessionTitle ?? ''}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Date</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ${bookingDate}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Slot(s)</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    #${(slotNumbers ?? []).join(', #')}
                  </td>
                </tr>

                <tr>
                  <td style="padding: 8px 0; color: #666;">Amount</td>
                  <td style="padding: 8px 0; font-weight: bold;">
                    ₱${totalAmount}
                  </td>
                </tr>

              </table>

              <a
                href="${dashboardUrl}"
                style="
                  display: inline-block;
                  background: #3F6B52;
                  color: #ffffff;
                  text-decoration: none;
                  padding: 12px 24px;
                  border-radius: 999px;
                  font-weight: bold;
                  margin-top: 8px;
                "
              >
                Open Admin Dashboard
              </a>

              <p style="color: #999; font-size: 12px; margin-top: 16px;">
                TDA Pickleball Court
              </p>

            </div>
          `,
        })

        console.log('Admin Open Play email sent:', result)

        return NextResponse.json({
          success: true,
          message: 'Admin Open Play notification sent',
        })
      } catch (err) {
        console.error('Admin Open Play email error:', err)

        return NextResponse.json(
          { error: 'Failed to send admin Open Play email' },
          { status: 500 }
        )
      }
    }

    /*
    ============================================================
    CUSTOMER EMAILS
    ============================================================
    */

    let subject = ''
    let html = ''

    /*
    -------------------------
    BOOKING RECEIVED
    -------------------------
    */

    if (status === 'received') {
      subject = 'We received your TDA Pickleball Court booking'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #3F6B52;">
            Booking Received
          </h2>

          <p>Hi ${name},</p>

          <p>
            Thanks for booking! We've received your reservation request
            and payment screenshot. We'll verify it shortly and send you
            a confirmation email.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Time</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${slotsList}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Total</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ₱${totalAmount}
              </td>
            </tr>

          </table>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    /*
    -------------------------
    BOOKING CONFIRMED
    -------------------------
    */

    else if (status === 'confirmed') {
      subject = 'Your TDA Pickleball Court booking is confirmed!'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #3F6B52;">
            Booking Confirmed ✅
          </h2>

          <p>Hi ${name},</p>

          <p>
            Your payment has been verified and your court reservation
            is now confirmed:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Time</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${slotsList}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Total Paid</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ₱${totalAmount}
              </td>
            </tr>

          </table>

          <p>See you on the court!</p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    /*
    -------------------------
    BOOKING CANCELLED
    -------------------------
    */

    else if (status === 'cancelled') {
      subject = 'Your TDA Pickleball Court booking was cancelled'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #C0392B;">
            Booking Cancelled
          </h2>

          <p>Hi ${name},</p>

          <p>
            Your reservation for the following has been cancelled:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Time</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${slotsList}
              </td>
            </tr>

          </table>

          <p>
            If you believe this was a mistake, please contact us
            or make a new booking.
          </p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    /*
    -------------------------
    RESCHEDULED
    -------------------------
    */

    else if (status === 'rescheduled') {
      subject = 'Your TDA Pickleball Court booking has been rescheduled'

      const oldSlotsList = (oldSlots ?? [])
        .map(
          (s: { start: string; end: string }) =>
            `${formatHourShort(s.start)} - ${formatHourShort(s.end)}`
        )
        .join(', ')

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #3F6B52;">
            Booking Rescheduled
          </h2>

          <p>Hi ${name},</p>

          <p>
            Your court reservation has been moved to a new date and time:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">
                Previous
              </td>

              <td style="padding: 8px 0;">
                <s>
                  ${oldDate ?? ''} — ${oldSlotsList}
                </s>
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">
                New Date
              </td>

              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">
                New Time
              </td>

              <td style="padding: 8px 0; font-weight: bold;">
                ${slotsList}
              </td>
            </tr>

          </table>

          <p>
            If this doesn't work for you, please contact us to arrange
            another time.
          </p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    /*
    ============================================================
    OPEN PLAY CUSTOMER EMAILS
    ============================================================
    */

    else if (status === 'openplay_received') {
      subject = 'We received your Open Play request'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #3F6B52;">
            Open Play Request Received
          </h2>

          <p>Hi ${name},</p>

          <p>
            Thanks for joining! We've received your request and payment
            screenshot for:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Session</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${sessionTitle ?? ''}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Slot(s)</td>
              <td style="padding: 8px 0; font-weight: bold;">
                #${(slotNumbers ?? []).join(', #')}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Total</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ₱${totalAmount}
              </td>
            </tr>

          </table>

          <p>
            We'll verify your payment and confirm shortly.
          </p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    else if (status === 'openplay_confirmed') {
      subject = 'Your Open Play spot is confirmed!'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #3F6B52;">
            Open Play Confirmed ✅
          </h2>

          <p>Hi ${name},</p>

          <p>
            Your payment has been verified — you're in!
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Session</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${sessionTitle ?? ''}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Slot(s)</td>
              <td style="padding: 8px 0; font-weight: bold;">
                #${(slotNumbers ?? []).join(', #')}
              </td>
            </tr>

          </table>

          <p>
            See you on the court!
          </p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    else if (status === 'openplay_cancelled') {
      subject = 'Your Open Play spot was cancelled'

      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">

          <h2 style="color: #C0392B;">
            Open Play Cancelled
          </h2>

          <p>Hi ${name},</p>

          <p>
            Your spot for the following session has been cancelled:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">

            <tr>
              <td style="padding: 8px 0; color: #666;">Session</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${sessionTitle ?? ''}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 0; color: #666;">Date</td>
              <td style="padding: 8px 0; font-weight: bold;">
                ${bookingDate}
              </td>
            </tr>

          </table>

          <p>
            If you believe this was a mistake, please contact us.
          </p>

          <p style="color: #999; font-size: 12px;">
            TDA Pickleball Court
          </p>

        </div>
      `
    }

    /*
    ============================================================
    INVALID STATUS
    ============================================================
    */

    else {
      return NextResponse.json(
        { error: `Invalid status: ${status}` },
        { status: 400 }
      )
    }

    /*
    ============================================================
    SEND CUSTOMER EMAIL
    ============================================================
    */

    const result = await resend.emails.send({
      from: 'TDA Pickleball Court <noreply@tdacourt.jo3.org>',
      to: email,
      subject,
      html,
    })

    console.log('Customer email sent:', result)

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully',
    })

  } catch (err) {
    console.error('Email route error:', err)

    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
}