import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('open_play_sessions')
.select('*, open_play_participants(id, status, name, slot_number)')    .eq('status', 'active')
    .gte('session_date', today)
    .order('session_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessions: data ?? [] })
}