'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Users, ImageUp, QrCode, PartyPopper, User, Mail, Phone } from 'lucide-react'

type Session = {
  id: number
  session_date: string
  start_time: string
  end_time: string
  max_participants: number
  price_per_person: number
  title: string
  open_play_participants: { id: number; status: string; name: string; slot_number: number | null }[]
}

const HOLD_MINUTES = 5

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
  if (COMMON_DOMAINS.includes(domain)) return null
  for (const known of COMMON_DOMAINS) {
    const distance = levenshtein(domain, known)
    if (distance > 0 && distance <= 2) return email.slice(0, at + 1) + known
  }
  return null
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function formatHour(time: string) {
  const [h] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}${period}`
}

function nextNDays(n: number) {
  const days = []
  const today = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

// Generates (or reuses) a stable per-tab identifier so slot holds can be
// tied to "this browser session" — used to tell apart this tab's own holds
// from holds placed by other people, and to release them on unload/expiry.
// Stored in sessionStorage so a page refresh mid-flow doesn't orphan holds
// under a brand new random key.
function getOrCreateSessionKey() {
  if (typeof window === 'undefined') return ''
  const existing = window.sessionStorage.getItem('op_session_key')
  if (existing) return existing
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.sessionStorage.setItem('op_session_key', key)
  return key
}

export default function OpenPlayForm() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>('any')
  const [activeSession, setActiveSession] = useState<Session | null>(null)

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState('')
  const [checkingEmail, setCheckingEmail] = useState(false)

  const [selectedSlots, setSelectedSlots] = useState<number[]>([])

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)

  // NOTE: these two were the source of the "Invalid hook call" crash and a
  // follow-on ReferenceError:
  // - `holdExpiresAt` was previously declared with useState() OUTSIDE this
  //   component (right after the Session type) — hooks can only be called
  //   inside a function component's body, so that threw immediately.
  // - `sessionKey` was used all over this file (hold effects, tryHoldOpSlot,
  //   releaseAllMyOpHolds, the unload handler) but was never declared
  //   anywhere. It's a stable per-tab id, generated lazily once and kept in
  //   sessionStorage so a mid-flow refresh doesn't lose it.
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)
  const [sessionKey] = useState(getOrCreateSessionKey)

  const [heldByOthers, setHeldByOthers] = useState<number[]>([])

  const days = nextNDays(14)

  async function loadSessions() {
    setLoading(true)
    const res = await fetch('/api/open-play')
    const data = await res.json()
    if (res.ok) setSessions(data.sessions)
    setLoading(false)
  }

  useEffect(() => {
    loadSessions()
  }, [])

  useEffect(() => {
    if (!activeSession) return
    const channel = supabase
      .channel(`openplay-${activeSession.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'open_play_participants', filter: `session_id=eq.${activeSession.id}` },
        () => loadSessions()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeSession?.id])

  // Watch for other people's holds on this session in real time
useEffect(() => {
  if (!activeSession) return

  const channel = supabase
    .channel(`op-holds-${activeSession.id}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'open_play_slot_holds', filter: `session_id=eq.${activeSession.id}` },
      (payload) => {
        if (payload.new.session_key === sessionKey) return
        const num = payload.new.slot_number as number
        setHeldByOthers((prev) => (prev.includes(num) ? prev : [...prev, num]))
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'open_play_slot_holds', filter: `session_id=eq.${activeSession.id}` },
      (payload) => {
        const num = payload.old.slot_number as number
        setHeldByOthers((prev) => prev.filter((n) => n !== num))
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [activeSession?.id, sessionKey])

// Load any existing active holds when entering slot-picking step
useEffect(() => {
  if (!activeSession || step !== 2) return

  supabase
    .from('open_play_slot_holds')
    .select('slot_number, session_key, expires_at')
    .eq('session_id', activeSession.id)
    .gt('expires_at', new Date().toISOString())
    .then(({ data }) => {
      setHeldByOthers((data ?? []).filter((h) => h.session_key !== sessionKey).map((h) => h.slot_number))
    })
}, [activeSession?.id, step, sessionKey])

// Release this browser's holds if the tab/window closes mid-flow
useEffect(() => {
  function releaseOnUnload() {
    navigator.sendBeacon?.(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/open_play_slot_holds?session_key=eq.${sessionKey}`
    )
  }
  window.addEventListener('beforeunload', releaseOnUnload)
  return () => window.removeEventListener('beforeunload', releaseOnUnload)
}, [sessionKey])

 useEffect(() => {
    if (!holdExpiresAt) return
    const interval = setInterval(() => {
      if (Date.now() >= holdExpiresAt) {
        clearInterval(interval)
        releaseAllMyOpHolds()
        setSelectedSlots([])
        setHoldExpiresAt(null)
        setStep(1)
        setError('Your held slots expired after 5 minutes. Please start again.')
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [holdExpiresAt])

  const filtered =
    selectedDate === 'any' ? sessions : sessions.filter((s) => s.session_date === selectedDate)

  function openJoinFlow(session: Session) {
    setActiveSession(session)
    setStep(1)
    setName('')
    setEmail('')
    setPhone('')
    setEmailSuggestion(null)
    setPhoneError('')
    setSelectedSlots([])
    setProofFile(null)
    setProofPreview(null)
    setError('')
    setJoined(false)
  }

  async function goToStep2() {
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
        setError("This email domain doesn't appear to be able to receive emails. Please double-check it.")
        setCheckingEmail(false)
        return
      }
    } catch {
      // fail open
    }

    setCheckingEmail(false)
    setStep(2)
  }

  async function toggleSlot(slotNumber: number) {
  if (selectedSlots.includes(slotNumber)) {
    setSelectedSlots((prev) => {
      const next = prev.filter((n) => n !== slotNumber)
      // Releasing the LAST held slot — nothing left to expire, so clear the
      // timer instead of starting one.
      if (next.length === 0) {
        setHoldExpiresAt(null)
      }
      return next
    })
    if (activeSession) {
      await supabase
        .from('open_play_slot_holds')
        .delete()
        .eq('session_id', activeSession.id)
        .eq('slot_number', slotNumber)
        .eq('session_key', sessionKey)
    }
    return
  }

  const success = await tryHoldOpSlot(slotNumber)
  if (!success) {
    setError(`Slot #${slotNumber} was just taken by someone else. Please pick another.`)
    setHeldByOthers((prev) => (prev.includes(slotNumber) ? prev : [...prev, slotNumber]))
    return
  }

  setError('')
  setSelectedSlots((prev) => {
    // Holding the FIRST slot — start the 5-minute countdown. Selecting more
    // slots afterward doesn't push this back; the whole hold expires 5
    // minutes after it began, which is also how the DB-side hold rows are
    // timed (see tryHoldOpSlot's expiresAt).
    if (prev.length === 0) {
      setHoldExpiresAt(Date.now() + HOLD_MINUTES * 60 * 1000)
    }
    return [...prev, slotNumber].sort((a, b) => a - b)
  })
}

  function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }
  async function releaseAllMyOpHolds() {
  await supabase.from('open_play_slot_holds').delete().eq('session_key', sessionKey)
}

async function tryHoldOpSlot(slotNumber: number): Promise<boolean> {
  if (!activeSession) return false
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()

  const { error: insertErr } = await supabase.from('open_play_slot_holds').insert({
    session_id: activeSession.id,
    slot_number: slotNumber,
    session_key: sessionKey,
    expires_at: expiresAt,
  })

  if (!insertErr) return true

  const { data: existing } = await supabase
    .from('open_play_slot_holds')
    .select('session_key, expires_at')
    .eq('session_id', activeSession.id)
    .eq('slot_number', slotNumber)
    .single()

  if (existing && new Date(existing.expires_at) < new Date()) {
    await supabase
      .from('open_play_slot_holds')
      .update({ session_key: sessionKey, expires_at: expiresAt })
      .eq('session_id', activeSession.id)
      .eq('slot_number', slotNumber)
    return true
  }

  return false
}

  async function submitJoin() {
    if (!activeSession || !proofFile) {
      setError('Please attach your payment screenshot.')
      return
    }
    setSubmitting(true)
    setError('')

    const fileExt = proofFile.name.split('.').pop()
    const fileName = `openplay-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(fileName, proofFile)
    if (uploadError) {
      setError('Something went wrong uploading your proof. Please try again.')
      setSubmitting(false)
      return
    }

    const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName)

    const res = await fetch('/api/open-play/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.id,
        name,
        email,
        phone,
        proofUrl: urlData.publicUrl,
        slotNumbers: selectedSlots,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    const emailPayload = {
  email,
  name,
  bookingDate: activeSession.session_date,
  sessionTitle: activeSession.title,
  slotNumbers: selectedSlots,
  totalAmount,
}

fetch('/api/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...emailPayload, status: 'openplay_received' }),
}).catch(() => {})

fetch('/api/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...emailPayload, status: 'new_openplay_join', isOpenPlay: true }),
}).catch(() => {})

setSubmitting(false)
await releaseAllMyOpHolds()
setHoldExpiresAt(null)
setJoined(true)
loadSessions()
  }

  const currentSessionLive = activeSession
    ? sessions.find((s) => s.id === activeSession.id) ?? activeSession
    : null

  const takenSlotMap: Record<number, string> = {}
  if (currentSessionLive) {
    currentSessionLive.open_play_participants
      .filter((p) => p.status !== 'cancelled' && p.slot_number)
      .forEach((p) => {
        takenSlotMap[p.slot_number as number] = p.name
      })
  }

  const totalAmount = activeSession ? selectedSlots.length * activeSession.price_per_person : 0

  return (
    <div className="max-w-3xl mx-auto">
      {/* Date tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
        <button
          onClick={() => setSelectedDate('any')}
          className={`shrink-0 px-4 py-2 rounded-xl text-xs font-semibold border ${
            selectedDate === 'any'
              ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0]'
              : 'bg-white/5 text-[#B9C3BC] border-white/15'
          }`}
        >
          ANY<br />ALL
        </button>
        {days.map((d, i) => {
          const dateObj = new Date(d + 'T00:00:00')
          const label = i === 0 ? 'TODAY' : dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
          const count = sessions.filter((s) => s.session_date === d).length
          return (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              className={`relative shrink-0 px-4 py-2 rounded-xl text-xs font-semibold border ${
                selectedDate === d
                  ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0]'
                  : 'bg-white/5 text-[#B9C3BC] border-white/15'
              }`}
            >
              {label}<br />{dateObj.getDate()}
              {count > 0 && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-yellow-400 text-[9px] text-[#13291F] font-bold flex items-center justify-center">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="text-sm text-[#8A948E]">Loading open play schedule...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[#8A948E]">No open play sessions on this date.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const activeCount = s.open_play_participants.filter((p) => p.status !== 'cancelled').length
            const spotsLeft = s.max_participants - activeCount
            const isFull = spotsLeft <= 0

            return (
              <div
                key={s.id}
                className="flex items-center justify-between bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-xl p-4 border border-[#9ED9B0]/25"
              >
                <div>
                  <p className="font-semibold text-[#F1F2ED]">{s.title}</p>
                  <p className="text-xs text-[#8A948E]">
                    {s.session_date} · {formatHour(s.start_time)}-{formatHour(s.end_time)} · ₱{s.price_per_person}/person
                  </p>
                  <p className={`text-xs mt-1 ${isFull ? 'text-red-300' : 'text-[#9ED9B0]'}`}>
                    {isFull ? 'Full' : `${spotsLeft} of ${s.max_participants} spots left`}
                  </p>
                </div>
                <button
                  onClick={() => openJoinFlow(s)}
                  disabled={isFull}
                  className="px-4 py-2 rounded-full bg-[#9ED9B0] text-[#13291F] text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {isFull ? 'Full' : 'Join'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Join modal */}
      {activeSession && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setActiveSession(null)}
        >
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#13291F] border border-[#9ED9B0]/25 rounded-2xl p-6">
            {joined ? (
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center">
                  <PartyPopper className="w-7 h-7 text-[#9ED9B0]" />
                </div>
                <h3 className="font-bold text-lg mb-2">You're in!</h3>
                <p className="text-sm text-[#B9C3BC] mb-4">
                  We'll verify your payment and confirm your spot{selectedSlots.length > 1 ? 's' : ''} for{' '}
                  {activeSession.title} on {activeSession.session_date}.
                </p>
                <button
                  onClick={() => setActiveSession(null)}
                  className="w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full"
                >
                  Close
                </button>
              </div>
            ) : step === 1 ? (
              <>
                <h3 className="font-bold text-lg mb-4">Join {activeSession.title}</h3>
                <div className="space-y-3 mb-1">
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ED9B0]" />
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-[#9ED9B0]" />
                  </div>

                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ED9B0]" />
                    <input
                      value={email}
                      onChange={(e) => {
                        const value = e.target.value
                        setEmail(value)
                        setEmailSuggestion(isValidEmail(value) ? suggestEmailCorrection(value) : null)
                        setError('')
                      }}
                      placeholder="Email"
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-[#9ED9B0]"
                    />
                  </div>
                  {emailSuggestion && (
                    <p className="text-xs text-yellow-300 -mt-2">
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
                  {error && <p className="text-red-400 text-xs -mt-2">{error}</p>}

                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ED9B0]" />
                    <input
                      value={phone}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 11)
                        setPhone(digitsOnly)
                        setPhoneError('')
                      }}
                      placeholder="Mobile number"
                      maxLength={11}
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-[#9ED9B0]"
                    />
                  </div>
                  {phoneError && <p className="text-red-400 text-xs -mt-2">{phoneError}</p>}
                </div>

                <button
                  onClick={goToStep2}
                  disabled={!name || !email || !phone || checkingEmail}
                  className="w-full mt-4 bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full disabled:opacity-40"
                >
                  {checkingEmail ? 'Checking email...' : 'Next: Choose Slots'}
                </button>
              </>
            ) : step === 2 ? (
              <>
                <h3 className="font-bold text-lg mb-1">Choose Your Slot{selectedSlots.length !== 1 ? 's' : ''}</h3>
                <p className="text-xs text-[#8A948E] mb-4">
                  You can select more than one slot. ₱{activeSession.price_per_person} each.
                </p>

                <div className="grid grid-cols-5 gap-2 mb-4">
                {Array.from({ length: activeSession.max_participants }, (_, i) => i + 1).map((num) => {
  const takenBy = takenSlotMap[num]
  const isHeld = heldByOthers.includes(num)
  const isSelected = selectedSlots.includes(num)
  const isDisabled = !!takenBy || isHeld
  return (
    <button
      key={num}
      type="button"
      disabled={isDisabled}
      onClick={() => toggleSlot(num)}
      title={takenBy ? takenBy : isHeld ? 'Currently held by someone else' : undefined}
      className={`flex flex-col items-center justify-center py-2.5 rounded-lg border text-xs transition-all ${
        takenBy
          ? 'bg-white/5 text-[#5A645E] border-white/10 cursor-not-allowed'
          : isHeld
          ? 'bg-yellow-500/5 text-yellow-500/60 border-yellow-500/20 cursor-not-allowed'
          : isSelected
          ? 'bg-[#9ED9B0] text-[#13291F] border-[#9ED9B0] shadow-md'
          : 'bg-white/5 text-[#D7DAD4] border-white/15 hover:border-[#9ED9B0]/60'
      }`}
    >
      <span className="font-semibold">#{num}</span>
      <span className="truncate w-full text-center text-[9px] leading-tight mt-0.5">
        {takenBy ? takenBy.split(' ')[0] : isHeld ? 'Held' : 'Open'}
      </span>
    </button>
  )
})}
                </div>

                {selectedSlots.length > 0 && (
                  <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-4">
                    <span className="text-sm text-[#B9C3BC]">
                      {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} · Total
                    </span>
                    <span className="text-lg font-bold text-[#9ED9B0]">₱{totalAmount}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 border border-[#9ED9B0]/30 text-[#9ED9B0] font-semibold py-2.5 rounded-full"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={selectedSlots.length === 0}
                    className="flex-1 bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full disabled:opacity-40"
                  >
                    Next: Payment
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-lg mb-2">Scan to Pay</h3>
                <p className="text-xs text-[#8A948E] mb-1">
                  Slot{selectedSlots.length > 1 ? 's' : ''} #{selectedSlots.join(', #')}
                </p>
                <p className="text-xs text-[#8A948E] mb-4">₱{totalAmount} total for this session</p>
                <img src="/payment-qr.jpg" alt="QR" className="w-40 h-40 mx-auto rounded-lg mb-4 bg-white p-1" />
                <label htmlFor="op-proof" className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[#9ED9B0]/30 rounded-xl py-5 cursor-pointer mb-4">
                  {proofPreview ? (
                    <img src={proofPreview} className="max-h-32 rounded-lg" />
                  ) : (
                    <>
                      <ImageUp className="w-5 h-5 text-[#9ED9B0]" />
                      <span className="text-xs text-[#8A948E]">Attach payment screenshot</span>
                    </>
                  )}
                </label>
                <input id="op-proof" type="file" accept="image/*" onChange={handleProofChange} className="hidden" />
                {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 border border-[#9ED9B0]/30 text-[#9ED9B0] font-semibold py-2.5 rounded-full"
                  >
                    Back
                  </button>
                  <button
                    onClick={submitJoin}
                    disabled={submitting || !proofFile}
                    className="flex-1 bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full disabled:opacity-50"
                  >
                    {submitting ? 'Joining...' : "I've Paid — Join"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}