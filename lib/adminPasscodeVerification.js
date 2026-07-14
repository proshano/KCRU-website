import crypto from 'crypto'

import { SecurityRateLimitError } from './securityRateLimit.js'

const PASSCODE_MAX_ATTEMPTS = 5
const PASSCODE_RESERVATION_RETRIES = PASSCODE_MAX_ATTEMPTS + 1

const SESSION_QUERY = `*[_type == "adminSession" && email == $email && revoked != true] | order(createdAt desc)[0]{
  _id,
  _rev,
  codeHash,
  codeExpiresAt,
  codeUsedAt,
  failedAttempts,
  passcodeLockedAt
}`

function tooManyAttemptsError() {
  return new SecurityRateLimitError('Too many invalid passcodes. Request a new code.', 60)
}

function isRevisionConflict(error) {
  return error?.statusCode === 409 ||
    error?.response?.statusCode === 409 ||
    error?.response?.status === 409
}

function assertUsableSession(session, now) {
  if (!session?._id || !session?._rev || !session.codeHash) {
    throw new Error('Passcode not found. Request a new code.')
  }
  if (session.codeUsedAt) {
    throw new Error('Passcode already used. Request a new code.')
  }
  if (session.codeExpiresAt && Date.parse(session.codeExpiresAt) < now) {
    throw new Error('Passcode expired. Request a new code.')
  }

  const consumedAttempts = Number(session.failedAttempts || 0)
  if (
    session.passcodeLockedAt ||
    !Number.isSafeInteger(consumedAttempts) ||
    consumedAttempts < 0 ||
    consumedAttempts >= PASSCODE_MAX_ATTEMPTS
  ) {
    throw tooManyAttemptsError()
  }

  return consumedAttempts
}

async function reservePasscodeAttempt({ client, email, now }) {
  for (let retry = 0; retry < PASSCODE_RESERVATION_RETRIES; retry += 1) {
    const session = await client.fetch(SESSION_QUERY, { email })
    const consumedAttempts = assertUsableSession(session, now)
    const nextAttempts = consumedAttempts + 1
    // This legacy field now counts every comparison, including a successful one.
    const reservation = { failedAttempts: nextAttempts }
    if (nextAttempts === PASSCODE_MAX_ATTEMPTS) {
      reservation.passcodeLockedAt = new Date(now).toISOString()
    }

    try {
      const reserved = await client
        .patch(session._id)
        .ifRevisionId(session._rev)
        .set(reservation)
        .commit({ returnDocuments: true })

      if (!reserved?._rev) {
        throw new Error('Passcode attempt reservation did not return a revision.')
      }
      return reserved
    } catch (error) {
      if (!isRevisionConflict(error)) throw error
    }
  }

  throw tooManyAttemptsError()
}

export function passcodeMatches(code, expectedHash) {
  const suppliedHash = crypto.createHash('sha256').update(code).digest('hex')
  const supplied = Buffer.from(suppliedHash, 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

export async function verifyAdminPasscodeChallenge({
  client,
  email,
  code,
  sessionTtlHours,
  now = Date.now(),
  compare = passcodeMatches,
  createToken = () => crypto.randomBytes(32).toString('hex'),
}) {
  const reserved = await reservePasscodeAttempt({ client, email, now })
  if (!compare(code, reserved.codeHash)) {
    throw new Error('Invalid passcode.')
  }

  const token = createToken()
  const expiresAt = new Date(now + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString()

  try {
    await client
      .patch(reserved._id)
      .ifRevisionId(reserved._rev)
      .set({
        token,
        expiresAt,
        codeUsedAt: new Date(now).toISOString(),
      })
      .commit({ returnDocuments: false })
  } catch (error) {
    if (isRevisionConflict(error)) {
      throw new Error('Passcode state changed. Request a new code.')
    }
    throw error
  }

  return { token, email, expiresAt }
}
