'use client'

import Link from 'next/link'
import { Bebas_Neue } from 'next/font/google'
import BookingForm from '@/components/BookingForm'

const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'] })

export default function BookingPage() {
  return (
    <main className="relative min-h-[100dvh] text-[#F1F2ED] overflow-x-hidden bg-[#13291F]">
      {/* Static ambient background, no video */}
      <div className="fixed inset-0 opacity-[0.07] [background-image:linear-gradient(#ffffff_1px,transparent_1px),linear-gradient(90deg,#ffffff_1px,transparent_1px)] [background-size:64px_64px] -z-10" />

      {/* Nav bar */}
      <nav className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-8 py-4 bg-[#0F211A]/40 backdrop-blur-md">
        <Link href="/" className={`${bebas.className} text-xl sm:text-2xl tracking-wide text-[#9ED9B0]`}>
          TDA COURT
        </Link>
        <Link
          href="/"
          className="text-xs sm:text-sm text-[#D7DAD4] hover:text-[#9ED9B0] transition-colors"
        >
          ← Back Home
        </Link>
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

        <BookingForm />
      </div>
    </main>
  )
}