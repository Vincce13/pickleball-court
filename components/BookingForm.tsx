'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { User, Mail, Phone, Calendar, QrCode, CheckCircle2, PartyPopper, ImageUp, Lock } from 'lucide-react'

const TIME_SLOTS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
]

const PEAK_PRICE = 200
const OFFPEAK_PRICE = 150
const HOLD_MINUTES = 3

function getSlotPrice(slot: string) {
  const hour = Number(slot.split(':')[0])
  return hour < 16 ? OFFPEAK_PRICE : PEAK_PRICE
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

function IconCircle({ Icon }: { Icon: typeof User }) {
  return (
    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center">
      <Icon className="w-3.5 h-3.5 text-[#9ED9B0]" />
    </div>
  )
}

export default function BookingForm() {
  const [step, setStep] = useState(1)
  const sessionId = useRef(crypto.randomUUID()).current

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const [bookingDate, setBookingDate] = useState('')
  const [selectedSlots, setSelectedSlots] = useState<string[]>([])
  const [takenSlots, setTakenSlots] = useState<string[]>([])
  const [heldByOthers, setHeldByOthers] = useState<string[]>([])
  const [blockedSlots, setBlockedSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [conflictNotice, setConflictNotice] = useState<string | null>(null)
  const [holdError, setHoldError] = useState<string | null>(null)

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [poppedSlot, setPoppedSlot] = useState<string | null>(null)

  const totalAmount = selectedSlots.reduce((sum, slot) => sum + getSlotPrice(slot), 0)

  // Fetch actual bookings + active holds whenever the date changes
  useEffect(() => {
    if (!bookingDate) return
    setLoadingSlots(true)
    setSelectedSlots([])
    setConflictNotice(null)

    async function load() {
      const { data: bookingsData } = await supabase
        .from('bookings')
        .select('start_time')
        .eq('booking_date', bookingDate)
        .neq('status', 'cancelled')

      const { data: holdsData } = await supabase
        .from('slot_holds')
        .select('start_time, session_id, expires_at')
        .eq('booking_date', bookingDate)
        .gt('expires_at', new Date().toISOString())

        const { data: blockedData } = await supabase
  .from('blocked_slots')
  .select('start_time')
  .eq('booking_date', bookingDate)

      setTakenSlots(
  (bookingsData ?? []).map((b) => b.start_time.slice(0,5))
)

setBlockedSlots(
  (blockedData ?? []).map((b) => b.start_time.slice(0,5))
)
      setHeldByOthers(
        (holdsData ?? [])
          .filter((h) => h.session_id !== sessionId)
          .map((h) => h.start_time.slice(0, 5))
      )
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
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'slot_holds', filter: `booking_date=eq.${bookingDate}` },
        (payload) => {
          if (payload.new.session_id === sessionId) return
          const slot = (payload.new.start_time as string).slice(0, 5)
          setHeldByOthers((prev) => (prev.includes(slot) ? prev : [...prev, slot]))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'slot_holds', filter: `booking_date=eq.${bookingDate}` },
        (payload) => {
          const slot = (payload.old.start_time as string).slice(0, 5)
          setHeldByOthers((prev) => prev.filter((s) => s !== slot))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [bookingDate, sessionId])

  // Release all of this session's holds when leaving the page/tab
  useEffect(() => {
    function releaseOnUnload() {
      navigator.sendBeacon?.(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/slot_holds?session_id=eq.${sessionId}`,
      )
    }
    window.addEventListener('beforeunload', releaseOnUnload)
    return () => window.removeEventListener('beforeunload', releaseOnUnload)
  }, [sessionId])

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

  async function tryHoldSlot(slot: string): Promise<boolean> {
    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()

    const { error: insertErr } = await supabase.from('slot_holds').insert({
      booking_date: bookingDate,
      start_time: slot,
      session_id: sessionId,
      expires_at: expiresAt,
    })

    if (!insertErr) return true

    // Conflict — check if the existing hold expired; if so, take it over
    const { data: existing } = await supabase
      .from('slot_holds')
      .select('session_id, expires_at')
      .eq('booking_date', bookingDate)
      .eq('start_time', slot)
      .single()

    if (existing && new Date(existing.expires_at) < new Date()) {
      await supabase
        .from('slot_holds')
        .update({ session_id: sessionId, expires_at: expiresAt })
        .eq('booking_date', bookingDate)
        .eq('start_time', slot)
      return true
    }

    return false
  }

  function goToStep2(e: React.FormEvent) {
    e.preventDefault()
    setStep(2)
  }

  function goToStep3() {
    if (!bookingDate || selectedSlots.length === 0) return
    setStep(3)
  }

  async function toggleSlot(slot: string) {
    setHoldError(null)

    if (selectedSlots.includes(slot)) {
      setSelectedSlots((prev) => prev.filter((s) => s !== slot))
      releaseHold(slot)
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

    setSelectedSlots((prev) => [...prev, slot].sort())
  }

  function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

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
      amount: getSlotPrice(slot),
    }))

    const { error: insertError } = await supabase.from('bookings').insert(rows)

    if (insertError) {
      setError('Something went wrong saving your booking. Please try again.')
      setSubmitting(false)
      return
    }

    await releaseAllMyHolds()

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

  if (confirmed) {
    return (
      <div className="max-w-md mx-auto p-8 bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl border border-[#9ED9B0]/25 text-center animate-fade-up shadow-[0_0_40px_-8px_rgba(158,217,176,0.35),0_20px_50px_-15px_rgba(0,0,0,0.6)]">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center">
          <PartyPopper className="w-8 h-8 text-[#9ED9B0]" />
        </div>
        <h2 className="text-xl font-bold text-[#F1F2ED] mb-2">Booking Received</h2>
        <p className="text-[#B9C3BC] text-sm">
          We've received your booking for <strong className="text-[#F1F2ED]">{bookingDate}</strong> at{' '}
          <strong className="text-[#F1F2ED]">{selectedSlots.map(formatSlotRange).join(', ')}</strong> — total{' '}
          <strong className="text-[#F1F2ED]">₱{totalAmount}</strong>. We'll verify your payment and confirm
          shortly — you'll be contacted at <strong className="text-[#F1F2ED]">{phone}</strong> or{' '}
          <strong className="text-[#F1F2ED]">{email}</strong>.
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
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={inputClass} />
              </div>
            </div>

            <div className="animate-fade-up" style={{ animationDelay: '0.19s' }}>
              <label className="block text-sm font-medium text-[#B9C3BC] mb-1">Mobile Number</label>
              <div className="relative">
                <IconCircle Icon={Phone} />
                <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" className={inputClass} />
              </div>
            </div>

            <button type="submit" className={`w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 transition-all animate-fade-up ${primaryBtnGlow}`} style={{ animationDelay: '0.26s' }}>
              Next: Choose a Time
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#F1F2ED]">Choose Your Times</h2>
            <p className="text-xs text-[#8A948E] -mt-3">
              You can select more than one hour. ₱{OFFPEAK_PRICE}/hr (6AM–4PM) · ₱{PEAK_PRICE}/hr (4PM–12AM)
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
                <input type="date" required min={new Date().toISOString().split('T')[0]} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
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
const isHeld = heldByOthers.includes(slot)
const isBlocked = blockedSlots.includes(slot)

const isDisabled =
  isTaken ||
  isHeld ||
  isBlocked

const isSelected = selectedSlots.includes(slot)
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
      : isBlocked
      ? 'text-red-300'
      : isHeld
      ? 'text-yellow-500/60'
      : 'text-[#8A948E]'
  }`}
>
  {isTaken
    ? 'Booked'
    : isBlocked
    ? 'Blocked'
    : isHeld
    ? 'Held'
    : `₱${getSlotPrice(slot)}`}
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
              <button type="button" onClick={() => setStep(1)} className="flex-1 border border-[#9ED9B0]/30 text-[#9ED9B0] font-semibold py-2.5 rounded-full hover:bg-[#9ED9B0]/10 active:scale-95 transition-all">
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
              Scan the QR code below to complete payment.
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