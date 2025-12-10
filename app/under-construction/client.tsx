'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Settings {
  title?: string
  message?: string
  contactInfo?: string
  unitName?: string
}

export default function UnderConstructionClient({ settings }: { settings: Settings }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(false)
    setLoading(true)

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      if (response.ok) {
        router.push('/')
        router.refresh()
      } else {
        setError(true)
        setPassword('')
      }
    } catch (err) {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              🚧 {settings?.title || 'Under Construction'}
            </h1>
            <p className="text-gray-600">
              {settings?.unitName || 'London Kidney Clinical Research Unit'}
            </p>
          </div>

          <p className="text-gray-700 mb-6 text-center">
            {settings?.message || "We're updating our website. Enter the password to preview the new site."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                disabled={loading}
              />
              {error && (
                <p className="text-red-600 text-sm mt-2">
                  Incorrect password. Please try again.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition font-medium"
            >
              {loading ? 'Checking...' : 'Enter Site'}
            </button>
          </form>

          <p className="text-gray-500 text-sm text-center mt-6">
            {settings?.contactInfo || 'For access, contact the research unit.'}
          </p>
        </div>
      </div>
    </div>
  )
}
