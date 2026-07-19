'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, CheckCircle2, XCircle, ImageIcon, Loader2, CheckCheck, CloudRain } from 'lucide-react'
import MonthlyReport from '@/components/MonthlyReport'
import { BarChart3 } from 'lucide-react'

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

function formatHourShort(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`
}

function formatSlotRange(start: string, end: string) {
  return `${formatHourShort(start)}-${formatHourShort(end)}`
}

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
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

    if (existing) {
      existing.ids.push(b.id)
      existing.slots.push({ id: b.id, start: b.start_time, end: b.end_time, amount: b.amount })
      existing.totalAmount += b.amount
      existing.totalRefunded += b.refund_amount ?? 0
    } else {
      map.set(key, {
        key,
        ids: [b.id],
        groupId: b.group_id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        booking_date: b.booking_date,
        slots: [{ id: b.id, start: b.start_time, end: b.end_time, amount: b.amount }],
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const [refundOpenKey, setRefundOpenKey] = useState<string | null>(null)
  const [rainStartInput, setRainStartInput] = useState('')
  const [refundPreview, setRefundPreview] = useState<number | null>(null)
  const [submittingRefund, setSubmittingRefund] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const router = useRouter()

  async function loadBookings() {
    setLoading(true)
    const res = await fetch('/api/admin/bookings')
    const data = await res.json()
    if (res.ok) setBookings(data.bookings)
    setLoading(false)
  }

  useEffect(() => {
    loadBookings()
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
            : 'Booking marked as pending.',
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

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  const grouped = groupBookings(bookings)
  const filtered =
    filter === 'all'
      ? grouped
      : filter === 'refunded'
      ? grouped.filter((b) => b.totalRefunded > 0)
      : grouped.filter((b) => b.status === filter)

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    confirmed: 'bg-[#9ED9B0]/15 text-[#9ED9B0] border-[#9ED9B0]/30',
    cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
    completed: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
    refunded: 'bg-purple-400/15 text-purple-300 border-purple-400/30',
  }

  return (
    <main className="min-h-[100dvh] bg-[#13291F] text-[#F1F2ED] px-4 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
  <h1 className="text-2xl font-bold">Bookings Dashboard</h1>

  <div className="flex flex-wrap items-center gap-3">

    <button
      onClick={() => setReportOpen(true)}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#9ED9B0]/10 hover:bg-[#9ED9B0]/20 text-[#9ED9B0] transition-colors"
    >
      <BarChart3 className="w-4 h-4" />
      Report
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

        <div className="flex gap-2 mb-6 flex-wrap">
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
    <p className="text-[#8A948E] text-xs leading-5 mb-0.5">Customer</p>
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
    {filter === 'refunded' ? (
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
      {filter === 'refunded' ? 'refunded' : b.status}
    </span>
  </div>
</div>

                <div className="flex flex-wrap justify-start lg:justify-center items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/10">
                      {isUpdating ? (
                        <div className="flex items-center gap-2 px-3 text-sm text-[#9ED9B0]">
                          <Loader2 className="w-4 h-4 animate-spin" /> Updating...
                        </div>
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
                              onClick={() => updateStatus(b, 'cancelled')}
                              className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                              title="Cancel"
                            >
                              <XCircle className="w-4 h-4 text-red-300" />
                            </button>
                          )}

                          {b.status === 'confirmed' && (
                            <button
                              onClick={() => updateStatus(b, 'completed')}
                              className="p-2 rounded-lg bg-blue-400/10 hover:bg-blue-400/20 transition-colors"
                              title="Mark complete"
                            >
                              <CheckCheck className="w-4 h-4 text-blue-300" />
                            </button>
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
    if (e.target === e.currentTarget) {
      setReportOpen(false)
    }
  }}
>
   <div
  className="
    relative
    w-full
    max-w-7xl
    max-h-[95vh]
    overflow-y-auto
    rounded-xl
    bg-[#13291F]
    border
    border-[#9ED9B0]/20
    p-4
    sm:p-6
  "
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