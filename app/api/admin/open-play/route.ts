import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabaseAdmin
    .from('open_play_sessions')
    .select('*, open_play_participants(*)')
    .order('session_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessions: data })
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { sessionDate, startTime, endTime, maxParticipants, pricePerPerson, title } = await req.json()

  if (!sessionDate || !startTime || !endTime || !maxParticipants || !pricePerPerson) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('open_play_sessions').insert({
    session_date: sessionDate,
    start_time: startTime,
    end_time: endTime,
    max_participants: maxParticipants,
    price_per_person: pricePerPerson,
    title: title || 'Open Play',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}