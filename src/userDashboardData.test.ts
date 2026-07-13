import { describe, expect, it } from 'vitest'
import type { DocumentItem } from './data'
import type { AppAuthUser } from './lib/supabaseClient'
import { buildUserDashboardData } from './userDashboardData'

const realUser: AppAuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'studentessa@unimi.it',
  name: 'Giulia Test',
  isDemo: false,
}

const upload: DocumentItem = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Diritto privato - Appunti',
  subject: 'Diritto privato',
  professor: 'Docente Test',
  academicYear: '2025/26',
  type: 'Appunti delle lezioni',
  examType: 'Orale',
  pages: 42,
  sizeMb: 2.4,
  quality: 0,
  credits: 6,
  downloads: 0,
  description: 'Test',
  status: 'pendingreview',
  verified: false,
  premium: false,
  uploader: 'Giulia Test',
  uploaderTrust: 0,
  fileHash: 'test',
  malwareScan: 'in corso',
  copyrightRisk: 'basso',
  reportCount: 0,
  uploadedAt: '13/07/2026',
  language: 'Italiano',
  previewKind: 'notes',
}

describe('buildUserDashboardData for real accounts', () => {
  it('never fabricates purchases, study history or notifications', () => {
    const data = buildUserDashboardData({ user: realUser, credits: 25, documents: [], uploads: [upload] })

    expect(data.notifications).toEqual([])
    expect(data.decks).toEqual([])
    expect(data.subjectProgress).toEqual([])
    expect(data.documentProgress).toEqual([])
    expect(data.sessions).toEqual([])
    expect(data.reviews).toEqual([])
    expect(data.shelves.find((shelf) => shelf.id === 'purchased')?.documents).toEqual([])
  })

  it('keeps uploads and exposes a distinct persistent wishlist shelf', () => {
    const data = buildUserDashboardData({ user: realUser, credits: 25, documents: [], uploads: [upload] })

    expect(data.shelves.find((shelf) => shelf.id === 'uploads')?.documents).toEqual([upload])
    expect(data.shelves.find((shelf) => shelf.id === 'wishlist')).toMatchObject({
      label: 'Wishlist',
      documents: [],
    })
  })
})
