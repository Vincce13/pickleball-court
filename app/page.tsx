'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bebas_Neue } from 'next/font/google'
import { CalendarCheck, ShieldCheck, Clock, QrCode, ChevronDown, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'] })

const TIME_SLOTS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
]

const COURT_LAT = 10.164494873134052
const COURT_LNG = 123.71060339015708
const COURT_ADDRESS = 'Purok Sampaguita, North Poblacion, San Fernando, Cebu'

function formatHour(time: string) {
  const [h] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}${period}`
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function useInView() {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setInView(true),
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}

const FEATURES = [
  { icon: ShieldCheck, title: 'No Account Needed', desc: 'Book with just your name, email, and number.' },
  { icon: Clock, title: 'Open 6AM – 12AM', desc: 'Pick any hour, any day, back-to-back if you like.' },
  { icon: QrCode, title: 'Scan-to-Pay', desc: 'Simple QR payment, confirmed by hand, no fees.' },
  { icon: CalendarCheck, title: 'Instant Slot Check', desc: 'See real-time availability before you commit.' },
]

const PARTICLES = [
  { left: '8%', size: 10, delay: 0, duration: 22 },
  { left: '22%', size: 6, delay: 5, duration: 18 },
  { left: '40%', size: 8, delay: 2, duration: 26 },
  { left: '58%', size: 5, delay: 9, duration: 20 },
  { left: '74%', size: 9, delay: 3, duration: 24 },
  { left: '88%', size: 6, delay: 7, duration: 19 },
]

function TodayAvailability() {
  const today = new Date().toISOString().split('T')[0]
  const [takenCount, setTakenCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('bookings')
      .select('start_time')
      .eq('booking_date', today)
      .neq('status', 'cancelled')
      .then(({ data, error }) => {
        if (!error && data) {
          setTakenCount(data.length)
        }
        setLoading(false)
      })
  }, [today])

  const openCount = TIME_SLOTS.length - takenCount

  return (
    <div className="w-full max-w-sm bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl p-6 border border-[#9ED9B0]/25 shadow-[0_0_40px_-8px_rgba(158,217,176,0.35),0_20px_50px_-15px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-white/10">
        <div className="w-10 h-10 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-[#9ED9B0]" />
        </div>
        <div>
          <p className={`${bebas.className} text-2xl text-[#9ED9B0] leading-none`}>₱300 / hour</p>
          <p className="text-xs text-[#8A948E] mt-1">Flat rate, any time slot</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center shrink-0">
          <CalendarCheck className="w-5 h-5 text-[#9ED9B0]" />
        </div>
        <div>
          {loading ? (
            <p className="text-sm text-[#8A948E]">Checking today's slots...</p>
          ) : (
            <>
              <p className={`${bebas.className} text-2xl text-[#F1F2ED] leading-none`}>
                {openCount} slot{openCount === 1 ? '' : 's'} open
              </p>
              <p className="text-xs text-[#8A948E] mt-1">Available today</p>
            </>
          )}
        </div>
      </div>

      <Link
        href="/booking"
        className="block text-center w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 transition-all shadow-[0_4px_20px_-4px_rgba(158,217,176,0.6)]"
      >
        Reserve a Time
      </Link>
    </div>
  )
}

function LocationCard() {
  const [distance, setDistance] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'locating' | 'granted' | 'denied' | 'unsupported'>('idle')

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported')
      return
    }

    setStatus('locating')
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('granted')
        const d = haversineDistance(pos.coords.latitude, pos.coords.longitude, COURT_LAT, COURT_LNG)
        setDistance(d)
      },
      () => setStatus('denied'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const mapSrc = `https://www.google.com/maps?q=${COURT_LAT},${COURT_LNG}&z=16&output=embed`
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${COURT_LAT},${COURT_LNG}`

  let distanceLabel = ''
  if (distance !== null) {
    distanceLabel = distance < 1 ? Math.round(distance * 1000) + ' m' : distance.toFixed(1) + ' km'
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      <div className="relative bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md p-2 sm:p-3 rounded-xl border border-[#9ED9B0]/25 shadow-[0_0_30px_-8px_rgba(158,217,176,0.3),0_15px_40px_-15px_rgba(0,0,0,0.6)]">
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[#9ED9B0]/60 to-transparent" />
        <div className="relative aspect-[4/3] sm:aspect-[4/5] overflow-hidden rounded-lg">
          <iframe
            src={mapSrc}
            className="w-full h-full border-0"
            loading="lazy"
            title="TDA Pickleball Court location"
          />
        </div>
      </div>

      <div className="bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-xl p-5 sm:p-6 border border-[#9ED9B0]/25 shadow-[0_0_30px_-8px_rgba(158,217,176,0.3),0_15px_40px_-15px_rgba(0,0,0,0.6)] flex flex-col justify-center">
        <p className="text-xs uppercase tracking-wide text-[#8FB39B] mb-2">Find Us</p>
        <p className="text-[#F1F2ED] text-sm sm:text-base mb-5 leading-relaxed">{COURT_ADDRESS}</p>

        <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-4">
          <p className="text-xs text-[#8A948E] mb-1">Distance from you</p>
          {status === 'idle' || status === 'locating' ? (
            <p className="text-sm text-[#B9C3BC]">Detecting your location...</p>
          ) : status === 'denied' ? (
            <p className="text-sm text-[#B9C3BC]">Enable location access to see distance.</p>
          ) : status === 'unsupported' ? (
            <p className="text-sm text-[#B9C3BC]">Location not supported on this device.</p>
          ) : (
            <p className="text-2xl font-bold text-[#9ED9B0]">
              {distanceLabel}
              <span className="text-sm font-normal text-[#8A948E] ml-2">away</span>
            </p>
          )}
        </div>

        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 transition-all shadow-[0_4px_20px_-4px_rgba(158,217,176,0.6)]"
        >
          Get Directions
        </a>
      </div>
    </div>
  )
}

export default function Home() {
  const stats = useInView()
  const features = useInView()

  return (
    <main className="relative min-h-[100dvh] text-[#F1F2ED] overflow-x-hidden">
      <div className="fixed inset-0 -z-20 bg-[#0F211A]" />

      <div className="fixed -top-20 -left-20 w-96 h-96 rounded-full bg-[#3F6B52]/30 blur-[100px] -z-10 animate-blob-1" />
      <div className="fixed top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-[#9ED9B0]/15 blur-[110px] -z-10 animate-blob-2" />
      <div
        className="fixed bottom-0 left-1/4 w-80 h-80 rounded-full bg-[#3F6B52]/20 blur-[90px] -z-10 animate-blob-1"
        style={{ animationDelay: '4s' }}
      />

      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="absolute bottom-0 rounded-full bg-[#9ED9B0] animate-rise"
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          />
        ))}
      </div>

      <nav className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-8 py-4 bg-[#0F211A]/40 backdrop-blur-md">
        <span className={`${bebas.className} text-xl sm:text-2xl tracking-wide text-[#9ED9B0]`}>
          TDA COURT
        </span>
        <Link
          href="/booking"
          className="bg-[#9ED9B0] text-[#13291F] text-sm font-semibold px-4 sm:px-5 py-2 rounded-full hover:scale-105 active:scale-95 transition-transform"
        >
          Reserve
        </Link>
      </nav>

      <section className="relative flex flex-col lg:flex-row lg:items-center lg:min-h-[100dvh] px-4 sm:px-6 lg:px-16 pt-24 pb-16 lg:py-20">
        <div className="absolute inset-0 opacity-[0.1] animate-drift [background-image:linear-gradient(#ffffff_1px,transparent_1px),linear-gradient(90deg,#ffffff_1px,transparent_1px)] [background-size:64px_64px]" />

        <div className="relative z-10 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
            <p className="text-[10px] xs:text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] text-[#8FB39B] uppercase mb-4 sm:mb-6 animate-fade-up">
              Welcome to TDA · No accounts. Just play.
            </p>

            <h1
              className={`${bebas.className} text-4xl xs:text-5xl sm:text-7xl lg:text-6xl xl:text-7xl leading-[0.95] sm:leading-[0.9] tracking-wide mb-4`}
            >
              <span className="inline-block animate-fade-up" style={{ animationDelay: '0.1s' }}>TDA</span>{' '}
              <span className="inline-block text-[#9ED9B0] animate-fade-up" style={{ animationDelay: '0.25s' }}>
                PICKLEBALL
              </span>
              <br />
              <span className="inline-block animate-fade-up" style={{ animationDelay: '0.4s' }}>COURT</span>
            </h1>

            <div className="relative h-14 w-14 sm:h-20 sm:w-20 mb-4 sm:mb-6 flex items-end justify-center">
              <div className="absolute bottom-0 w-9 sm:w-12 h-1.5 sm:h-2 rounded-full bg-black/30 blur-sm" />
              <svg className="w-6 h-6 sm:w-9 sm:h-9 animate-ball" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" fill="#D9F2E0" />
                <circle cx="14" cy="12" r="1.6" fill="#8FB39B" />
                <circle cx="26" cy="12" r="1.6" fill="#8FB39B" />
                <circle cx="20" cy="20" r="1.6" fill="#8FB39B" />
                <circle cx="14" cy="28" r="1.6" fill="#8FB39B" />
                <circle cx="26" cy="28" r="1.6" fill="#8FB39B" />
              </svg>
            </div>

            <p className="text-xs sm:text-sm text-[#6B8B78] animate-fade-up" style={{ animationDelay: '0.55s' }}>
              Takes less than a minute to book
            </p>
          </div>

          <div className="flex justify-center lg:justify-end animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <TodayAvailability />
          </div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-fade-up hidden lg:block" style={{ animationDelay: '1s' }}>
          <ChevronDown className="w-6 h-6 text-[#9ED9B0] animate-bounce" />
        </div>
      </section>

      <section ref={features.ref} className="relative py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className={`bg-[#0F211A]/40 backdrop-blur-md border border-[#9ED9B0]/20 rounded-2xl p-5 sm:p-6 text-center transition-all hover:-translate-y-1 hover:border-[#9ED9B0]/50 ${
                  features.inView ? 'animate-fade-up' : 'opacity-0'
                }`}
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                <Icon className="w-7 h-7 sm:w-8 sm:h-8 text-[#9ED9B0] mx-auto mb-3" />
                <h3 className="text-sm sm:text-base font-semibold mb-1">{f.title}</h3>
                <p className="text-xs sm:text-sm text-[#B9C3BC]">{f.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section ref={stats.ref} className="relative py-12 sm:py-24 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10 text-center">
          {[
            { value: '6AM–12AM', label: 'Open Daily' },
            { value: '1', label: 'Court, Always Ready' },
            { value: '0', label: 'Accounts Needed' },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={stats.inView ? 'animate-fade-up' : 'opacity-0'}
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              <p className={`${bebas.className} text-3xl sm:text-5xl text-[#9ED9B0]`}>{stat.value}</p>
              <p className="mt-2 text-xs sm:text-sm text-[#F1F2ED] uppercase tracking-wide">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative py-12 sm:py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className={`${bebas.className} text-2xl sm:text-4xl text-center text-[#9ED9B0] mb-6 sm:mb-10`}>
            The Court
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {['/court-1.jpg', '/court-2.jpg', '/court-3.jpg'].map((src, i) => (
              <div
                key={src}
                className="group relative bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md p-2 sm:p-3 rounded-xl border border-[#9ED9B0]/25 animate-fade-up shadow-[0_0_30px_-8px_rgba(158,217,176,0.3),0_15px_40px_-15px_rgba(0,0,0,0.6)] transition-all duration-300 hover:shadow-[0_0_45px_-6px_rgba(158,217,176,0.5),0_20px_50px_-15px_rgba(0,0,0,0.6)] hover:-translate-y-1"
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[#9ED9B0]/60 to-transparent" />
                <div className="relative aspect-[4/3] sm:aspect-[4/5] overflow-hidden rounded-lg">
                  <img
                    src={src}
                    alt={`TDA Pickleball Court photo ${i + 1}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-12 sm:py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className={`${bebas.className} text-2xl sm:text-4xl text-center text-[#9ED9B0] mb-6 sm:mb-10`}>
            Find The Court
          </h2>
          <LocationCard />
        </div>
      </section>

      <section className="relative py-16 sm:py-24 px-4 sm:px-6 text-center">
        <h2 className={`${bebas.className} text-3xl sm:text-5xl text-[#9ED9B0] mb-4`}>
          Ready to Play?
        </h2>
        <p className="text-sm sm:text-base text-[#D7DAD4] mb-8">
          Grab your spot on the court in under a minute.
        </p>
        <Link
          href="/booking"
          className="inline-block bg-[#9ED9B0] text-[#13291F] font-semibold px-8 py-3 sm:px-10 sm:py-4 rounded-full text-sm sm:text-lg hover:scale-105 active:scale-95 transition-transform"
        >
          Reserve a Time
        </Link>
      </section>

      <footer className="relative text-center py-5 sm:py-8 text-xs sm:text-sm text-[#F1F2ED] px-4">
        © 2026 TDA Pickleball Court
      </footer>
    </main>
  )
}