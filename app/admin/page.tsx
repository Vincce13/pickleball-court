'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, CheckCircle2, XCircle, Clock, ImageIcon, Loader2 } from 'lucide-react'

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
  slots: { start: string; end: string }[]
  totalAmount: number
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

function groupBookings(bookings: Booking[]): GroupedBooking[] {
  const map = new Map<string, GroupedBooking>()

  for (const b of bookings) {
    const key = b.group_id ?? `single-${b.id}`
    const existing = map.get(key)

    if (existing) {
      existing.ids.push(b.id)
      existing.slots.push({ start: b.start_time, end: b.end_time })
      existing.totalAmount += b.amount
    } else {
      map.set(key, {
        key,
        ids: [b.id],
        groupId: b.group_id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        booking_date: b.booking_date,
        slots: [{ start: b.start_time, end: b.end_time }],
        totalAmount: b.amount,
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
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'cancelled'>('pending')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
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
            : 'Booking marked as pending.',
        type: 'success',
      })

      await loadBookings()
    } finally {
      setUpdatingKey(null)
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  const grouped = groupBookings(bookings)
  const filtered = filter === 'all' ? grouped : grouped.filter((b) => b.status === filter)

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    confirmed: 'bg-[#9ED9B0]/15 text-[#9ED9B0] border-[#9ED9B0]/30',
    cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
  }

  return (
    <main className="min-h-[100dvh] bg-[#13291F] text-[#F1F2ED] px-4 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Bookings Dashboard</h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-[#B9C3BC] hover:text-[#F1F2ED] transition-colors"
          >
            <LogOut className="w-4 h-4" /> Log Out
          </button>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {(['pending', 'confirmed', 'cancelled', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all capitalize ${
                filter === f
                  ? 'bg-[#9ED9B0] text-[#13291F]'
                  : 'bg-white/5 text-[#B9C3BC] hover:bg-white/10'
              }`}
            >
              {f} {f !== 'all' && `(${grouped.filter((b) => b.status === f).length})`}
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
                  className="bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-xl p-4 border border-[#9ED9B0]/20 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-[#8A948E] text-xs">Customer</p>
                      <p className="font-medium">{b.name}</p>
                      <p className="text-[#8A948E] text-xs">{b.phone}</p>
                    </div>
                    <div>
                      <p className="text-[#8A948E] text-xs">Date & Time</p>
                      <p className="font-medium">{b.booking_date}</p>
                      <p className="text-[#8A948E] text-xs">
                        {b.slots.map((s) => formatSlotRange(s.start, s.end)).join(', ')} ({b.slots.length}hr
                        {b.slots.length > 1 ? 's' : ''})
                      </p>
                    </div>
                    <div>
                      <p className="text-[#8A948E] text-xs">Amount</p>
                      <p className="font-medium text-[#9ED9B0]">₱{b.totalAmount}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full border capitalize ${statusColors[b.status]}`}>
                        {b.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
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
                        {b.status !== 'confirmed' && (
                          <button
                            onClick={() => updateStatus(b, 'confirmed')}
                            className="p-2 rounded-lg bg-[#9ED9B0]/10 hover:bg-[#9ED9B0]/20 transition-colors"
                            title="Confirm"
                          >
                            <CheckCircle2 className="w-4 h-4 text-[#9ED9B0]" />
                          </button>
                        )}
                        {b.status !== 'cancelled' && (
                          <button
                            onClick={() => updateStatus(b, 'cancelled')}
                            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                            title="Cancel"
                          >
                            <XCircle className="w-4 h-4 text-red-300" />
                          </button>
                        )}
                        {b.status !== 'pending' && (
                          <button
                            onClick={() => updateStatus(b, 'pending')}
                            className="p-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 transition-colors"
                            title="Mark pending"
                          >
                            <Clock className="w-4 h-4 text-yellow-300" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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