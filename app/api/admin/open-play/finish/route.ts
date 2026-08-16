import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { sessionId } = await req.json()
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }

  const { data: sessionData, error: fetchError } = await supabaseAdmin
    .from('open_play_sessions')
    .select('id, price_per_person, open_play_participants(status)')
    .eq('id', sessionId)
    .single()

  if (fetchError || !sessionData) {
    return NextResponse.json({ error: fetchError?.message ?? 'Session not found' }, { status: 500 })
  }

  const confirmedCount = (sessionData.open_play_participants ?? []).filter(
    (p: any) => p.status === 'confirmed'
  ).length

  const total = confirmedCount * sessionData.price_per_person

  const { error: updateError } = await supabaseAdmin
    .from('open_play_sessions')
    .update({ status_finished: true, finished_total: total })
    .eq('id', sessionId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, total })
}