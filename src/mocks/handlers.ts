import { http, HttpResponse } from 'msw'
import { analyzeDocument } from '@/lib/markdown'
import { seedConflicts, seedDocument, seedHistory, seedReviewResults, seedSegments } from '@/lib/seed'
import type { GlossaryTerm, ReviewResult, Segment } from '@/lib/types'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 服务端维护的片段认领表：segmentId -> 认领人 */
const claims = new Map<string, string>()
for (const segment of seedSegments) {
  if (segment.claimedBy) claims.set(segment.id, segment.claimedBy)
}

/** 服务端待投递的审校退回结果（原因只发给认领人） */
let reviewResults: ReviewResult[] = clone(seedReviewResults)

export const handlers = [
  http.get('/api/document', () => HttpResponse.json(clone(seedDocument))),
  http.get('/api/history', () => HttpResponse.json(clone(seedHistory))),
  http.get('/api/conflicts', () => HttpResponse.json(clone(seedConflicts))),
  http.post('/api/check', async ({ request }) => {
    const body = await request.json() as { segments: Segment[]; glossary: GlossaryTerm[] }
    await new Promise((resolve) => setTimeout(resolve, 320))
    return HttpResponse.json({ checkedAt: Date.now(), issues: analyzeDocument(body.segments, body.glossary) })
  }),
  http.post('/api/claim', async ({ request }) => {
    const body = await request.json() as { segmentId: string; author: string; action: 'claim' | 'release' }
    const current = claims.get(body.segmentId)
    if (body.action === 'claim') {
      if (current && current !== body.author) {
        return HttpResponse.json({ error: 'already-claimed', claimedBy: current, message: `片段已由 ${current} 认领` }, { status: 409 })
      }
      claims.set(body.segmentId, body.author)
      return HttpResponse.json({ ok: true, segmentId: body.segmentId, claimedBy: body.author })
    }
    if (current !== body.author) {
      return HttpResponse.json({ error: 'not-owner', message: '只有认领人本人才能释放认领' }, { status: 403 })
    }
    claims.delete(body.segmentId)
    return HttpResponse.json({ ok: true, segmentId: body.segmentId, claimedBy: null })
  }),
  http.post('/api/draft', async ({ request }) => {
    const body = await request.json() as { documentId: string; author: string; segments: Segment[]; discussions: unknown[] }
    // 越权提交先在服务端挡下：非本人认领的片段一律拒绝
    for (const segment of body.segments) {
      if (segment.claimedBy !== body.author) {
        return HttpResponse.json({
          error: 'forbidden',
          segmentId: segment.id,
          message: `片段 #${segment.index} 已由其他译者认领，越权提交已被服务端阻止`,
        }, { status: 403 })
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 240))
    return HttpResponse.json({ saved: true, documentId: body.documentId, segmentCount: body.segments.length, savedAt: Date.now() })
  }),
  http.post('/api/review', async ({ request }) => {
    const body = await request.json() as { action: string; segmentIds: string[]; reason?: string; reviewer: string; simulateFailure?: boolean }
    await new Promise((resolve) => setTimeout(resolve, 280))
    if (body.simulateFailure) {
      return HttpResponse.json({ error: 'review-unavailable', message: '审校服务暂时不可用，退回未生效' }, { status: 503 })
    }
    const results: ReviewResult[] = body.segmentIds.map((segmentId) => ({
      id: `rr-${Date.now()}-${segmentId}`,
      segmentId,
      action: body.action as 'return' | 'confirm',
      reason: body.action === 'return' ? body.reason : undefined,
      reviewer: body.reviewer,
      createdAt: Date.now(),
    }))
    reviewResults.push(...results)
    return HttpResponse.json({ accepted: true, action: body.action, results, reviewedAt: Date.now() })
  }),
  http.get('/api/review-results', ({ request }) => {
    const author = new URL(request.url).searchParams.get('author') ?? ''
    // 退回原因只投递给认领人本人：非认领人的结果不会出现在此接口
    const addressed = reviewResults.filter((result) => result.action === 'return' && claims.get(result.segmentId) === author)
    reviewResults = reviewResults.filter((result) => !addressed.some((delivered) => delivered.id === result.id))
    return HttpResponse.json(clone(addressed))
  }),
]
