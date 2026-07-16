import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// SERVER-ONLY client — bypasses RLS. Never import this in a 'use client' file.
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)