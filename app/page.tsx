'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bebas_Neue } from 'next/font/google'
import { CalendarCheck, ShieldCheck, Clock, QrCode, ChevronDown, Wallet, Menu, X, Star, MapPin, Users, Ruler, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'] })

const TIME_SLOTS = [
  '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  
]

const COURT_LAT = 10.164887333823948
const COURT_LNG = 123.71027420056626
const COURT_ADDRESS = 'Purok Sampaguita, North Poblacion, San Fernando, Cebu'

function formatHour(time: string) {
  const [h] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}${period}`
}

// Returns "YYYY-MM-DD" using the browser's LOCAL date, not UTC.
// new Date().toISOString() always converts to UTC first, which for a
// Philippines-based site (UTC+8) reports the previous day for roughly the
// first 8 hours of each local day — this caused "today" to sometimes query
// the wrong booking_date entirely.
function getLocalDateString(date: Date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Short display label for a date picked in the schedule viewer, e.g. "Aug 20".
function formatDateLabel(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
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
  { icon: ShieldCheck, title: 'No Account Needed', desc: 'Book with just your name, email, and number.', accent: '#9ED9B0' },
  { icon: Clock, title: 'Open 6AM – 12AM', desc: 'Pick any hour, any day, back-to-back if you like.', accent: '#7FC7E8' },
  { icon: QrCode, title: 'Scan-to-Pay', desc: 'Simple QR payment, confirmed by hand, no fees.', accent: '#E8C77F' },
  { icon: CalendarCheck, title: 'Instant Slot Check', desc: 'See real-time availability before you commit.', accent: '#C79EE8' },
  { icon: Ruler, title: 'Standard Size Court', desc: 'Regulation dimensions for proper practice and play.', accent: '#F2A65A' },
  { icon: Sparkles, title: 'Silica Sand Finish', desc: 'Smooth, non-slip surface built for grip and control.', accent: '#7FD1C1' },
]

const STATS = [
  { icon: Clock, value: '6AM–12AM', label: 'Open Daily' },
  { icon: MapPin, value: '1', label: 'Court, Always Ready' },
]

const GALLERY = [
  { src: '/court-1.jpg', caption: 'Full court view' },
  { src: '/court-2.jpg', caption: 'Net close-up' },
  { src: '/court-3.jpg', caption: 'Entrance' },
]

const PARTICLES = [
  { left: '8%', size: 10, delay: 0, duration: 22 },
  { left: '22%', size: 6, delay: 5, duration: 18 },
  { left: '40%', size: 8, delay: 2, duration: 26 },
  { left: '58%', size: 5, delay: 9, duration: 20 },
  { left: '74%', size: 9, delay: 3, duration: 24 },
  { left: '88%', size: 6, delay: 7, duration: 19 },
]

function formatSlotRange(time: string) {
  const start = parseInt(time.split(':')[0])

  const end = start === 23 ? 24 : start + 1

  const format = (hour: number) => {
    if (hour === 24) return '12 AM'

    const period = hour >= 12 ? 'PM' : 'AM'
    const h = hour % 12 === 0 ? 12 : hour % 12

    return `${h} ${period}`
  }

  return `${format(start)} - ${format(end)}`
}

type SlotStatus = 'available' | 'booked' | 'past' | 'blocked' | 'openplay'

function TodayAvailability() {
  // `actualToday` tracks the real current date and rolls over automatically
  // (see the interval effect below). `selectedDate` is whatever date the
  // schedule is showing — it starts out following actualToday, but once the
  // customer manually picks a different date, it stops auto-following so
  // browsing tomorrow's slots doesn't get yanked back to today at midnight.
  const [actualToday, setActualToday] = useState(() => getLocalDateString())
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString())
  const [followingToday, setFollowingToday] = useState(true)

  const [loading, setLoading] = useState(true)
  const [slotStatuses, setSlotStatuses] = useState<{ slot: string; status: SlotStatus }[]>([])
  const [showSchedule, setShowSchedule] = useState(false)

  // Keep "actualToday" correct even if the tab is left open across local
  // midnight — otherwise a visitor browsing at 11:59 PM would keep seeing
  // yesterday's date until they refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      const current = getLocalDateString()
      setActualToday((prev) => (prev === current ? prev : current))
    }, 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // If the customer hasn't manually picked a date, keep the view pinned to
  // whatever day it actually is (so it still rolls over at midnight).
  useEffect(() => {
    if (followingToday) setSelectedDate(actualToday)
  }, [actualToday, followingToday])

  function handleDateChange(newDate: string) {
    setSelectedDate(newDate)
    setFollowingToday(newDate === actualToday)
  }

  useEffect(() => {
  let cancelled = false

  setLoading(true)

  function addOneHourLocal(time: string) {
    const [h, m] = time.split(':').map(Number)
    return `${((h + 1) % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  function expandRange(start: string, end: string) {
    const hours: string[] = []
    let current = start.slice(0, 5)
    const stop = end.slice(0, 5)
    let guard = 0
    while (current !== stop && guard < 24) {
      hours.push(current)
      current = addOneHourLocal(current)
      guard++
    }
    return hours
  }

  Promise.all([
    supabase
      .from('bookings')
      .select('start_time')
      .eq('booking_date', selectedDate)
      .neq('status', 'cancelled'),
    supabase
      .from('blocked_slots')
      .select('start_time, end_time')
      .eq('booking_date', selectedDate),
    supabase
      .from('open_play_sessions')
      .select('start_time, end_time')
      .eq('session_date', selectedDate)
      .eq('status', 'active'),
  ]).then(([bookingsRes, blockedRes, openPlayRes]) => {
    if (cancelled) return

    const bookedSlots = (bookingsRes.data ?? []).map((b) => b.start_time.slice(0, 5))

    const blockedHours = new Set<string>()
    ;(blockedRes.data ?? []).forEach((b) => {
      expandRange(b.start_time, b.end_time).forEach((h) => blockedHours.add(h))
    })

    const openPlayHours = new Set<string>()
    ;(openPlayRes.data ?? []).forEach((s) => {
      expandRange(s.start_time, s.end_time).forEach((h) => openPlayHours.add(h))
    })

    const now = new Date()
    const isViewingToday = getLocalDateString(now) === selectedDate
    const currentHour = now.getHours()

    const statuses: { slot: string; status: SlotStatus }[] = TIME_SLOTS.map((slot) => {
      const slotHour = Number(slot.split(':')[0])
      if (bookedSlots.includes(slot)) return { slot, status: 'booked' }
      if (openPlayHours.has(slot)) return { slot, status: 'openplay' }
      if (blockedHours.has(slot)) return { slot, status: 'blocked' }
      if (isViewingToday && slotHour < currentHour) return { slot, status: 'past' }
      return { slot, status: 'available' }
    })

    setSlotStatuses(statuses)
    setLoading(false)
  })

  return () => {
    cancelled = true
  }
}, [selectedDate])

  const availableCount = slotStatuses.filter((s) => s.status === 'available').length
  const isViewingToday = selectedDate === actualToday

  return (
    <div className="w-full max-w-sm bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl p-6 border border-[#9ED9B0]/25 shadow-[0_0_40px_-8px_rgba(158,217,176,0.35),0_20px_50px_-15px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-white/10">
        <div className="w-10 h-10 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-[#9ED9B0]" />
        </div>
        <div>
          <p className={`${bebas.className} text-2xl text-[#9ED9B0] leading-none`}>₱200 / HOUR </p>
          <p className="text-xs text-[#8A948E] mt-1"> Monday–Sunday flat ₱200</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center shrink-0">
          <CalendarCheck className="w-5 h-5 text-[#9ED9B0]" />
        </div>
        <div>
          {loading ? (
            <p className="text-sm text-[#8A948E]">Checking slot availability...</p>
          ) : (
            <>
              <p className={`${bebas.className} text-2xl text-[#F1F2ED] leading-none`}>
                {availableCount} slot{availableCount === 1 ? '' : 's'} open
              </p>
              <p className="text-xs text-[#8A948E] mt-1">
                Available {isViewingToday ? 'today' : `on ${formatDateLabel(selectedDate)}`}
              </p>
            </>
          )}
        </div>
      </div>

      {!loading && (
        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wide text-[#8FB39B] hover:text-[#9ED9B0] transition-colors py-1"
          >
            <span>{showSchedule ? 'Hide' : 'View'} Schedule</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-300 ${showSchedule ? 'rotate-180' : ''}`}
            />
          </button>

          {showSchedule && (
            <div className="mt-3 animate-fade-up">
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="date"
                  min={actualToday}
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] text-xs [color-scheme:dark] outline-none focus:border-[#9ED9B0]"
                />
                {!isViewingToday && (
                  <button
                    type="button"
                    onClick={() => handleDateChange(actualToday)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[#9ED9B0]/10 hover:bg-[#9ED9B0]/20 text-[#9ED9B0] text-xs font-medium transition-colors"
                  >
                    Today
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {slotStatuses.map(({ slot, status }) => (
                  <span
                    key={slot}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      status === 'available'
                        ? 'bg-green-500/10 border-green-500/30 text-[#9ED9B0]'
                        : status === 'booked'
                        ? 'bg-red-500/10 border-red-500/30 text-red-300 line-through'
                        : 'bg-white/5 border-white/10 text-[#5A645E]'
                    }`}
                  >
                    {formatSlotRange(slot)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
  const [mobileMenu, setMobileMenu] = useState(false)
  const [totalBookings, setTotalBookings] = useState<number | null>(null)
  const [selectedImage, setSelectedImage] = useState<{ src: string; caption: string } | null>(null)
  const [openPlayCount, setOpenPlayCount] = useState(0)


  useEffect(() => {
  supabase
    .from('open_play_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('session_date', new Date().toISOString().split('T')[0])
    .then(({ count }) => {
      setOpenPlayCount(count ?? 0)
    })
}, [])

  useEffect(() => {
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'cancelled')
      .then(({ count }) => {
        if (typeof count === 'number') setTotalBookings(count)
      })
  }, [])

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

      <nav className="fixed top-0 inset-x-0 z-50 bg-[#0F211A]/70 backdrop-blur-xl border-b border-[#9ED9B0]/10">
        <div className="max-w-7xl mx-auto h-16 sm:h-20 lg:h-24 px-4 sm:px-6 flex items-center justify-between">

          <Link href="/" className="flex items-center gap-4 group">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#9ED9B0]/40 blur-3xl scale-150 animate-pulse" />
              <img
                src="/logo.png"
                alt="TDA Court"
                className="
                  relative
                  h-10
                  sm:h-14
                  lg:h-20
                  w-auto
                  object-contain
                  drop-shadow-[0_0_25px_rgba(158,217,176,0.9)]
                  transition-all
                  duration-500
                  group-hover:scale-110
                  group-hover:rotate-2
                "
              />
            </div>

            <div className="block">
              <h1 className={`${bebas.className} text-2xl sm:text-3xl lg:text-4xl tracking-wider text-[#9ED9B0] leading-none`}>
                TDA COURT
              </h1>
            </div>
          </Link>
<div className="hidden lg:flex items-center gap-10 font-medium text-[#D9E7DD]">
  <a href="#why" className="hover:text-[#9ED9B0] transition duration-300">Why Us</a>
  <a href="#features" className="hover:text-[#9ED9B0] transition duration-300">Features</a>
 <Link href="/open-play" className="relative hover:text-[#9ED9B0] transition duration-300">
  Open Play
  {openPlayCount > 0 && (
    <span className="absolute -top-2 -right-3 w-4 h-4 rounded-full bg-yellow-400 text-[9px] text-[#13291F] font-bold flex items-center justify-center">
      {openPlayCount}
    </span>
  )}
</Link>
  <a href="#gallery" className="hover:text-[#9ED9B0] transition duration-300">Gallery</a>
  <a href="#location" className="hover:text-[#9ED9B0] transition duration-300">Location</a>
</div>
          <Link
            href="/booking"
            className="hidden lg:flex items-center px-7 py-3 rounded-full bg-[#9ED9B0] text-[#13291F] font-semibold shadow-[0_0_20px_rgba(158,217,176,0.5)] hover:scale-105 transition-all"
          >
            Reserve
          </Link>

         <button
  onClick={() => setMobileMenu(!mobileMenu)}
  className="relative lg:hidden text-[#9ED9B0]"
>
  {mobileMenu ? <X size={30} /> : <Menu size={30} />}
  {!mobileMenu && openPlayCount > 0 && (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-400 text-[9px] text-[#13291F] font-bold flex items-center justify-center">
      {openPlayCount}
    </span>
  )}
</button>
        </div>
      </nav>

     {mobileMenu && (
  <div className="lg:hidden fixed top-24 left-4 right-4 z-40 rounded-2xl bg-[#0F211A]/95 backdrop-blur-xl border border-[#9ED9B0]/10 shadow-2xl overflow-hidden">
    <a href="#why" onClick={() => setMobileMenu(false)} className="block px-6 py-4 border-b border-white/10 hover:bg-white/5">Why Us</a>
    <a href="#features" onClick={() => setMobileMenu(false)} className="block px-6 py-4 border-b border-white/10 hover:bg-white/5">Features</a>
  <Link href="/open-play" onClick={() => setMobileMenu(false)} className="flex items-center justify-between px-6 py-4 border-b border-white/10 hover:bg-white/5">
  Open Play
  {openPlayCount > 0 && (
    <span className="w-5 h-5 rounded-full bg-yellow-400 text-[10px] text-[#13291F] font-bold flex items-center justify-center">
      {openPlayCount}
    </span>
  )}
</Link>
    <a href="#gallery" onClick={() => setMobileMenu(false)} className="block px-6 py-4 border-b border-white/10 hover:bg-white/5">Gallery</a>
    <a href="#location" onClick={() => setMobileMenu(false)} className="block px-6 py-4 border-b border-white/10 hover:bg-white/5">Location</a>
  </div>
)}

      <section className="relative flex flex-col lg:flex-row lg:items-center lg:min-h-[100dvh] px-4 sm:px-6 lg:px-16 pt-36 pb-16 lg:pt-40 lg:pb-20">
        <div className="absolute inset-0 opacity-[0.1] animate-drift [background-image:linear-gradient(#ffffff_1px,transparent_1px),linear-gradient(90deg,#ffffff_1px,transparent_1px)] [background-size:64px_64px]" />

        <div className="relative z-10 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
            <p className="text-[10px] xs:text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] text-[#8FB39B] uppercase mb-4 sm:mb-6 animate-fade-up">
              Welcome to TDA · No accounts. Just play.
            </p>

            <h1 className={`${bebas.className} text-4xl xs:text-5xl sm:text-7xl lg:text-6xl xl:text-7xl leading-[0.95] sm:leading-[0.9] tracking-wide mb-4`}>
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

            <p className="text-xs sm:text-sm text-[#6B8B78] animate-fade-up mb-5" style={{ animationDelay: '0.55s' }}>
              Takes less than a minute to book
            </p>

            {/* Trust row */}
            <div
              className="flex items-center gap-4 animate-fade-up"
              style={{ animationDelay: '0.65s' }}
            >
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-[#9ED9B0] text-[#9ED9B0]" />
                ))}
              </div>
              <span className="text-xs text-[#8A948E]">Trusted by local players every week</span>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <TodayAvailability />
          </div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-fade-up hidden lg:block" style={{ animationDelay: '1s' }}>
          <ChevronDown className="w-6 h-6 text-[#9ED9B0] animate-bounce" />
        </div>
      </section>


        <section id="why" ref={stats.ref} className="relative py-12 sm:py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-10 sm:mb-14">
          <h2 className={`${bebas.className} text-2xl sm:text-4xl text-[#9ED9B0] mb-3 sm:mb-4`}>
            Why Players Choose TDA
          </h2>
          <p className="text-sm sm:text-base text-[#B9C3BC] leading-relaxed">
            Right in the heart of San Fernando, easy to find and even easier to book — no app,
            no account, just pick a time and show up. Spacious parking so you're never scrambling
            for a spot, and a homey, laid-back vibe that makes every game feel like playing at
            a friend's backyard court.
          </p>
        </div>
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10 text-center">
          {STATS.map((stat, i) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                className={stats.inView ? 'animate-fade-up' : 'opacity-0'}
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <Icon className="w-5 h-5 text-[#9ED9B0]/70 mx-auto mb-2" />
                <p className={`${bebas.className} text-3xl sm:text-5xl text-[#9ED9B0]`}>{stat.value}</p>
                <p className="mt-2 text-xs sm:text-sm text-[#F1F2ED] uppercase tracking-wide">{stat.label}</p>
              </div>
            )
          })}
          <div
            className={stats.inView ? 'animate-fade-up' : 'opacity-0'}
            style={{ animationDelay: `${STATS.length * 0.15}s` }}
          >
            <Users className="w-5 h-5 text-[#9ED9B0]/70 mx-auto mb-2" />
            <p className={`${bebas.className} text-3xl sm:text-5xl text-[#9ED9B0]`}>
              {totalBookings === null ? '—' : totalBookings}
            </p>
            <p className="mt-2 text-xs sm:text-sm text-[#F1F2ED] uppercase tracking-wide">Bookings Made</p>
          </div>
        </div>
      </section>  

      <section id="features" ref={features.ref} className="relative py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className={`relative bg-[#0F211A]/40 backdrop-blur-md border border-[#9ED9B0]/20 rounded-2xl p-5 sm:p-6 text-center transition-all hover:-translate-y-1 overflow-hidden ${
                  features.inView ? 'animate-fade-up' : 'opacity-0'
                }`}
                style={{ animationDelay: `${i * 0.12}s`, borderTopColor: f.accent, borderTopWidth: '3px' }}
              >
                <div
                  className="absolute -top-6 -right-6 w-16 h-16 rounded-full blur-2xl opacity-30"
                  style={{ backgroundColor: f.accent }}
                />
                <Icon className="w-7 h-7 sm:w-8 sm:h-8 mx-auto mb-3 relative" style={{ color: f.accent }} />
                <h3 className="text-sm sm:text-base font-semibold mb-1 relative">{f.title}</h3>
                <p className="text-xs sm:text-sm text-[#B9C3BC] relative">{f.desc}</p>
              </div>
            )
          })}
        </div>
      </section>



      <section id="gallery" className="relative py-12 sm:py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className={`${bebas.className} text-2xl sm:text-4xl text-center text-[#9ED9B0] mb-6 sm:mb-10`}>
            The Court
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {GALLERY.map((item, i) => (
              <div
                key={item.src}
                onClick={() => setSelectedImage(item)}
                className="group relative bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md p-2 sm:p-3 rounded-xl border border-[#9ED9B0]/25 animate-fade-up shadow-[0_0_30px_-8px_rgba(158,217,176,0.3),0_15px_40px_-15px_rgba(0,0,0,0.6)] transition-all duration-300 hover:shadow-[0_0_45px_-6px_rgba(158,217,176,0.5),0_20px_50px_-15px_rgba(0,0,0,0.6)] hover:-translate-y-1 cursor-pointer"
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[#9ED9B0]/60 to-transparent" />
                <div className="relative aspect-[4/3] sm:aspect-[4/5] overflow-hidden rounded-lg">
                  <img
                    src={item.src}
                    alt={item.caption}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                    <p className="text-sm font-medium text-white">{item.caption}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4 py-8 animate-fade-up"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#F1F2ED] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="max-w-4xl max-h-[85vh] w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={selectedImage.src}
              alt={selectedImage.caption}
              className="w-full h-full max-h-[75vh] object-contain rounded-lg"
            />
            <p className="text-center text-[#D7DAD4] mt-4 text-sm sm:text-base">{selectedImage.caption}</p>
          </div>
        </div>
      )}

      <section id="location" className="relative py-12 sm:py-24 px-4 sm:px-6">
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

      {/* Mobile Floating Reserve Button */}
<div className="fixed bottom-5 left-0 right-0 z-50 flex justify-center lg:hidden">
  <Link
    href="/booking"
    className="
      bg-[#9ED9B0]
      text-[#13291F]
      font-bold
      px-8
      py-3.5
      rounded-full
      shadow-[0_0_25px_rgba(158,217,176,0.55)]
      border border-white/20
      active:scale-95
      transition-all
      animate-pulse
    "
  >
    Reserve Now
  </Link>
</div>

      <footer className="relative text-center py-5 sm:py-8 text-xs sm:text-sm text-[#F1F2ED] px-4">
        © 2026 TDA Pickleball Court
      </footer>
    </main>
  )
}