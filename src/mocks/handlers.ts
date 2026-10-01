import { http, HttpResponse } from 'msw'
import { analyzeDocument } from '@/lib/markdown'
import { seedConflicts, seedDocument, seedGlossary, seedHistory } from '@/lib/seed'
import { serverStore } from './server-state'
import type { GlossaryTerm, Segment } from '@/lib/types'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const jsonError = (status: number, message: string, extra?: Record<string, unknown>) =>
  HttpResponse.json({ error: true, message, ...extra }, { status })

export const handlers = [
  http.get('/api/document', () => {
    return HttpResponse.json({
      ...clone(seedDocument),
      updatedAt: Date.now(),
      segments: serverStore.getSegments(),
      discussions: serverStore.getDiscussions(),
    })
  }),
  http.get('/api/history', () => HttpResponse.json(clone(seedHistory))),
  http.get('/api/conflicts', () => HttpResponse.json(clone(seedConflicts))),
  // 退回原因只发给认领人：按 userId 定向返回
  http.get('/api/notices', ({ request }) => {
    const userId = new URL(request.url).searchParams.get('userId') ?? ''
    return HttpResponse.json({ notices: serverStore.getNoticesFor(userId) })
  }),
  http.post('/api/notices/:id/dismiss', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { userId?: string }
    const result = serverStore.dismissNotice(String(params.id), body.userId ?? '')
    if (!result.ok) return jsonError(result.status, result.message)
    return HttpResponse.json({ dismissed: true, notices: result.notices })
  }),
  http.post('/api/check', async ({ request }) => {
    const body = await request.json() as { segments: Segment[]; glossary: GlossaryTerm[] }
    await new Promise((resolve) => setTimeout(resolve, 320))
    return HttpResponse.json({ checkedAt: Date.now(), issues: analyzeDocument(body.segments, body.glossary) })
  }),
  // 草稿提交：服务端兜底越权校验，非认领片段一律 403
  http.post('/api/draft', async ({ request }) => {
    const body = await request.json() as { userId: string; userRole: string; segments: Segment[] }
    await new Promise((resolve) => setTimeout(resolve, 240))
    const result = serverStore.saveDraft({ userId: body.userId, userRole: body.userRole, segments: body.segments })
    if (!result.ok) return jsonError(result.status, result.message, { violations: result.violations })
    return HttpResponse.json({ saved: true, documentId: seedDocument.id, segmentCount: body.segments.length, savedAt: Date.now(), segments: result.segments })
  }),
  // 认领：译者身份 + 片段未被他人占用
  http.post('/api/segments/:id/claim', async ({ params, request }) => {
    const body = await request.json() as { userId: string; userRole: string }
    if (body.userRole !== 'translator') return jsonError(403, '只有译者可以认领片段。')
    await new Promise((resolve) => setTimeout(resolve, 200))
    const result = serverStore.claim(String(params.id), body.userId)
    if (!result.ok) return jsonError(result.status, result.message)
    return HttpResponse.json({ claimed: true, segments: result.segments })
  }),
  http.post('/api/segments/:id/release', async ({ params, request }) => {
    const body = await request.json() as { userId: string; userRole: string }
    if (body.userRole !== 'translator') return jsonError(403, '只有译者可以取消认领。')
    const result = serverStore.release(String(params.id), body.userId)
    if (!result.ok) return jsonError(result.status, result.message)
    return HttpResponse.json({ released: true, segments: result.segments })
  }),
  // 审校确认 / 退回：仅审校员；退回原因定向写入认领人的通知
  http.post('/api/review', async ({ request }) => {
    const body = await request.json() as {
      action: 'confirm' | 'return' | 'bulk-return'
      segmentIds: string[]
      reason?: string
      reviewUserId: string
      reviewUserRole: string
      reviewAuthor: string
    }
    await new Promise((resolve) => setTimeout(resolve, 280))
    // 模拟服务端退回接口故障：提交不落库，由客户端进入待重试队列
    if (serverStore.isReviewFault()) {
      return jsonError(503, '模拟：审校服务暂时不可用，退回结果没有送达，已留在本地待重试。')
    }
    const result = serverStore.review(body)
    if (!result.ok) return jsonError(result.status, result.message, { unclaimed: result.unclaimed })
    return HttpResponse.json({ accepted: true, action: body.action, reviewedAt: Date.now(), segments: result.segments })
  }),
  // 演示用：开关审校服务故障
  http.get('/api/debug/review-fault', () => HttpResponse.json({ reviewFault: serverStore.isReviewFault() })),
  http.post('/api/debug/review-fault', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { enabled?: boolean }
    serverStore.setReviewFault(Boolean(body.enabled))
    return HttpResponse.json({ reviewFault: serverStore.isReviewFault() })
  }),
  // 导入新文档：重置片段与认领关系
  http.post('/api/import', async ({ request }) => {
    const body = await request.json() as { segments: Segment[] }
    await new Promise((resolve) => setTimeout(resolve, 200))
    serverStore.replaceSegments(body.segments)
    serverStore.replaceDiscussions([])
    return HttpResponse.json({ imported: true, segments: serverStore.getSegments() })
  }),
  // 术语表始终来自种子数据
  http.get('/api/glossary', () => HttpResponse.json(clone(seedGlossary))),
]
