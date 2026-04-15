function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export async function hashPassword(password: string) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iterations = 120000
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations,
      name: 'PBKDF2',
      salt,
    },
    keyMaterial,
    256,
  )

  return [
    'pbkdf2',
    'sha256',
    iterations,
    bytesToBase64(salt),
    bytesToBase64(new Uint8Array(derivedBits)),
  ].join('$')
}

export async function verifyPasswordHash(password: string, encodedHash: string) {
  const [method, digest, iterationValue, saltValue, hashValue] = encodedHash.split('$')

  if (
    method !== 'pbkdf2' ||
    digest !== 'sha256' ||
    !iterationValue ||
    !saltValue ||
    !hashValue
  ) {
    return false
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: Number(iterationValue),
      name: 'PBKDF2',
      salt: base64ToBytes(saltValue),
    },
    keyMaterial,
    256,
  )

  const actual = new Uint8Array(derivedBits)
  const expected = base64ToBytes(hashValue)

  if (actual.length !== expected.length) {
    return false
  }

  let mismatch = 0

  for (let index = 0; index < actual.length; index += 1) {
    mismatch |= actual[index] ^ expected[index]
  }

  return mismatch === 0
}
