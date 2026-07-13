import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEGREE_PROGRAMS, degreeProgramIconPath, degreeTypeOf } from './degreePrograms'

const WITHOUT_STRUCTURED_PLAN = [
  'artificial-intelligence',
  'infermieristica',
  'interpretariato-traduzione-lis-list',
  'ostetricia',
  'tecnologie-gestione-impresa-casearia',
]

describe('registro corsi UniMi', () => {
  it('mantiene 72 triennali e 9 magistrali a ciclo unico senza slug duplicati', () => {
    expect(DEGREE_PROGRAMS).toHaveLength(81)
    expect(new Set(DEGREE_PROGRAMS.map((program) => program.slug)).size).toBe(81)
    expect(DEGREE_PROGRAMS.filter((program) => degreeTypeOf(program) === 'triennale')).toHaveLength(72)
    expect(DEGREE_PROGRAMS.filter((program) => degreeTypeOf(program) === 'ciclo-unico')).toHaveLength(9)
  })

  it('lascia liberi solo i cinque corsi senza piano strutturato UniMi', () => {
    expect(
      DEGREE_PROGRAMS.filter((program) => !program.catalogReady)
        .map((program) => program.slug)
        .sort(),
    ).toEqual(WITHOUT_STRUCTURED_PLAN.sort())
  })

  it('etichetta esclusivamente i tre corsi con capofila esterno come interateneo', () => {
    expect(DEGREE_PROGRAMS.filter((program) => program.interateneo).map((program) => program.slug).sort()).toEqual([
      'artificial-intelligence',
      'interpretariato-traduzione-lis-list',
      'tecnologie-gestione-impresa-casearia',
    ])
  })

  it('associa a ogni corso una singola icona WebP locale', () => {
    const iconPaths = DEGREE_PROGRAMS.map(degreeProgramIconPath)

    expect(new Set(iconPaths).size).toBe(DEGREE_PROGRAMS.length)
    for (const iconPath of iconPaths) {
      expect(iconPath).toMatch(/^\/degree-icons\/[a-z0-9-]+\.webp$/)
      expect(existsSync(resolve(process.cwd(), 'public', iconPath.slice(1)))).toBe(true)
    }
  })
})
