import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { sessionId, name, email, phone, proofUrl, slotNumbers } = await req.json()

  if (!sessionId || !name || !email || !phone || !proofUrl || !Array.isArray(slotNumbers) || slotNumbers.length === 0) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: sessionData } = await supabaseAdmin
    .from('open_play_sessions')
    .select('max_participants, price_per_person, open_play_participants(slot_number, status)')
    .eq('id', sessionId)
    .single()

  if (!sessionData) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const takenSlots = (sessionData.open_play_participants ?? [])
    .filter((p: any) => p.status !== 'cancelled')
    .map((p: any) => p.slot_number)

  const conflict = slotNumbers.find((n: number) => takenSlots.includes(n))
  if (conflict) {
    return NextResponse.json({ error: `Slot #${conflict} was just taken by someone else. Please pick another.` }, { status: 409 })
  }

  const invalidSlot = slotNumbers.find((n: number) => n < 1 || n > sessionData.max_participants)
  if (invalidSlot) {
    return NextResponse.json({ error: 'Invalid slot selected.' }, { status: 400 })
  }

  const groupId = crypto.randomUUID()

  const rows = slotNumbers.map((slotNumber: number) => ({
    session_id: sessionId,
    group_id: groupId,
    slot_number: slotNumber,
    name,
    email,
    phone,
    amount: sessionData.price_per_person,
    proof_url: proofUrl,
  }))

  const { error } = await supabaseAdmin.from('open_play_participants').insert(rows)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}