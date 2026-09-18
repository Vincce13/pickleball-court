'use client'

import Link from 'next/link'
import { Bebas_Neue } from 'next/font/google'
import BookingForm from '@/components/BookingForm'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'] })

export default function BookingPage() {
   const [showPolicy, setShowPolicy] = useState(true)

  const router = useRouter()
const [releaseHolds, setReleaseHolds] = useState<(() => Promise<void>) | null>(null)

  return (
    <main className="relative min-h-[100dvh] text-[#F1F2ED] overflow-x-hidden bg-[#13291F]">
      {/* Static ambient background, no video */}
      <div className="fixed inset-0 opacity-[0.07] [background-image:linear-gradient(#ffffff_1px,transparent_1px),linear-gradient(90deg,#ffffff_1px,transparent_1px)] [background-size:64px_64px] -z-10" />

      {/* Nav bar */}
      <nav className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-8 py-4 bg-[#0F211A]/40 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2 sm:gap-3">
          <img
            src="/logo.png"
            alt="TDA Court"
            className="h-8 sm:h-10 w-auto object-contain drop-shadow-[0_0_15px_rgba(158,217,176,0.6)]"
          />
          <span className={`${bebas.className} text-xl sm:text-2xl tracking-wide text-[#9ED9B0]`}>
            TDA COURT
          </span>
        </Link>
        <button
  onClick={async () => {
    if (releaseHolds) await releaseHolds()
    router.push('/')
  }}
  className="text-xs sm:text-sm text-[#D7DAD4] hover:text-[#9ED9B0] transition-colors"
>
  ← Back Home
</button>
      </nav>

      <div className="relative z-10 px-4 sm:px-6 pt-28 pb-16 sm:pt-32 sm:pb-24">
        <div className="text-center mb-8">
          <h1
            className={`${bebas.className} text-4xl sm:text-5xl text-[#9ED9B0] tracking-wide`}
          >
            RESERVE YOUR SLOT
          </h1>
          <p className="text-sm text-[#D7DAD4] mt-2">
            Three quick steps. No account needed.
          </p>
        </div>

       <BookingForm onNavigateAway={(release) => setReleaseHolds(() => release)} />
      </div>

     {showPolicy && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#13291F] border border-[#9ED9B0]/25 rounded-2xl p-6 shadow-[0_0_40px_-8px_rgba(158,217,176,0.35)]">
            <h2 className={`${bebas.className} text-2xl text-[#9ED9B0] mb-4`}>Reservation Policy</h2>

           <div className="space-y-3 text-sm text-[#D7DAD4] mb-6">
  <p>
    <strong className="text-[#F1F2ED]">Payment:</strong> Full payment is required at the time of booking via QR scan. Bookings are held for review until payment is verified.
  </p>
  <p>
    <strong className="text-[#F1F2ED]">Confirmation:</strong> Your slot is not guaranteed until an admin confirms your payment. You'll receive an email once confirmed.
  </p>
  <p>
    <strong className="text-[#F1F2ED]">Refunds & Rescheduling:</strong> Refunds and rescheduling are only offered in cases of{' '}
    <strong className="text-[#F1F2ED]">weather interruptions</strong> or{' '}
    <strong className="text-[#F1F2ED]">power interruptions occurring at night</strong>. Refunds, when applicable, are prorated based on the unused portion of your booking.
  </p>
  <p>
    <strong className="text-[#F1F2ED]">No-shows:</strong> Failure to show up on your scheduled time — for any reason outside the two exceptions above — is{' '}
    <strong className="text-[#F1F2ED]">non-refundable</strong>. No exceptions apply beyond weather or nighttime power interruptions.
  </p>
  <p>
    <strong className="text-[#F1F2ED]">Slot holds:</strong> Selected time slots are reserved for 5 minutes to complete your booking. Unfinished bookings are released automatically.
  </p>
</div>

            <button
              onClick={() => setShowPolicy(false)}
              className="w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 transition-all"
            >
              I Understand, Continue
            </button>
          </div>
        </div>
      )}
    </main>
  )
}