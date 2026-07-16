'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.push('/admin')
      router.refresh()
    } else {
      setError('Incorrect password.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#13291F] flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-gradient-to-b from-[#16332570] to-[#0F211A]/60 backdrop-blur-md rounded-2xl p-8 border border-[#9ED9B0]/25 shadow-[0_0_40px_-8px_rgba(158,217,176,0.35)]"
      >
        <div className="w-12 h-12 rounded-full bg-[#9ED9B0]/10 flex items-center justify-center mb-4 mx-auto">
          <Lock className="w-5 h-5 text-[#9ED9B0]" />
        </div>
        <h1 className="text-xl font-bold text-[#F1F2ED] text-center mb-6">Admin Access</h1>

        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-[#F1F2ED] placeholder:text-[#8A948E] focus:border-[#9ED9B0] focus:ring-4 focus:ring-[#9ED9B0]/15 outline-none transition-all mb-4"
        />

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#9ED9B0] text-[#13291F] font-semibold py-2.5 rounded-full hover:bg-[#8bcda0] active:scale-95 disabled:opacity-50 transition-all"
        >
          {loading ? 'Checking...' : 'Log In'}
        </button>
      </form>
    </main>
  )
}