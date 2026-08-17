'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, CheckCircle2, XCircle, ImageIcon, Loader2, CheckCheck, CloudRain, CalendarDays, BarChart3, Ban, Trash2, CalendarSearch, PlusCircle } from 'lucide-react'
import MonthlyReport from '@/components/MonthlyReport'
import { Users2 } from 'lucide-react'
import { UserCheck } from 'lucide-react'


type Booking = {
  id: number
  group_id: string | null
  name: string
  email: string
  phone: string
  booking_date: string
  start_time: string
  end_time: string
  status: string
  amount: number
  refund_amount: number
  proof_url: string | null
}

type GroupedBooking = {
  key: string
  ids: number[]
  groupId: string | null
  name: string
  email: string
  phone: string
  booking_date: string
  slots: { id: number; start: string; end: string; amount: number }[]
  totalAmount: number
  totalRefunded: number
  status: string
  proof_url: string | null
}

type BlockedSlot = {
  id: number
  booking_date: string
  start_time: string
  end_time: string
  reason: string
}

const SCHEDULE_SLOTS = [
  '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
]

// NOTE: These are pure helper functions (no hooks), so it's fine for them
// to live at module scope, outside the component.
function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

function formatSlotRange(start: string, end: string) {
  return `${formatHourShort(start)} - ${formatHourShort(end)}`
}

// Given a slot's start time (e.g. "06:00"), returns the end time one hour later (e.g. "07:00")
function addOneHour(time: string) {
  const [h, m] = time.split(':').map(Number)
  const totalMinutes = h * 60 + m + 60
  const endH = Math.floor(totalMinutes / 60) % 24
  const endM = totalMinutes % 60
  return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
}

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Whether a given hourly slot's start time falls inside a [rangeStart, rangeEnd)
// window. Used by the Day Schedule modal so that a single block/booking/open-play
// row spanning MULTIPLE hours (e.g. 06:00-08:00) correctly lights up every hourly
// slot it covers, not just the one whose start_time happens to match exactly.
function timeInRange(slot: string, rangeStart: string, rangeEnd: string) {
  const slotMin = toMinutes(slot)
  const startMin = toMinutes(rangeStart)
  // A range ending at "00:00" means midnight, i.e. the END of the day — not
  // hour 0 / the START of the day. Without this, a booking like 11PM-12AM
  // (start "23:00", end "00:00") reads as startMin=1380, endMin=0, so
  // "slotMin < endMin" is always false and the booking never matches any
  // slot — it silently shows as "Vacant" in the schedule despite being
  // confirmed. Treating a "00:00" end as 24:00 (1440) fixes the wraparound.
  const endMin = rangeEnd === '00:00' ? 24 * 60 : toMinutes(rangeEnd)
  return slotMin >= startMin && slotMin < endMin
}

// Same pricing rule used on the booking form: flat ₱200/hr, every day of the
// week, 5AM-12AM (no weekday/weekend or off-peak/peak split) — EXCEPT
// parties/events/gatherings, which are ₱250/hr instead.
const REGULAR_PRICE = 200
const EVENT_PRICE = 250

function getSlotPrice(startTime: string, dateStr: string, isEvent: boolean) {
  return isEvent ? EVENT_PRICE : REGULAR_PRICE
}

// The bookings table has no explicit "is this an event" column — the
// booking form instead charges a different per-slot amount (₱250 vs ₱200)
// depending on what the customer picked in Step 1. So we derive the flag
// here from the stored amount rather than adding a new field: if this
// booking's slots were priced at the event rate, treat it as an event.
// Used both for the "EVENT" badge and to keep extension pricing consistent
// with however the original booking was priced.
function isEventBooking(booking: GroupedBooking): boolean {
  return booking.slots.length > 0 && booking.slots.every((s) => s.amount === EVENT_PRICE)
}

function addOneHourStr(time: string) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + 60
  const endH = Math.floor(total / 60) % 24
  const endM = total % 60
  return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
}

const COURT_OPEN = '05:00'
const COURT_CLOSE_START = '23:00' // last normal bookable start time (23:00-00:00)

// Extension only ever goes forward (after the booking's last slot) — never
// backward. The one exception: a booking ending at 12AM (i.e. its last slot
// was 11PM-12AM) is still allowed to extend into 12AM-1AM, even though that's
// past the normal closing boundary.
function isValidExtensionStart(startTime: string) {
  if (startTime === '00:00') return true
  if (toMinutes(startTime) < toMinutes(COURT_OPEN)) return false
  if (toMinutes(startTime) > toMinutes(COURT_CLOSE_START)) return false
  return true
}

function calculateRefundPreview(
  slots: { start: string; end: string; amount: number }[],
  rainStart: string
) {
  const rainMinutes = toMinutes(rainStart)
  let total = 0
  for (const slot of slots) {
    const startMin = toMinutes(slot.start)
    const endMin = toMinutes(slot.end)
    const duration = endMin - startMin
    if (rainMinutes <= startMin) {
      total += slot.amount
    } else if (rainMinutes >= endMin) {
      total += 0
    } else {
      total += Math.round(slot.amount * ((endMin - rainMinutes) / duration))
    }
  }
  return total
}

function groupBookings(bookings: Booking[]): GroupedBooking[] {
  const map = new Map<string, GroupedBooking>()

  for (const b of bookings) {
    const key = b.group_id ?? `single-${b.id}`
    const existing = map.get(key)

    // Supabase returns time columns as "HH:MM:SS" — trim to "HH:MM" so every
    // comparison against these values (extension checks, slot matching,
    // etc.) uses a consistent format throughout the component. Without this,
    // a booking ending at "00:00:00" never matched the "00:00" extension
    // exception, and the extend button silently failed to appear.
    const start = b.start_time.slice(0, 5)
    const end = b.end_time.slice(0, 5)

    if (existing) {
      existing.ids.push(b.id)
      existing.slots.push({ id: b.id, start, end, amount: b.amount })
      existing.totalAmount += b.amount
      existing.totalRefunded += b.refund_amount ?? 0
      // Extension rows are inserted with proof_url: null (no new payment
      // screenshot for the extra hour). If the array happens to put one of
      // those rows first for this group (e.g. "05:00" or "00:00" sorting
      // before the original slot's start time), the original row's real
      // proof URL would otherwise get lost. Keep whichever value is real.
      if (!existing.proof_url && b.proof_url) {
        existing.proof_url = b.proof_url
      }
    } else {
      map.set(key, {
        key,
        ids: [b.id],
        groupId: b.group_id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        booking_date: b.booking_date,
        slots: [{ id: b.id, start, end, amount: b.amount }],
        totalAmount: b.amount,
        totalRefunded: b.refund_amount ?? 0,
        status: b.status,
        proof_url: b.proof_url,
      })
    }
  }

  return Array.from(map.values()).map((g) => ({
    ...g,
    slots: g.slots.sort((a, b) => a.start.localeCompare(b.start)),
  }))
}

export default function AdminDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'refunded'>('pending')
  const [search, setSearch] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const today = new Date().toISOString().split('T')[0]

  const [refundOpenKey, setRefundOpenKey] = useState<string | null>(null)
  const [rainStartInput, setRainStartInput] = useState('')
  const [refundPreview, setRefundPreview] = useState<number | null>(null)
  const [submittingRefund, setSubmittingRefund] = useState(false)
  const [rescheduleOpenKey, setRescheduleOpenKey] = useState<string | null>(null)
  const [extendingKey, setExtendingKey] = useState<string | null>(null)
  const [extendOpenKey, setExtendOpenKey] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [submittingReschedule, setSubmittingReschedule] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const [blockOpen, setBlockOpen] = useState(false)
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([])
  const [blockDate, setBlockDate] = useState('')
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [submittingBlock, setSubmittingBlock] = useState(false)

  // --- Schedule modal state (moved inside the component — this was the bug) ---
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0])
  const [scheduleData, setScheduleData] = useState<{
    bookings: { start_time: string; end_time: string; name: string; status: string }[]
    blocked: { start_time: string; end_time: string; reason: string }[]
  } | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)

  const router = useRouter()

  async function loadSchedule(date: string) {
    setScheduleLoading(true)
    try {
      const res = await fetch(`/api/admin/schedule?date=${date}`)
      const data = await res.json()
      if (res.ok) setScheduleData(data)
    } finally {
      setScheduleLoading(false)
    }
  }

  useEffect(() => {
    if (scheduleOpen) loadSchedule(scheduleDate)
  }, [scheduleOpen, scheduleDate])

  async function loadBookings() {
    setLoading(true)
    const res = await fetch('/api/admin/bookings')
    const data = await res.json()
    if (res.ok) setBookings(data.bookings)
    setLoading(false)
  }

  async function loadBlockedSlots() {
    const res = await fetch('/api/admin/blocked-slots')
    const data = await res.json()
    if (res.ok) setBlockedSlots(data.blocked)
  }

  useEffect(() => {
    loadBookings()
    loadBlockedSlots()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function updateStatus(booking: GroupedBooking, status: string) {
    setUpdatingKey(booking.key)

    const url =
      booking.ids.length > 1 && booking.groupId
        ? `/api/admin/bookings/group/${booking.groupId}`
        : `/api/admin/bookings/${booking.ids[0]}`

    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!res.ok) {
        setToast({ message: 'Something went wrong updating this booking.', type: 'error' })
        return
      }

      let emailNote = ''
      if (status === 'confirmed' || status === 'cancelled') {
        const emailRes = await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: booking.email,
            name: booking.name,
            bookingDate: booking.booking_date,
            slots: booking.slots,
            totalAmount: booking.totalAmount,
            status,
          }),
        })
        emailNote = emailRes.ok ? ' — email sent.' : ' — but email failed to send.'
      }

      setToast({
        message:
          status === 'confirmed'
            ? `Booking confirmed for ${booking.name}${emailNote}`
            : status === 'cancelled'
            ? `Booking cancelled for ${booking.name}${emailNote}`
            : status === 'completed'
            ? `Booking marked complete for ${booking.name}.`
            : status === 'refunded'
            ? `Booking for ${booking.name} moved to Refunded.`
            : status === 'pending'
            ? `Booking for ${booking.name} marked as pending.`
            : `Booking for ${booking.name} updated to ${status}.`,
        type: 'success',
      })

      await loadBookings()
    } finally {
      setUpdatingKey(null)
    }
  }

  function openRefund(key: string) {
    setRefundOpenKey(key)
    setRainStartInput('')
    setRefundPreview(null)
  }

  function calculatePreview(booking: GroupedBooking) {
    if (!rainStartInput) return
    setRefundPreview(calculateRefundPreview(booking.slots, rainStartInput))
  }

  async function submitRefund(booking: GroupedBooking) {
    if (!rainStartInput) return
    setSubmittingRefund(true)

    try {
      const res = await fetch('/api/admin/bookings/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: booking.ids, rainStart: rainStartInput }),
      })
      const data = await res.json()

      if (!res.ok) {
        setToast({ message: 'Something went wrong processing the refund.', type: 'error' })
        return
      }

      setToast({ message: `Refunded ₱${data.totalRefund} to ${booking.name}.`, type: 'success' })
      setRefundOpenKey(null)
      await loadBookings()
    } finally {
      setSubmittingRefund(false)
    }
  }

  function openReschedule(key: string) {
    setRefundOpenKey(null)
    setRescheduleOpenKey(key)
    setNewDate('')
    setNewStartTime('')
    setNewEndTime('')
  }

  async function submitReschedule(booking: GroupedBooking) {
    if (!newDate || !newStartTime || !newEndTime) return

    setSubmittingReschedule(true)

    // Capture the OLD schedule before we overwrite anything
    const oldDate = booking.booking_date
    const oldSlots = booking.slots.map((s) => ({ start: s.start, end: s.end }))

    try {
      const res = await fetch('/api/admin/bookings/reschedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: booking.ids,
          bookingDate: newDate,
          startTime: newStartTime,
          endTime: newEndTime,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setToast({
          message: data.error ?? 'Unable to reschedule booking.',
          type: 'error',
        })
        return
      }

      const emailRes = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: booking.email,
          name: booking.name,
          bookingDate: newDate,
          slots: [{ start: newStartTime, end: newEndTime }],
          totalAmount: booking.totalAmount,
          status: 'rescheduled',
          oldDate,
          oldSlots,
        }),
      })

      setToast({
        message: `Booking rescheduled successfully${emailRes.ok ? ' — email sent.' : ' — but email failed to send.'}`,
        type: 'success',
      })

      setRescheduleOpenKey(null)
      await loadBookings()

    } finally {
      setSubmittingReschedule(false)
    }
  }

  // Works out whether the hour right after a booking's last slot is free,
  // using the bookings + blockedSlots already loaded in state — no extra
  // fetch needed. Forward-only: never offers extending backward before the
  // booking's start.
  function getExtensionOption(booking: GroupedBooking): string | null {
    const lastEnd = booking.slots[booking.slots.length - 1].end
    const candidate = lastEnd // e.g. last slot 11PM-12AM -> lastEnd "00:00"

    if (!isValidExtensionStart(candidate)) return null

    const takenElsewhere = bookings.some(
      (bk) =>
        bk.booking_date === booking.booking_date &&
        bk.start_time.slice(0, 5) === candidate &&
        bk.status !== 'cancelled' &&
        !booking.ids.includes(bk.id)
    )
    if (takenElsewhere) return null

    const blocked = blockedSlots.some(
      (s) => s.booking_date === booking.booking_date && s.start_time.slice(0, 5) === candidate
    )
    if (blocked) return null

    return candidate
  }

  // Mirror of getExtensionOption, but checks BACKWARD — only offered when
  // this booking's very first slot starts at court opening time (05:00),
  // letting admin extend it earlier to 04:00 as a one-off exception.
  // NOTE: This must live INSIDE the component (unlike getExtensionOption's
  // sibling helpers above) because it reads `bookings` and `blockedSlots`
  // state — defining it at module scope caused a ReferenceError since
  // neither variable exists outside the component.
  function getEarlyExtensionOption(booking: GroupedBooking): string | null {
    const firstStart = booking.slots[0].start
    if (firstStart !== '05:00') return null

    const candidate = '04:00'

    const takenElsewhere = bookings.some(
      (bk) =>
        bk.booking_date === booking.booking_date &&
        bk.start_time.slice(0, 5) === candidate &&
        bk.status !== 'cancelled' &&
        !booking.ids.includes(bk.id)
    )
    if (takenElsewhere) return null

    const blocked = blockedSlots.some(
      (s) => s.booking_date === booking.booking_date && s.start_time.slice(0, 5) === candidate
    )
    if (blocked) return null

    return candidate
  }

  async function extendBooking(booking: GroupedBooking, startTime: string) {
    setExtendingKey(booking.key)

    const endTime = addOneHourStr(startTime)
    const amount = getSlotPrice(startTime, booking.booking_date, isEventBooking(booking))

    try {
      const res = await fetch('/api/admin/bookings/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: booking.groupId,
          existingIds: booking.ids,
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          bookingDate: booking.booking_date,
          startTime,
          endTime,
          amount,
          status: booking.status,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setToast({ message: data.error ?? 'Unable to extend booking.', type: 'error' })
        return
      }

      setToast({
        message: `Extended ${booking.name}'s booking with ${formatSlotRange(startTime, endTime)} (₱${amount}).`,
        type: 'success',
      })

      setExtendOpenKey(null)
      await loadBookings()
    } finally {
      setExtendingKey(null)
    }
  }

  async function submitBlock() {
    if (!blockDate || !blockStart || !blockEnd || !blockReason) return
    setSubmittingBlock(true)

    try {
      const res = await fetch('/api/admin/blocked-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingDate: blockDate,
          startTime: blockStart,
          endTime: blockEnd,
          reason: blockReason,
        }),
      })

      if (!res.ok) {
        setToast({ message: 'Something went wrong blocking this slot.', type: 'error' })
        return
      }

      setToast({ message: 'Slot blocked successfully.', type: 'success' })
      setBlockDate('')
      setBlockStart('')
      setBlockEnd('')
      setBlockReason('')
      await loadBlockedSlots()
    } finally {
      setSubmittingBlock(false)
    }
  }

  async function removeBlock(id: number) {
    if (!confirm('Unblock this slot?')) return
    await fetch(`/api/admin/blocked-slots/${id}`, { method: 'DELETE' })
    await loadBlockedSlots()
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

const grouped = groupBookings(bookings)



let filtered = grouped.filter((b) => {
  const matchesFilter =
    filter === 'all'
      ? true
      : filter === 'refunded'
      ? b.status === 'refunded' || b.totalRefunded > 0
      : b.status === filter

  const keyword = search.toLowerCase()

  const matchesSearch =
    b.name.toLowerCase().includes(keyword) ||
    b.email.toLowerCase().includes(keyword) ||
    b.phone.toLowerCase().includes(keyword) ||
    b.booking_date.toLowerCase().includes(keyword) ||
    b.status.toLowerCase().includes(keyword)

  return matchesFilter && matchesSearch
})

if (filter === 'confirmed') {
  filtered.sort((a, b) => {
    const aToday = a.booking_date === today
    const bToday = b.booking_date === today

    // Today's bookings first
    if (aToday && !bToday) return -1
    if (!aToday && bToday) return 1

    // Earlier dates first
    if (a.booking_date !== b.booking_date) {
      return a.booking_date.localeCompare(b.booking_date)
    }

    // Earlier time first
    return a.slots[0].start.localeCompare(b.slots[0].start)
  })
}
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    confirmed: 'bg-[#9ED9B0]/15 text-[#9ED9B0] border-[#9ED9B0]/30',
    cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
    completed: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
    refunded: 'bg-purple-400/15 text-purple-300 border-purple-400/30',
  }


  const [openPlayModalOpen, setOpenPlayModalOpen] = useState(false)
const [openPlaySessions, setOpenPlaySessions] = useState<any[]>([])
const [opDate, setOpDate] = useState('')
const [opStart, setOpStart] = useState('')
const [opEnd, setOpEnd] = useState('')
const [opMax, setOpMax] = useState('')
const [opPrice, setOpPrice] = useState('')
const [opTitle, setOpTitle] = useState('')
const [submittingOp, setSubmittingOp] = useState(false)
const [opPreviewUrl, setOpPreviewUrl] = useState<string | null>(null)
const [viewingSession, setViewingSession] = useState<any | null>(null)
const [participantSearch, setParticipantSearch] = useState('')


async function loadOpenPlaySessions() {
  const res = await fetch('/api/admin/open-play')
  const data = await res.json()
  if (res.ok) setOpenPlaySessions(data.sessions)
}

async function submitOpenPlay() {
  if (!opDate || !opStart || !opEnd || !opMax || !opPrice) return
  setSubmittingOp(true)

  try {
    const res = await fetch('/api/admin/open-play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionDate: opDate,
        startTime: opStart,
        endTime: opEnd,
        maxParticipants: Number(opMax),
        pricePerPerson: Number(opPrice),
        title: opTitle || 'Open Play',
      }),
    })

    if (!res.ok) {
      setToast({ message: 'Something went wrong creating the session.', type: 'error' })
      return
    }

    setToast({ message: 'Open Play session created.', type: 'success' })
    setOpDate('')
    setOpStart('')
    setOpEnd('')
    setOpMax('')
    setOpPrice('')
    setOpTitle('')
    await loadOpenPlaySessions()
  } finally {
    setSubmittingOp(false)
  }
}
const [opSearch, setOpSearch] = useState('')
const filteredOpenPlaySessions = openPlaySessions.filter((s) => {
  const query = opSearch.toLowerCase().trim()
  if (!query) return true
  return (
    s.title.toLowerCase().includes(query) ||
    s.session_date.includes(query) ||
    String(s.price_per_person).includes(query)
  )
})

async function deleteOpenPlaySession(id: number) {
  if (!confirm('Delete this Open Play session? This removes it for customers too.')) return
  await fetch(`/api/admin/open-play/${id}`, { method: 'DELETE' })
  await loadOpenPlaySessions()
}

async function updateParticipantStatus(participantId: number, status: string, participant?: any, session?: any) {
  await fetch(`/api/admin/open-play/participants/${participantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })

  if ((status === 'confirmed' || status === 'cancelled') && participant && session) {
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: participant.email,
        name: participant.name,
        bookingDate: session.session_date,
        sessionTitle: session.title,
        slotNumbers: [participant.slot_number],
        totalAmount: participant.amount,
        status: status === 'confirmed' ? 'openplay_confirmed' : 'openplay_cancelled',
      }),
    }).catch(() => {})
  }

  await loadOpenPlaySessions()
}

useEffect(() => {
  loadBookings()
  loadBlockedSlots()
  loadOpenPlaySessions()
}, [])

async function markArrived(participantId: number, arrived: boolean) {
  await fetch(`/api/admin/open-play/participants/${participantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arrived }),
  })
  await loadOpenPlaySessions()
}

async function finishOpenPlaySession(sessionId: number) {
  if (!confirm('Finish this session? Its total revenue will be added to this month\'s report.')) return

  const res = await fetch('/api/admin/open-play/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  const data = await res.json()

  if (!res.ok) {
    setToast({ message: 'Something went wrong finishing this session.', type: 'error' })
    return
  }

  setToast({ message: `Session finished — ₱${data.total} added to the report.`, type: 'success' })
  await loadOpenPlaySessions()
}

  return (
    <main className="min-h-[100dvh] bg-[#13291F] text-[#F1F2ED] px-2 sm:px-6 lg:px-8 py-6">
      <div className="w-full max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold">Bookings Dashboard</h1>

          <div className="grid grid-cols-2 sm:flex gap-3 w-full sm:w-auto">
            <button
              onClick={() => setReportOpen(true)}
              className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2 rounded-lg bg-[#9ED9B0]/10 hover:bg-[#9ED9B0]/20 text-[#9ED9B0] transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              Report
            </button>

            <button
              onClick={() => setBlockOpen(true)}
              className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2 rounded-lg-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 transition-colors"
            >
              <Ban className="w-4 h-4" />
              Block Slot
            </button>

            <button
             onClick={() => setScheduleOpen(true)}
             className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2 rounded-lg-lg bg-blue-400/10 hover:bg-blue-400/20 text-blue-300 transition-colors"
            >
            <CalendarSearch className="w-4 h-4" />
             Schedule
            </button>


            <button
  onClick={() => setOpenPlayModalOpen(true)}
  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-400/10 hover:bg-purple-400/20 text-purple-300 transition-colors"
>
  <Users2 className="w-4 h-4" />
  Open Play
</button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-[#B9C3BC] hover:text-[#F1F2ED] transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Log Out
            </button>
          </div>
        </div>

        <div className="mb-4">
  <input
    type="text"
    placeholder="Search by name, email, phone, date..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="w-full sm:w-96 px-4 py-2 rounded-lg bg-white/5 border border-white/15 text-white placeholder:text-[#8A948E] outline-none focus:border-[#9ED9B0]"
  />
</div>

        <div className="grid grid-cols-2 sm:flex gap-2 mb-6 w-full">
          {(['pending', 'confirmed', 'completed', 'refunded', 'cancelled', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all capitalize ${
                filter === f
                  ? 'bg-[#9ED9B0] text-[#13291F]'
                  : 'bg-white/5 text-[#B9C3BC] hover:bg-white/10'
              }`}
            >
              {f}{' '}
              {f !== 'all' &&
                `(${
                  f === 'refunded'
                    ? grouped.filter((b) => b.totalRefunded > 0).length
                    : grouped.filter((b) => b.status === f).length
                })`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-[#8A948E]">Loading bookings...</p>
        ) : filtered.length === 0 ? (
          <p className="text-[#8A948E]">No bookings in this category.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => {
              const isUpdating = updatingKey === b.key
              return (
                <div
                  key={b.key}
                  className="bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-xl p-4 border border-[#9ED9B0]/20 flex flex-col gap-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div
                      className="
                        flex-1
                        grid
                        gap-4
                        text-sm
                        grid-cols-1
                        lg:grid-cols-[1.4fr_1.4fr_0.9fr_0.8fr]
                      "
                    >
                      <div className="self-start">

  {(  (filter === 'confirmed' && b.booking_date === today) || isEventBooking(b)) && (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      {filter === 'confirmed' && b.booking_date === today && (
        <span className="inline-flex items-center rounded-full bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          📅 TODAY
        </span>
      )}
      {isEventBooking(b) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-400/20 border border-purple-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
          🎉 EVENT
        </span>
      )}
    </div>
  )}

  <p className="text-[#8A948E] text-xs leading-5 mb-0.5">
    Customer
  </p>

  <p className="font-medium leading-5">{b.name}</p>
  <p className="text-[#8A948E] text-xs">{b.email}</p>
  <p className="text-[#8A948E] text-xs">{b.phone}</p>

</div>

                      <div className="self-start">
                        <p className="text-[#8A948E] text-xs leading-5 mb-0.5">Date & Time</p>
                        <p className="font-medium leading-5">{b.booking_date}</p>
                        <p className="text-[#8A948E] text-xs">
                          {b.slots.map((s) => formatSlotRange(s.start, s.end)).join(', ')} ({b.slots.length}hr
                          {b.slots.length > 1 ? 's' : ''})
                        </p>
                      </div>

                      <div className="self-start">
                        <p className="text-[#8A948E] text-xs leading-5 mb-0.5">Amount</p>
                        {b.status === 'refunded' ? (
                        <p className="font-medium leading-5 text-purple-300">
                         ₱{b.totalAmount}
                         </p>
                         ) : filter === 'refunded' ? (
                          <p className="font-medium leading-5 text-purple-300">₱{b.totalRefunded}</p>
                        ) : b.totalRefunded > 0 ? (
                          <>
                            <p className="font-medium leading-5 text-[#9ED9B0]">
                              ₱{b.totalAmount - b.totalRefunded}{' '}
                              <span className="text-xs text-[#8A948E] line-through">₱{b.totalAmount}</span>
                            </p>
                            <p className="text-xs text-purple-300 mt-1 whitespace-nowrap">₱{b.totalRefunded} refunded</p>
                          </>
                        ) : (
                          <p className="font-medium leading-6 text-[#9ED9B0] whitespace-nowrap">₱{b.totalAmount}</p>
                        )}
                      </div>

                      <div className="self-start">
                        <p className="text-[#8A948E] text-xs leading-5 mb-0.5">Status</p>
                        <span
                          className={`inline-flex items-center justify-center text-xs px-3 py-1 rounded-full border capitalize whitespace-nowrap ${
                            filter === 'refunded' ? statusColors.refunded : statusColors[b.status]
                          }`}
                        >
                         {b.status === 'refunded' || filter === 'refunded'
                          ? 'refunded'
                          : b.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-start lg:justify-center items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/10">
                      {isUpdating ? (
                        <div className="flex items-center gap-2 px-3 text-sm text-[#9ED9B0]">
                          <Loader2 className="w-4 h-4 animate-spin" /> Updating...
                        </div>
                      ) : filter === 'refunded' || b.status === 'refunded' ? (
                        <>
                          {b.proof_url && (
                            <button
                              onClick={() => setPreviewUrl(b.proof_url)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                              title="View payment proof"
                            >
                              <ImageIcon className="w-4 h-4 text-[#9ED9B0]" />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {b.proof_url && (
                            <button
                              onClick={() => setPreviewUrl(b.proof_url)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                              title="View payment proof"
                            >
                              <ImageIcon className="w-4 h-4 text-[#9ED9B0]" />
                            </button>
                          )}

                          {b.status !== 'confirmed' && b.status !== 'completed' && (
                            <button
                              onClick={() => updateStatus(b, 'confirmed')}
                              className="p-2 rounded-lg bg-[#9ED9B0]/10 hover:bg-[#9ED9B0]/20 transition-colors"
                              title="Confirm"
                            >
                              <CheckCircle2 className="w-4 h-4 text-[#9ED9B0]" />
                            </button>
                          )}

                          {b.status !== 'cancelled' && b.status !== 'completed' && (
                            <button
                              onClick={() => {
                                if (confirm(`Are you sure you want to cancel ${b.name}'s booking?`)) {
                                  updateStatus(b, 'cancelled')
                                }
                              }}
                              className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                              title="Cancel"
                            >
                              <XCircle className="w-4 h-4 text-red-300" />
                            </button>
                          )}

                         {b.status === 'confirmed' && (
  <>
    {/* Complete */}
    <button
      onClick={() => updateStatus(b, 'completed')}
      className="p-2 rounded-lg bg-blue-400/10 hover:bg-blue-400/20 transition-colors"
      title="Mark complete"
    >
      <CheckCheck className="w-4 h-4 text-blue-300" />
    </button>

    <button
    onClick={() => openReschedule(b.key)}
    className="p-2 rounded-lg bg-amber-400/10 hover:bg-amber-400/20 transition-colors"
    title="Reschedule Booking"
    >
    <CalendarDays className="w-4 h-4 text-amber-300" />
    </button>

    {/* Extend — only shown if the hour right after this booking is free */}
   {(getExtensionOption(b) || getEarlyExtensionOption(b)) && (
  <button
    onClick={() => setExtendOpenKey(extendOpenKey === b.key ? null : b.key)}
    disabled={extendingKey === b.key}
    className="p-2 rounded-lg bg-cyan-400/10 hover:bg-cyan-400/20 transition-colors disabled:opacity-50"
    title="Extend Booking"
  >
    <PlusCircle className="w-4 h-4 text-cyan-300" />
  </button>
)}

    {/* Refund */}
    <button
      onClick={() => {
        if (confirm(`Move ${b.name}'s booking to Refunds?`)) {
          updateStatus(b, 'refunded')
        }
      }}
      className="p-2 rounded-lg bg-purple-400/10 hover:bg-purple-400/20 transition-colors"
      title="Refund Booking"
    >
      <CloudRain className="w-4 h-4 text-purple-300" />
    </button>
  </>
)}

                          {b.status === 'completed' && b.totalRefunded === 0 && (
                            <button
                              onClick={() => openRefund(b.key)}
                              className="p-2 rounded-lg bg-purple-400/10 hover:bg-purple-400/20 transition-colors"
                              title="Process refund"
                            >
                              <CloudRain className="w-4 h-4 text-purple-300" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {refundOpenKey === b.key && (
                    
                    <div className="w-full bg-white/5 border border-purple-400/30 rounded-lg p-4 space-y-3">
                      <p className="text-sm text-[#B9C3BC]">
                        What time did it start raining? We'll refund the unused portion of the booking.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="time"
                          value={rainStartInput}
                          onChange={(e) => {
                            setRainStartInput(e.target.value)
                            setRefundPreview(null)
                          }}
                          className="px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-purple-400"
                        />
                        <button
                          onClick={() => calculatePreview(b)}
                          disabled={!rainStartInput}
                          className="px-4 py-2 rounded-lg bg-purple-400/20 text-purple-200 text-sm font-medium hover:bg-purple-400/30 disabled:opacity-40 transition-colors"
                        >
                          Calculate
                        </button>
                        <button
                          onClick={() => setRefundOpenKey(null)}
                          className="px-4 py-2 rounded-lg bg-white/5 text-[#B9C3BC] text-sm hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                       
          

                      {refundPreview !== null && (
                        <div className="flex items-center justify-between bg-purple-400/10 border border-purple-400/20 rounded-lg px-4 py-3">
                          <span className="text-sm text-[#B9C3BC]">Refund amount</span>
                          <span className="text-xl font-bold text-purple-300">₱{refundPreview}</span>
                        </div>
                      )}

                      {refundPreview !== null && (
                        <button
                          onClick={() => submitRefund(b)}
                          disabled={submittingRefund}
                          className="w-full bg-purple-400 text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-purple-300 active:scale-95 disabled:opacity-50 transition-all"
                        >
                          {submittingRefund ? 'Processing...' : `Confirm Refund of ₱${refundPreview}`}
                        </button>
                      )}    
                    </div>
                  )}

                    {rescheduleOpenKey === b.key && (
  <div className="w-full bg-white/5 border border-amber-400/30 rounded-lg p-4 space-y-4">

    <p className="text-sm text-[#B9C3BC]">
      Select the new booking schedule.
    </p>

    <div>
      <label className="block text-xs mb-1 text-[#8A948E]">
        New Date
      </label>

      <input
        type="date"
        value={newDate}
        onChange={(e) => setNewDate(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 [color-scheme:dark]"
      />
    </div>

    <div className="grid grid-cols-2 gap-3">

      <div>
        <label className="block text-xs mb-1 text-[#8A948E]">
          Start
        </label>

        <input
          type="time"
          value={newStartTime}
          onChange={(e) => setNewStartTime(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 [color-scheme:dark]"
        />
      </div>

      <div>
        <label className="block text-xs mb-1 text-[#8A948E]">
          End
        </label>

        <input
          type="time"
          value={newEndTime}
          onChange={(e) => setNewEndTime(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 [color-scheme:dark]"
        />
      </div>

    </div>

    <div className="flex gap-2">

      <button
        onClick={() => submitReschedule(b)}
        disabled={submittingReschedule}
        className="flex-1 bg-amber-400 text-[#13291F] rounded-full py-2 font-semibold"
      >
        {submittingReschedule
          ? 'Saving...'
          : 'Confirm Reschedule'}
      </button>

      <button
        onClick={() => setRescheduleOpenKey(null)}
        className="px-5 rounded-full bg-white/10"
      >
        Cancel
      </button>

    </div>

  </div>
)}

                {extendOpenKey === b.key && (() => {
  const nextSlot = getExtensionOption(b)
  const earlySlot = getEarlyExtensionOption(b)
  const hasAnyOption = nextSlot || earlySlot
  const eventBooking = isEventBooking(b)

  return (
    <div className="w-full bg-white/5 border border-cyan-400/30 rounded-lg p-4 space-y-3">
      <p className="text-sm text-[#B9C3BC]">
        Add an hour to this booking. Only shown when it's currently vacant.
        {eventBooking && ' (Event rate applies.)'}
      </p>
      <div className="flex flex-wrap gap-2">
        {earlySlot && (
          <button
            onClick={() => extendBooking(b, earlySlot)}
            disabled={extendingKey === b.key}
            className="px-4 py-2 rounded-lg bg-cyan-400/20 text-cyan-200 text-sm font-medium hover:bg-cyan-400/30 disabled:opacity-40 transition-colors"
          >
            + {formatSlotRange(earlySlot, addOneHourStr(earlySlot))} early (₱{getSlotPrice(earlySlot, b.booking_date, eventBooking)})
          </button>
        )}
        {nextSlot && (
          <button
            onClick={() => extendBooking(b, nextSlot)}
            disabled={extendingKey === b.key}
            className="px-4 py-2 rounded-lg bg-cyan-400/20 text-cyan-200 text-sm font-medium hover:bg-cyan-400/30 disabled:opacity-40 transition-colors"
          >
            + {formatSlotRange(nextSlot, addOneHourStr(nextSlot))} (₱{getSlotPrice(nextSlot, b.booking_date, eventBooking)})
          </button>
        )}
        {!hasAnyOption && (
          <p className="text-xs text-[#8A948E]">No adjacent hour is currently free.</p>
        )}
      </div>
      <button
        onClick={() => setExtendOpenKey(null)}
        className="px-4 py-2 rounded-lg bg-white/5 text-[#B9C3BC] text-sm hover:bg-white/10 transition-colors"
      >
        Close
      </button>
    </div>
  )
})()}
                </div>
              )
            })}
          </div>
        )}
      </div>

      

      

      {reportOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReportOpen(false)
          }}
        >
          <div
            className="relative w-full max-w-7xl max-h-[95vh] overflow-y-auto rounded-xl bg-[#13291F] border border-[#9ED9B0]/20 p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold">Monthly Report</h2>
              <button
                onClick={() => setReportOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <MonthlyReport />
          </div>
        </div>
      )}

      {scheduleOpen && (
  <div
    className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6"
    onClick={(e) => {
      if (e.target === e.currentTarget) setScheduleOpen(false)
    }}
  >
    <div
      className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#13291F] border border-blue-400/20 p-4 sm:p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold">Day Schedule</h2>
        <button
          onClick={() => setScheduleOpen(false)}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
        >
          Close
        </button>
      </div>

      <input
        type="date"
        value={scheduleDate}
        onChange={(e) => setScheduleDate(e.target.value)}
        className="w-full px-3 py-2 mb-4 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-blue-400"
      />

      {scheduleLoading ? (
        <p className="text-sm text-[#8A948E]">Loading...</p>
      ) : (
        <div className="space-y-2">
          {SCHEDULE_SLOTS.map((slot) => {
            // Range-based matching: a booking/block/open-play row that spans
            // MULTIPLE hours (e.g. 06:00-08:00) must light up every hourly
            // slot it covers, not just the one whose start_time matches
            // exactly. This is what was causing "block 6-7 and 7-8" to only
            // ever show the first hour as blocked.
            const booking = scheduleData?.bookings.find(
              (bk) =>
                bk.status !== 'cancelled' &&
                timeInRange(slot, bk.start_time.slice(0, 5), bk.end_time.slice(0, 5))
            )
            const block = scheduleData?.blocked.find((bl) =>
              timeInRange(slot, bl.start_time.slice(0, 5), bl.end_time.slice(0, 5))
            )
            // Open Play sessions weren't being checked against the schedule
            // at all before — they live in `openPlaySessions` (already
            // loaded client-side), not in `scheduleData`, so they never had
            // a chance to show up here.
            const openPlaySession = openPlaySessions.find(
              (s) =>
                s.session_date === scheduleDate &&
                timeInRange(slot, s.start_time.slice(0, 5), s.end_time.slice(0, 5))
            )

            let bg = 'bg-[#9ED9B0]/10 border-[#9ED9B0]/30'
            let label = 'Vacant'
            let sub = ''

            if (booking) {
              bg =
                booking.status === 'pending'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-blue-400/10 border-blue-400/30'
              label = booking.status === 'pending' ? 'Pending' : booking.status === 'confirmed' ? 'Confirmed' : 'Completed'
              sub = booking.name
            } else if (block) {
              bg = 'bg-red-500/10 border-red-500/30'
              label = 'Blocked'
              sub = block.reason
            } else if (openPlaySession) {
              bg = 'bg-purple-400/10 border-purple-400/30'
              label = 'Open Play'
              const activeCount = (openPlaySession.open_play_participants ?? []).filter(
                (p: any) => p.status !== 'cancelled'
              ).length
              sub = `${openPlaySession.title} (${activeCount}/${openPlaySession.max_participants})`
            }

            return (
              <div
                key={slot}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${bg}`}
              >
                <span className="text-sm font-medium">{formatSlotRange(slot, addOneHour(slot))}</span>
                <div className="text-right">
                  <p className="text-xs font-medium">{label}</p>
                  {sub && <p className="text-xs text-[#8A948E]">{sub}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  </div>
)}

{openPlayModalOpen && (
  <div
    className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6"
    onClick={(e) => {
      if (e.target === e.currentTarget) setOpenPlayModalOpen(false)
    }}
  >
    <div
      className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#13291F] border border-purple-400/20 p-4 sm:p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold">Open Play Sessions</h2>
        <button
          onClick={() => setOpenPlayModalOpen(false)}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
        >
          Close
        </button>
      </div>

      {/* Create form */}
      <div className="space-y-3 mb-6 bg-white/5 border border-white/10 rounded-lg p-4">
        <p className="text-sm font-semibold">Create New Session</p>

        <input
          type="text"
          value={opTitle}
          onChange={(e) => setOpTitle(e.target.value)}
          placeholder="Title (e.g. Beginner Open Play)"
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-purple-400"
        />

        <input
          type="date"
          value={opDate}
          onChange={(e) => setOpDate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-purple-400"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#8A948E] mb-1">Start Time</label>
            <input
              type="time"
              value={opStart}
              onChange={(e) => setOpStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-purple-400"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8A948E] mb-1">End Time</label>
            <input
              type="time"
              value={opEnd}
              onChange={(e) => setOpEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-purple-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#8A948E] mb-1">Max Participants</label>
            <input
              type="number"
              min="1"
              value={opMax}
              onChange={(e) => setOpMax(e.target.value)}
              placeholder="20"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-purple-400"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8A948E] mb-1">Price per Person</label>
            <input
              type="number"
              min="0"
              value={opPrice}
              onChange={(e) => setOpPrice(e.target.value)}
              placeholder="150"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-purple-400"
            />
          </div>
        </div>

        <button
          onClick={submitOpenPlay}
          disabled={submittingOp || !opDate || !opStart || !opEnd || !opMax || !opPrice}
          className="w-full bg-purple-400 text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-purple-300 active:scale-95 disabled:opacity-40 transition-all"
        >
          {submittingOp ? 'Creating...' : 'Create Session'}
        </button>
      </div>

      {/* Existing sessions */}
     <div>
  <div className="flex items-center justify-between mb-2">
    <p className="text-sm font-semibold">Upcoming Sessions</p>
    <input
      type="text"
      value={opSearch}
      onChange={(e) => setOpSearch(e.target.value)}
      placeholder="Search by title, date, price..."
      className="w-48 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] text-xs outline-none focus:border-purple-400"
    />
  </div>
  {openPlaySessions.length === 0 ? (
    <p className="text-xs text-[#8A948E]">No sessions created yet.</p>
  ) : filteredOpenPlaySessions.length === 0 ? (
    <p className="text-xs text-[#8A948E]">No sessions match your search.</p>
  ) : (
    <div className="space-y-3">
      {filteredOpenPlaySessions.map((s) => {
              const participants = s.open_play_participants ?? []
              const activeCount = participants.filter((p: any) => p.status !== 'cancelled').length

              return (
                <div key={s.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                 <div className="flex items-center justify-between mb-2">
  <div>
    <p className="text-sm font-medium">{s.title}</p>
    <p className="text-xs text-[#8A948E]">
      {s.session_date} · {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)} · ₱{s.price_per_person}/person · {activeCount}/{s.max_participants} joined
    </p>
  </div>
  <div className="flex items-center gap-1">
   <button
 onClick={() => {
  setViewingSession(s)
  setParticipantSearch('')
}}
  className="px-3 py-1.5 rounded-lg bg-purple-400/10 hover:bg-purple-400/20 text-purple-200 text-xs font-medium transition-colors"
>
  View ({participants.length})
</button>
{!s.status_finished && (
  <button
    onClick={() => finishOpenPlaySession(s.id)}
    className="px-3 py-1.5 rounded-lg bg-blue-400/10 hover:bg-blue-400/20 text-blue-200 text-xs font-medium transition-colors"
  >
    Finish
  </button>
)}
{s.status_finished && (
  <span className="px-3 py-1.5 rounded-lg bg-white/5 text-[#8A948E] text-xs">
    Finished — ₱{s.finished_total}
  </span>
)}
    <button
      onClick={() => deleteOpenPlaySession(s.id)}
      className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
      title="Delete session"
    >
      <Trash2 className="w-4 h-4 text-red-300" />
    </button>
  </div>
</div>

              {viewingSession && (
  <div
    className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-2 sm:p-6"
    onClick={(e) => {
      if (e.target === e.currentTarget) setViewingSession(null)
    }}
  >
    <div
      className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-[#13291F] border border-purple-400/25 p-4 sm:p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold">{viewingSession.title}</h3>
          <p className="text-xs text-[#8A948E]">
            {viewingSession.session_date} · {viewingSession.start_time.slice(0, 5)}-{viewingSession.end_time.slice(0, 5)}
          </p>
        </div>
        <button
          onClick={() => setViewingSession(null)}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
        >
          Close
        </button>
      </div>

    {(() => {
  const current = openPlaySessions.find((sess) => sess.id === viewingSession.id)
  const allParticipants = current?.open_play_participants ?? []

  const participants = allParticipants.filter((p: any) => {
    const query = participantSearch.toLowerCase().trim()
    if (!query) return true
    return (
      p.name.toLowerCase().includes(query) ||
      p.phone.toLowerCase().includes(query) ||
      p.status.toLowerCase().includes(query)
    )
  })

  if (allParticipants.length === 0) {
    return <p className="text-sm text-[#8A948E]">No one has joined this session yet.</p>
  }

  return (
    <>
      <input
        type="text"
        value={participantSearch}
        onChange={(e) => setParticipantSearch(e.target.value)}
        placeholder="Search by name, phone, or status..."
        className="w-full mb-3 px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] text-sm outline-none focus:border-purple-400"
      />
      {participants.length === 0 ? (
        <p className="text-sm text-[#8A948E]">No participants match your search.</p>
      ) : (
        <div className="space-y-2">
          {participants.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2.5"
              >
                <div>
                  <span className="text-sm font-medium">{p.name}</span>{' '}
                  <span className="text-xs text-[#8A948E]">{p.phone}</span>
                  <div className="mt-1">
                   <span
  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
    p.status === 'confirmed'
      ? 'bg-[#9ED9B0]/15 text-[#9ED9B0]'
      : p.status === 'cancelled'
      ? 'bg-red-500/15 text-red-300'
      : 'bg-yellow-500/15 text-yellow-300'
  }`}
>
  {p.status}
</span>
{p.arrived && (
  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-blue-400/15 text-blue-300">
    arrived
  </span>
)}
                  </div>
                </div>
               <div className="flex items-center gap-1">
  {p.proof_url && (
    <button
      onClick={() => setOpPreviewUrl(p.proof_url)}
      className="p-1.5 rounded-lg hover:bg-white/10"
      title="View proof"
    >
      <ImageIcon className="w-4 h-4 text-[#9ED9B0]" />
    </button>
  )}
  {p.status !== 'confirmed' && (
    <button
  onClick={() => updateParticipantStatus(p.id, 'confirmed', p, viewingSession)}
      className="p-1.5 rounded-lg hover:bg-white/10"
      title="Confirm"
    >
      <CheckCircle2 className="w-4 h-4 text-[#9ED9B0]" />
    </button>
  )}
  {p.status === 'confirmed' ? (
    <button
      onClick={() => markArrived(p.id, !p.arrived)}
      className={`p-1.5 rounded-lg hover:bg-white/10 ${p.arrived ? 'bg-blue-400/10' : ''}`}
      title={p.arrived ? 'Arrived — click to undo' : 'Mark as arrived'}
    >
      <UserCheck className={`w-4 h-4 ${p.arrived ? 'text-blue-300' : 'text-[#8A948E]'}`} />
    </button>
  ) : (
    <button
  onClick={() => updateParticipantStatus(p.id, 'cancelled', p, viewingSession)}
      className="p-1.5 rounded-lg hover:bg-white/10"
      title="Cancel"
    >
      <XCircle className="w-4 h-4 text-red-300" />
    </button>
  )}
</div>
              </div>
))}
        </div>
      )}
    </>
  )
})()}
    </div>
  </div>
)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  </div>
)}



{opPreviewUrl && (
  <div
    className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
    onClick={() => setOpPreviewUrl(null)}
  >
    <img src={opPreviewUrl} alt="Payment proof" className="max-w-full max-h-full rounded-lg" />
  </div>
)}


      {blockOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBlockOpen(false)
          }}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-[#13291F] border border-red-500/20 p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">Block a Slot</h2>
              <button
                onClick={() => setBlockOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs text-[#8A948E] mb-1">Date</label>
                <input
                  type="date"
                  value={blockDate}
                  onChange={(e) => setBlockDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-red-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8A948E] mb-1">Start Time</label>
                  <input
                    type="time"
                    value={blockStart}
                    onChange={(e) => setBlockStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-red-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8A948E] mb-1">End Time</label>
                  <input
                    type="time"
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] [color-scheme:dark] outline-none focus:border-red-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#8A948E] mb-1">Reason</label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="e.g. Maintenance, Private event"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] outline-none focus:border-red-400"
                />
              </div>
              <button
                onClick={submitBlock}
                disabled={submittingBlock || !blockDate || !blockStart || !blockEnd || !blockReason}
                className="w-full bg-red-500 text-white font-semibold py-2.5 rounded-full hover:bg-red-400 active:scale-95 disabled:opacity-40 transition-all"
              >
                {submittingBlock ? 'Blocking...' : 'Block This Slot'}
              </button>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2">Currently Blocked</p>
              {blockedSlots.length === 0 ? (
                <p className="text-xs text-[#8A948E]">No blocked slots.</p>
              ) : (
                <div className="space-y-2">
                  {blockedSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {slot.booking_date} · {slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}
                        </p>
                        <p className="text-xs text-red-300">{slot.reason}</p>
                      </div>
                      <button
                        onClick={() => removeBlock(slot.id)}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                        title="Unblock"
                      >
                        <Trash2 className="w-4 h-4 text-red-300" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          onClick={() => setPreviewUrl(null)}
        >
          <img src={previewUrl} alt="Payment proof" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-up ${
            toast.type === 'success' ? 'bg-[#9ED9B0] text-[#13291F]' : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </main>
  )
}