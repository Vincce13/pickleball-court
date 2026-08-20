'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { User, Mail, Phone, Calendar, QrCode, CheckCircle2, PartyPopper, ImageUp, Lock } from 'lucide-react'

const TIME_SLOTS = [
  '05:00',
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  
]

// Flat rate: ₱200/hr, every day of the week, 5AM-12AM. There's no more
// weekday/weekend or peak/off-peak split — every slot in TIME_SLOTS costs
// the same, EXCEPT parties/events/gatherings, which are ₱250/hr instead.
const HOURLY_PRICE = 200
const EVENT_PRICE = 250
const HOLD_MINUTES = 5

type BookingType = 'regular' | 'event'

function getSlotPrice(slot: string, dateStr: string, bookingType: BookingType) {
  return bookingType === 'event' ? EVENT_PRICE : HOURLY_PRICE
}

const SESSION_ID_KEY = 'tda_booking_session_id'

// Stable per-tab session id, persisted across refreshes. Previously this was
// `useRef(crypto.randomUUID()).current`, which mints a brand-new random id
// on every page load. Kept persisted here even though the flow no longer
// resumes across a refresh — it's what lets a customer's OWN still-active
// hold be correctly recognized and reclaimed in the rare case the
// release-on-unload paths below don't get to complete before a hold's TTL
// would otherwise block them.
function getOrCreateSessionId() {
  if (typeof window === 'undefined') return crypto.randomUUID()
  const existing = window.sessionStorage.getItem(SESSION_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  window.sessionStorage.setItem(SESSION_ID_KEY, id)
  return id
}

function formatHour(time: string) {
  const [h] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}${period}`
}

function formatSlotRange(time: string) {
  const [h, m] = time.split(':').map(Number)
  const endHour = (h + 1) % 24
  const endTime = `${endHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  return `${formatHour(time)} - ${formatHour(endTime)}`
}

function addOneHour(time: string) {
  const [h, m] = time.split(':').map(Number)
  return `${((h + 1) % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

// Returns "YYYY-MM-DD" using the browser's LOCAL date, not UTC. Using
// toISOString() directly (as the date input's `min` used to) reports the
// previous day for part of the morning in UTC+8 timezones like the
// Philippines, which caused subtle off-by-one-day bugs.
function getLocalDateString(date: Date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}





function IconCircle({ Icon }: { Icon: typeof User }) {
  return (
    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center">
      <Icon className="w-3.5 h-3.5 text-[#9ED9B0]" />
    </div>
  )
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default function BookingForm({ onNavigateAway }: { onNavigateAway?: (release: () => Promise<void>) => void }) {
  const [step, setStep] = useState(1)
  const [sessionId] = useState(getOrCreateSessionId)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const [bookingDate, setBookingDate] = useState('')
  const [selectedSlots, setSelectedSlots] = useState<string[]>([])
  const [takenSlots, setTakenSlots] = useState<string[]>([])
  const [heldByOthers, setHeldByOthers] = useState<string[]>([])
  const [blockedSlots, setBlockedSlots] = useState<string[]>([])
  const [blockedInfo, setBlockedInfo] = useState<Record<string, string>>({})
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [conflictNotice, setConflictNotice] = useState<string | null>(null)
  const [holdError, setHoldError] = useState<string | null>(null)
const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [checkingEmail, setCheckingEmail] = useState(false)
const [phoneError, setPhoneError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [poppedSlot, setPoppedSlot] = useState<string | null>(null)
  // Asked in Step 1, required before moving to Step 2 — null (not yet
  // answered) is intentional so the customer has to make an explicit choice
  // rather than silently defaulting to the cheaper "regular" rate.
  const [bookingType, setBookingType] = useState<BookingType | null>(null)
  const [confirmedBooking, setConfirmedBooking] = useState<{
    date: string
    slots: string[]
    total: number
    phone: string
    email: string
    bookingType: BookingType
  } | null>(null)

  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)

  const totalAmount = selectedSlots.reduce(
    (sum, slot) => sum + getSlotPrice(slot, bookingDate, bookingType ?? 'regular'),
    0
  )

  const today = getLocalDateString()
  const isBookingToday = bookingDate === today
  const [openPlaySlots, setOpenPlaySlots] = useState<string[]>([])

  function isPastSlot(slot: string) {
    if (!isBookingToday) return false
    const slotHour = Number(slot.split(':')[0])
    return slotHour < new Date().getHours()
  }

  // Re-fetches the currently active holds for `bookingDate` and rebuilds
  // heldByOthers from scratch. Used both for the initial/date-change load
  // below AND as the realtime refresh trigger — refetching rather than
  // patching state from a postgres_changes payload sidesteps needing
  // REPLICA IDENTITY FULL on slot_holds, and correctly handles UPDATE (a
  // reclaimed hold) too, not just INSERT/DELETE.
  async function refreshHeldSlots() {
    const { data: holdsData } = await supabase
      .from('slot_holds')
      .select('start_time, session_id, expires_at')
      .eq('booking_date', bookingDate)
      .gt('expires_at', new Date().toISOString())

    setHeldByOthers(
      (holdsData ?? [])
        .filter((h) => h.session_id !== sessionId)
        .map((h) => h.start_time.slice(0, 5))
    )
  }

  // Fetch actual bookings + active holds whenever the date changes
useEffect(() => {
  if (!bookingDate) return
  setLoadingSlots(true)
  setConflictNotice(null)
  setHeldByOthers([])
  setSelectedSlots([])

    async function load() {
      const { data: bookingsData } = await supabase
        .from('bookings')
        .select('start_time')
        .eq('booking_date', bookingDate)
        .neq('status', 'cancelled')

     const { data: blockedData } = await supabase
  .from('blocked_slots')
  .select('start_time, end_time, reason')
  .eq('booking_date', bookingDate)

        const { data: openPlayData } = await supabase
  .from('open_play_sessions')
  .select('start_time, end_time')
  .eq('session_date', bookingDate)
  .eq('status', 'active')

      setTakenSlots(
        (bookingsData ?? []).map((b) => b.start_time.slice(0, 5))
      )

      const expandedBlockedHours: string[] = []
const reasonMap: Record<string, string> = {}

;(blockedData ?? []).forEach((b) => {
  const start = b.start_time.slice(0, 5)
  const end = b.end_time.slice(0, 5)
  let current = start
  let guard = 0
  while (current !== end && guard < 24) {
    expandedBlockedHours.push(current)
    reasonMap[current] = b.reason
    current = addOneHour(current)
    guard++
  }
})

setBlockedSlots(expandedBlockedHours)
setBlockedInfo(reasonMap)

      const openPlayHours: string[] = []
;(openPlayData ?? []).forEach((session) => {
  const start = session.start_time.slice(0, 5)
  const end = session.end_time.slice(0, 5)
  let current = start
  let guard = 0
  while (current !== end && guard < 24) {
    openPlayHours.push(current)
    current = addOneHour(current)
    guard++
  }
})
setOpenPlaySlots(openPlayHours)

      await refreshHeldSlots()
      setLoadingSlots(false)
    }

    load()
  }, [bookingDate])

  // Realtime: bookings (actual confirmations) and slot_holds (temporary reservations)
  useEffect(() => {
    if (!bookingDate) return

    const channel = supabase
      .channel(`slots-${bookingDate}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings', filter: `booking_date=eq.${bookingDate}` },
        (payload) => {
          if (payload.new.group_id && payload.new.group_id === lastGroupId.current) return
          const takenSlot = (payload.new.start_time as string).slice(0, 5)
          setTakenSlots((prev) => (prev.includes(takenSlot) ? prev : [...prev, takenSlot]))
          setSelectedSlots((prev) => {
            if (prev.includes(takenSlot)) {
              setConflictNotice(`Heads up — ${formatSlotRange(takenSlot)} was just booked by someone else and removed from your selection.`)
              return prev.filter((s) => s !== takenSlot)
            }
            return prev
          })
        }
      )
      .on(
        // A single wildcard listener rather than separate INSERT/DELETE
        // handlers: INSERT (new hold), UPDATE (a hold reclaimed via
        // tryHoldSlot's fallback path), and DELETE (released/expired hold)
        // all just trigger a fresh refetch instead of trying to patch state
        // from the event payload. DELETE payloads only include `start_time`
        // in `payload.old` if the table has REPLICA IDENTITY FULL set,
        // which isn't something this client code can guarantee — refetching
        // sidesteps that entirely, and also picks up reclaimed (UPDATE)
        // holds, which a plain INSERT/DELETE-only subscription would miss.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_holds', filter: `booking_date=eq.${bookingDate}` },
        () => {
          refreshHeldSlots()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [bookingDate, sessionId])

  // Release all of this session's holds when leaving the page/tab via an
  // actual browser-level unload (closing the tab, refreshing, typing a new
  // URL). `fetch` with `keepalive: true` is used rather than
  // `navigator.sendBeacon(...)` — sendBeacon can only send a POST with no
  // custom headers, and Supabase's REST API requires `apikey`/`Authorization`
  // headers plus an actual DELETE method, so sendBeacon could never actually
  // delete anything here.
  //
  // NOTE: `beforeunload` does NOT fire for client-side route changes within
  // the app (e.g. clicking a "Home" link/button) — the page never actually
  // unloads for those, it's just React unmounting this component. That case
  // is covered separately below by the plain component-unmount effect.
  useEffect(() => {
    function releaseOnUnload() {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!anonKey || !supabaseUrl) return
      fetch(`${supabaseUrl}/rest/v1/slot_holds?session_id=eq.${sessionId}`, {
        method: 'DELETE',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', releaseOnUnload)
    return () => window.removeEventListener('beforeunload', releaseOnUnload)
  }, [sessionId])

  // Silent auto-reset: checks once a second whether the hold window has expired
  useEffect(() => {
    if (!holdExpiresAt) return

    const interval = setInterval(() => {
      if (Date.now() >= holdExpiresAt) {
        clearInterval(interval)
        resetBookingFlow()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [holdExpiresAt])

  async function releaseHold(slot: string) {
    await supabase
      .from('slot_holds')
      .delete()
      .eq('booking_date', bookingDate)
      .eq('start_time', slot)
      .eq('session_id', sessionId)
  }

  async function releaseAllMyHolds() {
    await supabase.from('slot_holds').delete().eq('session_id', sessionId)
  }

  // Hands the release function up to a parent that wants to call it BEFORE
  // navigating away (e.g. a "Home" link that awaits this, then routes) — but
  // that only works if the parent is actually wired to call it, which this
  // component has no way to guarantee.
  useEffect(() => {
    onNavigateAway?.(releaseAllMyHolds)
  }, [])

  // This is the part that actually fixes "click Home while on Step 2/3
  // leaves the schedule held": a plain unmount cleanup fires no matter WHY
  // BookingForm unmounts — including a client-side route change to another
  // page — unlike `beforeunload` above, which only fires on a real page
  // unload. This doesn't depend on any parent component cooperating.
  useEffect(() => {
    return () => {
      releaseAllMyHolds()
    }
  }, [])

  async function resetBookingFlow() {
    await releaseAllMyHolds()
    setSelectedSlots([])
    setBookingDate('')
    setHoldExpiresAt(null)
    setProofFile(null)
    setProofPreview(null)
    setError('')
    setHoldError(`Your held slots expired after ${HOLD_MINUTES} minutes. Please choose your time again.`)
    setStep(1)
  }

  async function tryHoldSlot(slot: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()

  const { error: insertErr } = await supabase.from('slot_holds').insert({
    booking_date: bookingDate,
    start_time: slot,
    session_id: sessionId,
    expires_at: expiresAt,
  })

  if (!insertErr) return true

  const { data: existing } = await supabase
    .from('slot_holds')
    .select('session_id, expires_at')
    .eq('booking_date', bookingDate)
    .eq('start_time', slot)
    .single()

  // Either it's already expired, OR it's actually this same customer's own
  // leftover hold (e.g. from clicking Back before the delete fully synced) —
  // in both cases, it's safe to take over rather than block them.
  const isMine = existing?.session_id === sessionId
  const isExpired = existing && new Date(existing.expires_at) < new Date()

  if (existing && (isMine || isExpired)) {
    await supabase
      .from('slot_holds')
      .update({ session_id: sessionId, expires_at: expiresAt })
      .eq('booking_date', bookingDate)
      .eq('start_time', slot)
    return true
  }

  return false
}

 async function goToStep2(e: React.FormEvent) {
  e.preventDefault()

  if (!isValidEmail(email)) {
    setError('Please enter a valid email address.')
    return
  }
  

  const suggestion = suggestEmailCorrection(email)
  if (suggestion) {
    setError(`That email looks like a typo. Did you mean ${suggestion}?`)
    return
  }

  if (phone.length !== 11) {
  setPhoneError('Please enter a valid 11-digit mobile number.')
  return
}
setPhoneError('')

  if (!bookingType) {
    setError('Please let us know if this is a regular play or a party/event/gathering.')
    return
  }

  setCheckingEmail(true)
  
  setError('')
  


  try {
    const res = await fetch('/api/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()

    if (!data.valid) {
      setError('This email domain doesn\'t appear to be able to receive emails. Please double-check it.')
      setCheckingEmail(false)
      return
    }
    
  } catch {
    // If the check itself fails (network issue), don't block the customer —
    // fail open rather than trap them on a working email due to our own error
  }
  

  setCheckingEmail(false)
  setStep(2)

  
}


  function goToStep3() {
    if (!bookingDate || selectedSlots.length === 0) return
    setStep(3)
  }

  async function toggleSlot(slot: string) {
    setHoldError(null)

    // A slot whose hour has already gone by today can never be booked —
    // explain why instead of silently doing nothing, so customers don't
    // wonder why it won't select.
    if (isPastSlot(slot)) {
      setHoldError(`${formatSlotRange(slot)} has already passed today. Please choose an upcoming time.`)
      return
    }

    if (selectedSlots.includes(slot)) {
      const updated = selectedSlots.filter((s) => s !== slot)
      setSelectedSlots(updated)
      releaseHold(slot)
      if (updated.length === 0) {
        setHoldExpiresAt(null)
      }
      return
    }

    setPoppedSlot(slot)
    setTimeout(() => setPoppedSlot(null), 250)

    const success = await tryHoldSlot(slot)
    if (!success) {
      setHoldError(`${formatSlotRange(slot)} is currently being held by another customer. Try again in a few minutes.`)
      setHeldByOthers((prev) => (prev.includes(slot) ? prev : [...prev, slot]))
      return
    }

    const wasEmpty = selectedSlots.length === 0
    setSelectedSlots((prev) => [...prev, slot].sort())

    if (wasEmpty) {
      setHoldExpiresAt(Date.now() + HOLD_MINUTES * 60 * 1000)
    }
  }

  function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

  const lastGroupId = useRef<string | null>(null)

  async function handleConfirmBooking() {
    if (!proofFile) {
      setError('Please attach a screenshot of your payment before confirming.')
      return
    }

    setSubmitting(true)
    setError('')

    const { data: existing } = await supabase
      .from('bookings')
      .select('start_time')
      .eq('booking_date', bookingDate)
      .neq('status', 'cancelled')

    const alreadyTaken = existing?.map((b) => b.start_time.slice(0, 5)) ?? []
    const conflict = selectedSlots.find((slot) => alreadyTaken.includes(slot))

    if (conflict) {
      setError(`Sorry, ${formatSlotRange(conflict)} was just booked by someone else. Please review your selection.`)
      setSubmitting(false)
      setTakenSlots(alreadyTaken)
      setStep(2)
      return
    }

    const fileExt = proofFile.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(fileName, proofFile)

    if (uploadError) {
      setError('Something went wrong uploading your payment proof. Please try again.')
      setSubmitting(false)
      return
    }

    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName)

    const groupId = crypto.randomUUID()
    lastGroupId.current = groupId

    setConfirmedBooking({
      date: bookingDate,
      slots: [...selectedSlots],
      total: totalAmount,
      phone,
      email,
      bookingType: bookingType ?? 'regular',
    })

    const rows = selectedSlots.map((slot) => ({
      group_id: groupId,
      name,
      email,
      phone,
      booking_date: bookingDate,
      start_time: slot,
      end_time: addOneHour(slot),
      status: 'pending',
      proof_url: urlData.publicUrl,
      amount: getSlotPrice(slot, bookingDate, bookingType ?? 'regular'),
    }))

    const { error: insertError } = await supabase.from('bookings').insert(rows)

    if (insertError) {
      setError('Something went wrong saving your booking. Please try again.')
      setSubmitting(false)
      setConfirmedBooking(null)
      return
    }

    await releaseAllMyHolds()
    setHoldExpiresAt(null)

    const emailPayload = {
      email, name, bookingDate,
      slots: selectedSlots.map((slot) => ({ start: slot, end: addOneHour(slot) })),
      totalAmount,
    }
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...emailPayload, status: 'received' }),
    }).catch(() => {})
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...emailPayload, status: 'new_booking' }),
    }).catch(() => {})

    setSubmitting(false)
    setConfirmed(true)
  }

  const inputClass =
    'w-full pl-11 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] focus:border-[#9ED9B0] focus:ring-4 focus:ring-[#9ED9B0]/15 outline-none transition-all'

  const primaryBtnGlow = 'shadow-[0_4px_20px_-4px_rgba(158,217,176,0.6)]'

  const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com']

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function suggestEmailCorrection(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at === -1) return null

  const domain = email.slice(at + 1).toLowerCase()
  if (COMMON_DOMAINS.includes(domain)) return null // already correct

  for (const known of COMMON_DOMAINS) {
    const distance = levenshtein(domain, known)
    // Small edit distance = likely typo (e.g. "gmail.con" -> "gmail.com" is distance 1)
    if (distance > 0 && distance <= 2) {
      return email.slice(0, at + 1) + known
    }
  }
  return null
}

  if (confirmed && confirmedBooking) {
    return (
      <div className="max-w-md mx-auto p-8 bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl border border-[#9ED9B0]/25 text-center animate-fade-up shadow-[0_0_40px_-8px_rgba(158,217,176,0.35),0_20px_50px_-15px_rgba(0,0,0,0.6)]">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center">
          <PartyPopper className="w-8 h-8 text-[#9ED9B0]" />
        </div>
        <h2 className="text-xl font-bold text-[#F1F2ED] mb-2">Booking Received</h2>
        <p className="text-[#B9C3BC] text-sm">
          We've received your {confirmedBooking.bookingType === 'event' ? 'party/event ' : ''}booking for{' '}
          <strong className="text-[#F1F2ED]">{confirmedBooking.date}</strong> at{' '}
          <strong className="text-[#F1F2ED]">{confirmedBooking.slots.map(formatSlotRange).join(', ')}</strong> — total{' '}
          <strong className="text-[#F1F2ED]">₱{confirmedBooking.total}</strong>. We'll verify your payment and confirm
          shortly — you'll be contacted at <strong className="text-[#F1F2ED]">{confirmedBooking.phone}</strong> or{' '}
          <strong className="text-[#F1F2ED]">{confirmedBooking.email}</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                step === s
                  ? 'bg-[#9ED9B0] text-[#13291F] scale-110 shadow-[0_0_0_4px_rgba(158,217,176,0.25)]'
                  : step > s
                  ? 'bg-[#3F6B52] text-white'
                  : 'bg-white/10 text-[#D7DAD4]'
              }`}
            >
              {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
            </div>
            {s < 3 && (
              <div className="w-8 h-0.5 bg-white/20 overflow-hidden rounded-full">
                <div className="h-full bg-[#9ED9B0] transition-all duration-500 ease-out" style={{ width: step > s ? '100%' : '0%' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div key={step} className="relative bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl p-6 border border-[#9ED9B0]/25 animate-fade-up shadow-[0_0_40px_-8px_rgba(158,217,176,0.35),0_20px_50px_-15px_rgba(0,0,0,0.6)]">
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[#9ED9B0]/60 to-transparent" />

        {step === 1 && (
          <form onSubmit={goToStep2} className="space-y-4">
            <h2 className="text-lg font-bold text-[#F1F2ED]">Your Details</h2>

            <div className="animate-fade-up" style={{ animationDelay: '0.05s' }}>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-1">Full Name</label>
              <div className="relative">
                <IconCircle Icon={User} />
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Dela Cruz" className={inputClass} />
              </div>
            </div>

            <div className="animate-fade-up" style={{ animationDelay: '0.12s' }}>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-1">Email</label>
              <div className="relative">
                <IconCircle Icon={Mail} />
               <input
  type="email"
  required
  value={email}
  onChange={(e) => {
    const value = e.target.value
    setEmail(value)
    setEmailSuggestion(isValidEmail(value) ? suggestEmailCorrection(value) : null)
  }}
  placeholder="you@email.com"
  className={inputClass}
/>
              </div>
              <p className="text-xs text-[#8A948E] mt-1">We'll send your reservation confirmation here.</p>
            </div>
            {error && <p className="text-red-400 text-xs -mt-2">{error}</p>}
            {emailSuggestion && (
  <p className="text-xs text-yellow-300 mt-1">
    Did you mean{' '}
    <button
      type="button"
      onClick={() => {
        setEmail(emailSuggestion)
        setEmailSuggestion(null)
      }}
      className="underline font-medium hover:text-yellow-200"
    >
      {emailSuggestion}
    </button>
    ?
  </p>
)}

            <div className="animate-fade-up" style={{ animationDelay: '0.19s' }}>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-1">Mobile Number</label>
              <div className="relative">
                <IconCircle Icon={Phone} />
                <input
  type="tel"
  required
  value={phone}
 onChange={(e) => {
  const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 11)
  setPhone(digitsOnly)
  setPhoneError('')
}}
  placeholder="09XX XXX XXXX"
  maxLength={11}
  className={inputClass}
/>
             </div>
              {phoneError && <p className="text-red-400 text-xs mt-1">{phoneError}</p>}
            </div>

            <div className="animate-fade-up" style={{ animationDelay: '0.22s' }}>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-2">
                Is this a regular play or a party/event/gathering?
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setBookingType('regular')
                    setError('')
                  }}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    bookingType === 'regular'
                      ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0] shadow-md'
                      : 'bg-white/5 text-[#D7DAD4] border-white/15 hover:border-[#9ED9B0]/60'
                  }`}
                >
                  Regular Play
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingType('event')
                    setError('')
                  }}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    bookingType === 'event'
                      ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0] shadow-md'
                      : 'bg-white/5 text-[#D7DAD4] border-white/15 hover:border-[#9ED9B0]/60'
                  }`}
                >
                  Party / Event
                </button>
              </div>
              <p className="text-xs text-[#8A948E] mt-2">
                {bookingType === 'event'
                  ? `Party/event bookings are ₱${EVENT_PRICE}/hr instead of the regular ₱${HOURLY_PRICE}/hr.`
                  : `Regular play is ₱${HOURLY_PRICE}/hr. Parties/events/gatherings are ₱${EVENT_PRICE}/hr.`}
              </p>
            </div>

            <button
            
  type="submit"
  disabled={checkingEmail || !bookingType}
  className={`w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 transition-all animate-fade-up disabled:opacity-60 ${primaryBtnGlow}`}
  style={{ animationDelay: '0.26s' }}
>
  {checkingEmail ? 'Checking email...' : 'Next: Choose a Time'}
</button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#F1F2ED]">Choose Your Times</h2>
            <p className="text-xs text-[#8A948E] -mt-3">
              You can select more than one hour.{' '}
              {bookingType === 'event'
                ? `Party/event rate: ₱${EVENT_PRICE}/hr, every day, 5AM–12AM.`
                : `Flat ₱${HOURLY_PRICE}/hr, every day, 5AM–12AM.`}
            </p>
            <p className="text-xs text-[#8A948E] -mt-2 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Selected slots are held for {HOLD_MINUTES} minutes.
            </p>

            {conflictNotice && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 animate-fade-up">
                <p className="text-xs text-red-300 flex-1">{conflictNotice}</p>
                <button type="button" onClick={() => setConflictNotice(null)} className="text-red-300/70 hover:text-red-300 text-xs">✕</button>
              </div>
            )}

            {holdError && (
              <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2.5 animate-fade-up">
                <p className="text-xs text-yellow-300 flex-1">{holdError}</p>
                <button type="button" onClick={() => setHoldError(null)} className="text-yellow-300/70 hover:text-yellow-300 text-xs">✕</button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-1">Date</label>
              <div className="relative">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center pointer-events-none">
                  <Calendar className="w-3.5 h-3.5 text-[#9ED9B0]" />
                </div>
                <input type="date" required min={today} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
              </div>
            </div>

            {bookingDate && (
              <div className="animate-fade-up">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#B9C3BC]">Available Slots</label>
                  {selectedSlots.length > 0 && (
                    <span className="text-xs text-[#13291F] bg-[#9ED9B0] px-2 py-0.5 rounded-full font-medium animate-fade-up">
                      {selectedSlots.length} selected
                    </span>
                  )}
                </div>
                {loadingSlots ? (
                  <p className="text-sm text-[#8A948E]">Checking availability...</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {TIME_SLOTS.map((slot) => {
const isTaken = takenSlots.includes(slot)
const isBlocked = blockedSlots.includes(slot)
const isOpenPlay = openPlaySlots.includes(slot)
const isSelected = selectedSlots.includes(slot)

// A slot the customer has already selected themselves must NEVER be
// treated as "held by someone else" — otherwise a refresh-restore race
// condition (heldByOthers loading before/after selectedSlots) can trap
// them on a slot they can't click to deselect.
const isHeld = heldByOthers.includes(slot) && !isSelected

const isDisabled = isTaken || isHeld || isBlocked || isOpenPlay
                      const isPopped = poppedSlot === slot
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => toggleSlot(slot)}
                         className={`flex flex-col items-center text-sm py-2 rounded-lg border transition-all duration-150 ${
  isPopped ? 'scale-90' : 'scale-100'
} ${
  isTaken
    ? 'bg-white/5 text-[#5A645E] border-white/10 cursor-not-allowed line-through'
    : isOpenPlay
    ? 'bg-purple-600/15 text-purple-300 border-purple-500 cursor-not-allowed'
    : isBlocked
    ? 'bg-red-600/15 text-red-300 border-red-500 cursor-not-allowed'
    : isHeld
    ? 'bg-yellow-500/5 text-yellow-500/60 border-yellow-500/20 cursor-not-allowed'
    : isSelected
    ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0] shadow-md'
    : 'bg-white/5 text-[#D7DAD4] border-white/15 hover:border-[#9ED9B0]/60 hover:bg-white/10'
}`}
                        >
                          <span>{formatSlotRange(slot)}</span>
                        <span
  className={`text-[10px] ${
    isSelected
      ? 'text-[#13291F]/70'
      : isOpenPlay
      ? 'text-purple-300'
      : isBlocked
      ? 'text-red-300'
      : isHeld
      ? 'text-yellow-500/60'
      : 'text-[#8A948E]'
  }`}
>
  {isTaken
    ? 'Booked'
    : isOpenPlay
    ? 'Open Play'
    : isBlocked
    ? (blockedInfo[slot] ?? 'Blocked')
    : isHeld
    ? 'Held'
    : `₱${getSlotPrice(slot, bookingDate, bookingType ?? 'regular')}`}
</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {selectedSlots.length > 0 && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-4 py-3 animate-fade-up">
                <span className="text-sm text-[#B9C3BC]">Total</span>
                <span className="text-xl font-bold text-[#9ED9B0]">₱{totalAmount}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
  type="button"
  onClick={async () => {
    await releaseAllMyHolds()
    setSelectedSlots([])
    setBookingDate('')
    setHoldExpiresAt(null)
    setStep(1)
  }}
  className="flex-1 border border-[#9ED9B0]/30 text-[#9ED9B0] font-semibold py-2.5 rounded-full hover:bg-[#9ED9B0]/10 active:scale-95 transition-all"
>
  Back
</button>
              <button
                type="button"
                disabled={!bookingDate || selectedSlots.length === 0}
                onClick={goToStep3}
                className={`flex-1 bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none transition-all ${primaryBtnGlow}`}
              >
                Next: Payment
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-bold text-[#F1F2ED]">Scan to Pay</h2>
            <p className="text-sm text-[#B9C3BC]">
              {bookingDate} — {selectedSlots.map(formatSlotRange).join(', ')}
              <br />
              Scan the QR code or take a screenshot and upload it your gcash app below to complete payment.
            </p>

            {conflictNotice && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 animate-fade-up text-left">
                <p className="text-xs text-red-300 flex-1">{conflictNotice}</p>
                <button type="button" onClick={() => setConflictNotice(null)} className="text-red-300/70 hover:text-red-300 text-xs">✕</button>
              </div>
            )}

            <div className="relative w-52 h-52 mx-auto">
              <div className="absolute inset-0 rounded-2xl animate-pulse-ring" />
              <div className="relative w-full h-full bg-white p-2 rounded-2xl border-2 border-[#9ED9B0] flex items-center justify-center">
                <img src="/payment-qr.jpg" alt="Payment QR code" className="w-full h-full object-contain rounded-lg" />
              </div>
              <div className="absolute -top-2 -right-2 bg-[#9ED9B0] text-[#13291F] rounded-full p-1.5 shadow-md">
                <QrCode className="w-4 h-4" />
              </div>
            </div>

            <div className="text-center">
  <p className="text-sm font-semibold text-[#9ED9B0]">MA***N CA***L D.</p>
  <p className="text-xs text-[#8A948E]">+63 923 520 4866</p>
</div>

            <div className="bg-white/5 border border-[#9ED9B0]/30 rounded-xl px-4 py-3">
              <p className="text-xs text-[#8A948E] mb-1">Amount to Pay</p>
              <p className="text-3xl font-bold text-[#9ED9B0]">₱{totalAmount}</p>
            </div>

            <p className="text-xs text-[#8A948E]">
              After paying, tap the button below. We'll verify your payment and confirm your slot.
            </p>

            <div className="text-left">
              <label className="block text-sm font-medium text-[#B9C3BC] mb-2">Proof of Payment</label>
              <label htmlFor="proof-upload" className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#9ED9B0]/30 rounded-xl py-6 cursor-pointer hover:border-[#9ED9B0]/60 hover:bg-[#9ED9B0]/5 transition-all">
                {proofPreview ? (
                  <img src={proofPreview} alt="Payment proof preview" className="max-h-40 rounded-lg" />
                ) : (
                  <>
                    <ImageUp className="w-6 h-6 text-[#9ED9B0]" />
                    <span className="text-xs text-[#8A948E]">Tap to attach a screenshot</span>
                  </>
                )}
              </label>
              <input id="proof-upload" type="file" accept="image/*" onChange={handleProofChange} className="hidden" />
            </div>

            {error && <p className="text-red-400 text-sm animate-fade-up">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep(2)} className="flex-1 border border-[#9ED9B0]/30 text-[#9ED9B0] font-semibold py-2.5 rounded-full hover:bg-[#9ED9B0]/10 active:scale-95 transition-all">
                Back
              </button>
              <button
                type="button"
                disabled={submitting || !proofFile || selectedSlots.length === 0}
                onClick={handleConfirmBooking}
                className={`flex-1 bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 disabled:opacity-50 disabled:shadow-none transition-all ${primaryBtnGlow}`}
              >
                {submitting ? 'Saving...' : "I've Paid — Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}