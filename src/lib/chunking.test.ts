import { describe, expect, it } from 'vitest'
import { chunkPages } from '../../supabase/functions/_shared/chunking.ts'

const prose = (label: string, words = 560) =>
  Array.from({ length: words }, (_, index) => `${label}${index}`).join(' ') + '.'

const expectNoOverlapOnlyChunks = (chunks: ReturnType<typeof chunkPages>) => {
  chunks.forEach((chunk, index) => {
    const isContainedInEarlierChunk = chunks
      .slice(0, index)
      .some((previous) => previous.content.includes(chunk.content))
    expect(isContainedInEarlierChunk).toBe(false)
  })
}

const sharedBoundary = (left: string, right: string): string => {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')
  for (let size = Math.min(leftLines.length, rightLines.length); size > 0; size -= 1) {
    const suffix = leftLines.slice(-size).join('\n')
    if (suffix === rightLines.slice(0, size).join('\n')) return suffix
  }
  return ''
}

describe('RAG section-aware chunking', () => {
  it('keeps text before a heading under the previous section', () => {
    const chunks = chunkPages([{
      pageNumber: 1,
      text: `CAPITOLO UNO\n${prose('a')}\nCAPITOLO DUE\n${prose('b')}`,
    }])

    const first = chunks.find((chunk) => chunk.content.includes('a100'))
    const second = chunks.find((chunk) => chunk.content.includes('b100'))
    expect(first?.sectionPath).toEqual(['CAPITOLO UNO'])
    expect(second?.sectionPath).toEqual(['CAPITOLO DUE'])
  })

  it('preserves the earliest page represented by overlap text', () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: `CAPITOLO TEST\n${prose('p1', 850)}` },
      { pageNumber: 2, text: prose('p2', 850) },
    ])

    const crossPage = chunks.find((chunk) => chunk.pageEnd === 2 && chunk.content.includes('p1'))
    expect(crossPage?.pageStart).toBe(1)
  })

  it('never emits duplicate chunk indexes', () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: prose('x', 1800) },
      { pageNumber: 2, text: prose('y', 1800) },
    ])
    expect(new Set(chunks.map((chunk) => chunk.chunkIndex)).size).toBe(chunks.length)
  })

  it('does not emit the final overlap tail as a standalone chunk', () => {
    const chunks = chunkPages([{ pageNumber: 7, text: prose('x', 600) }])

    expect(chunks).toHaveLength(1)
    expect(chunks[0].pageStart).toBe(7)
    expect(chunks[0].pageEnd).toBe(7)
    expect(chunks[0].tokenEstimate).toBeLessThanOrEqual(900)
    expectNoOverlapOnlyChunks(chunks)
  })

  it('drops an overlap-only tail before starting a new heading', () => {
    const chunks = chunkPages([{
      pageNumber: 3,
      text: `CAPITOLO UNO\n${prose('a', 600)}\nCAPITOLO DUE\n${prose('b', 80)}`,
    }])

    expect(chunks.filter((chunk) => chunk.sectionPath[0] === 'CAPITOLO UNO')).toHaveLength(1)
    expect(chunks.filter((chunk) => chunk.sectionPath[0] === 'CAPITOLO DUE')).toHaveLength(1)
    expectNoOverlapOnlyChunks(chunks)
  })

  it('keeps bounded overlap and target-sized chunks for long prose', () => {
    const chunks = chunkPages([{ pageNumber: 1, text: prose('long', 1800) }])

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 900)).toBe(true)
    expect(chunks.slice(0, -1).every((chunk) => chunk.tokenEstimate >= 700)).toBe(true)

    for (let index = 1; index < chunks.length; index += 1) {
      const overlap = sharedBoundary(chunks[index - 1].content, chunks[index].content)
      expect(overlap.length).toBeGreaterThan(0)
      expect(Math.ceil(overlap.length / 4)).toBeLessThanOrEqual(120)
    }
    expectNoOverlapOnlyChunks(chunks)
  })
})
