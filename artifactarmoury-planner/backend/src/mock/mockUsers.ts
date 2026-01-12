import bcrypt from 'bcrypt'
import crypto from 'crypto'
import type { User } from '../middleware/auth'

export interface MockUser extends User {
  password_hash: string
  created_at: Date
}

const mockUsersById = new Map<string, MockUser>()
const mockUsersByEmail = new Map<string, MockUser>()

function toUserResponse(user: MockUser) {
  const { password_hash: _password, ...rest } = user
  return rest
}

function seedDefaultUser(params: {
  email: string
  displayName: string
  password: string
  role: User['role']
  artistName?: string
  artistBio?: string
  creatorVerified?: boolean
  verificationBadge?: string | null
}) {
  const normalizedEmail = params.email.toLowerCase()
  if (mockUsersByEmail.has(normalizedEmail)) return

  const id = crypto.randomUUID()
  const password_hash = bcrypt.hashSync(params.password, 10)
  const created_at = new Date()

  const user: MockUser = {
    id,
    email: normalizedEmail,
    display_name: params.displayName,
    role: params.role,
    artist_name: params.artistName,
    artist_bio: params.artistBio,
    account_status: 'active',
    creator_verified: Boolean(params.creatorVerified),
    verification_badge: params.verificationBadge ?? null,
    created_at,
    updated_at: created_at,
    password_hash,
  }

  mockUsersById.set(id, user)
  mockUsersByEmail.set(normalizedEmail, user)
}

function ensureDefaultUsers() {
  seedDefaultUser({
    email: 'demo@artifactarmoury.com',
    displayName: 'Demo Artist',
    password: 'demo123',
    role: 'artist',
    artistName: 'Demo Artist',
    artistBio: 'Sample showcase account for Artifact Armoury.',
    creatorVerified: true,
    verificationBadge: 'Trusted Creator',
  })

  seedDefaultUser({
    email: 'admin@artifactarmoury.com',
    displayName: 'Site Admin',
    password: 'admin123',
    role: 'admin',
    creatorVerified: true,
    verificationBadge: 'Staff',
  })
}

ensureDefaultUsers()

export async function createMockUser(params: {
  email: string
  password: string
  displayName: string
  role?: User['role']
  artistName?: string
}): Promise<MockUser> {
  const email = params.email.toLowerCase()
  if (mockUsersByEmail.has(email)) {
    throw new Error('Mock user already exists')
  }
  const id = crypto.randomUUID()
  const password_hash = await bcrypt.hash(params.password, 12)
  const now = new Date()
  const mockUser: MockUser = {
    id,
    email,
    display_name: params.displayName,
    role: params.role ?? 'customer',
    account_status: 'active',
    artist_name: params.artistName,
    creator_verified: false,
    verification_badge: null,
    created_at: now,
    updated_at: now,
    password_hash,
  }
  mockUsersById.set(id, mockUser)
  mockUsersByEmail.set(email, mockUser)
  return mockUser
}

export function getMockUserByEmail(email: string): MockUser | undefined {
  return mockUsersByEmail.get(email.toLowerCase())
}

export function getMockUserById(id: string): MockUser | undefined {
  return mockUsersById.get(id)
}

export function listMockUsers(): User[] {
  return Array.from(mockUsersById.values()).map(toUserResponse)
}

export function sanitizeMockUser(user: MockUser): User {
  return toUserResponse(user)
}

export async function setMockUserPassword(id: string, password: string): Promise<void> {
  const user = mockUsersById.get(id)
  if (!user) {
    throw new Error('Mock user not found')
  }
  user.password_hash = await bcrypt.hash(password, 12)
  user.updated_at = new Date()
  mockUsersById.set(id, user)
  mockUsersByEmail.set(user.email, user)
}
