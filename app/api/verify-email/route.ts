import { NextRequest, NextResponse } from 'next/server'
import { resolveMx } from 'dns/promises'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ valid: false, reason: 'Missing email' }, { status: 400 })
  }

  const domain = email.split('@')[1]
  if (!domain) {
    return NextResponse.json({ valid: false, reason: 'Invalid format' })
  }

  try {
    const records = await resolveMx(domain)
    const valid = records.length > 0
    return NextResponse.json({ valid })
  } catch {
    // No MX records found, or domain doesn't exist at all
    return NextResponse.json({ valid: false, reason: 'Domain cannot receive email' })
  }
}