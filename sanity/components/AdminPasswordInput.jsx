'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { Stack, Text, TextInput, Button, Card } from '@sanity/ui'
import { set, unset } from 'sanity'

const HASH_PREFIX = 'pbkdf2'
const HASH_DIGEST = 'sha256'
const HASH_ITERATIONS = 120000
const HASH_BYTES = 64
const SALT_BYTES = 16

function toBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

async function hashPassword(value) {
  const encoder = new TextEncoder()
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: HASH_ITERATIONS,
    },
    keyMaterial,
    HASH_BYTES * 8
  )
  const hashBytes = new Uint8Array(derived)
  return `${HASH_PREFIX}$${HASH_DIGEST}$${HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(hashBytes)}`
}

export default function AdminPasswordInput(props) {
  const { value, onChange, readOnly } = props
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const canHash = useMemo(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.crypto?.subtle && window.crypto?.getRandomValues && window.TextEncoder)
  }, [])

  const handleSetPassword = useCallback(async () => {
    if (readOnly) return
    setError('')
    setStatus('')
    if (!password) {
      setError('Enter a password.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (!canHash) {
      setError('Password hashing is not available in this browser.')
      return
    }
    setStatus('Hashing password...')
    try {
      const hash = await hashPassword(password)
      onChange(set(hash))
      setPassword('')
      setStatus('Password set.')
    } catch (err) {
      setStatus('')
      setError('Failed to hash password.')
    }
  }, [password, readOnly, onChange, canHash])

  const handleClear = useCallback(() => {
    if (readOnly) return
    onChange(unset())
    setPassword('')
    setStatus('Password cleared.')
    setError('')
  }, [onChange, readOnly])

  const hasPassword = Boolean(value)

  return (
    <Stack space={3}>
      <Text size={1} muted>
        Enter a new password to set or replace the stored hash. Keep the hashing format in sync with
        the server-side verifier.
      </Text>
      <TextInput
        type="password"
        value={password}
        onChange={(event) => setPassword(event.currentTarget.value)}
        placeholder="Enter a new admin password"
        disabled={readOnly}
      />
      <Stack space={2}>
        <Button
          text="Set password"
          tone="primary"
          mode="ghost"
          disabled={readOnly || !password}
          onClick={handleSetPassword}
        />
        <Button
          text="Clear password"
          tone="critical"
          mode="ghost"
          disabled={readOnly || !hasPassword}
          onClick={handleClear}
        />
      </Stack>
      {hasPassword && (
        <Card padding={3} radius={2} tone="positive" border>
          <Text size={1}>Password hash is stored.</Text>
        </Card>
      )}
      {status && <Text size={1}>{status}</Text>}
      {error && <Text size={1} tone="critical">{error}</Text>}
    </Stack>
  )
}
