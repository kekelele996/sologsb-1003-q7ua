import { seedDiscussions, seedGlossary, seedNotices, seedSegments } from '@/lib/seed'
import type { Discussion, ReturnNotice, Segment } from '@/lib/types'

/**
 * MSW 内存态的“服务端数据”，同时镜像到 localStorage，
 * 刷新后认领关系、退回通知和故障开关不会丢。
 */
const SERVER_STATE_KEY = 'sologsb-1003-msw-server-state-v1'

interface ServerState {
  segments: Segment[]
  discussions: Discussion[]
  notices: ReturnNotice[]
  reviewFault: boolean
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const freshState = (): ServerState => ({
  segments: clone(seedSegments),
  discussions: clone(seedDiscussions),
  notices: clone(seedNotices),
  reviewFault: false,
})

let state: ServerState | null = null

function load(): ServerState {
  if (state) return state
  try {
    const raw = localStorage.getItem(SERVER_STATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ServerState>
      if (Array.isArray(parsed.segments) && Array.isArray(parsed.notices)) {
        state = { ...freshState(), ...parsed }
        return state
      }
    }
  } catch { /* fall through to seed */ }
  state = freshState()
  return state
}

function persist() {
  if (!state) return
  try { localStorage.setItem(SERVER_STATE_KEY, JSON.stringify(state)) } catch { /* storage may be unavailable */ }
}

export const serverStore = {
  reset() {
    state = freshState()
    persist()
  },
  getSegments(): Segment[] {
    return clone(load().segments)
  },
  getDiscussions(): Discussion[] {
    return clone(load().discussions)
  },
  /** 退回通知按接收人过滤：认领人之外的任何人都拿不到退回原因 */
  getNoticesFor(userId: string | null): ReturnNotice[] {
    if (!userId) return []
    return clone(load().notices.filter((notice) => notice.ownerId === userId))
  },
  replaceSegments(segments: Segment[]) {
    const server = load()
    server.segments = clone(segments)
    persist()
  },
  replaceDiscussions(discussions: Discussion[]) {
    const server = load()
    server.discussions = clone(discussions)
    persist()
  },
  claim(segmentId: string, userId: string): { ok: boolean; status: number; message: string; segments?: Segment[] } {
    const server = load()
    const segment = server.segments.find((item) => item.id === segmentId)
    if (!segment) return { ok: false, status: 404, message: '片段不存在。' }
    if (segment.claimerId && segment.claimerId !== userId) {
      return { ok: false, status: 409, message: '该片段已被其他译者认领，请先在讨论区沟通。' }
    }
    if (segment.claimerId === userId) return { ok: true, status: 200, message: 'already claimed', segments: clone(server.segments) }
    server.segments = server.segments.map((item) => item.id === segmentId ? { ...item, claimerId: userId } : item)
    persist()
    return { ok: true, status: 200, message: 'claimed', segments: clone(server.segments) }
  },
  release(segmentId: string, userId: string): { ok: boolean; status: number; message: string; segments?: Segment[] } {
    const server = load()
    const segment = server.segments.find((item) => item.id === segmentId)
    if (!segment) return { ok: false, status: 404, message: '片段不存在。' }
    if (segment.claimerId !== userId) return { ok: false, status: 403, message: '只能取消自己的认领。' }
    server.segments = server.segments.map((item) => item.id === segmentId ? { ...item, claimerId: null } : item)
    persist()
    return { ok: true, status: 200, message: 'released', segments: clone(server.segments) }
  },
  /**
   * 审校确认 / 退回。
   * 退回时：片段标记为 returned，并给认领人定向写入一条退回原因；
   * 不修改译文正文——正文以译者重新提交的版本为准，本地草稿也因此不会被盖掉。
   */
  review(params: {
    action: 'confirm' | 'bulk-return' | 'return'
    segmentIds: string[]
    reason?: string
    reviewUserId: string
    reviewUserRole: string
    reviewAuthor: string
  }): { ok: boolean; status: number; message: string; segments?: Segment[]; notices?: ReturnNotice[]; unclaimed?: string[] } {
    const server = load()
    if (params.reviewUserRole !== 'reviewer') {
      return { ok: false, status: 403, message: '只有审校员可以执行确认 / 退回，已在服务端拦截。' }
    }
    const targets = server.segments.filter((item) => params.segmentIds.includes(item.id))
    if (!targets.length) return { ok: false, status: 404, message: '没有找到对应片段。' }
    const unclaimed = targets.filter((item) => !item.claimerId).map((item) => item.id)
    if (params.action !== 'confirm' && unclaimed.length) {
      return { ok: false, status: 409, message: `片段 ${unclaimed.join('、')} 尚未被认领，退回原因没有接收人。`, unclaimed }
    }
    const isConfirm = params.action === 'confirm'
    const now = Date.now()
    server.segments = server.segments.map((item) => params.segmentIds.includes(item.id)
      ? { ...item, status: isConfirm ? 'confirmed' as const : 'returned' as const }
      : item)
    const newNotices: ReturnNotice[] = []
    if (!isConfirm) {
      for (const segment of targets) {
        newNotices.push({
          id: `notice-${now}-${segment.id}-${Math.random().toString(36).slice(2, 6)}`,
          segmentId: segment.id,
          ownerId: segment.claimerId as string,
          reason: params.reason?.trim() || '（审校未填写退回原因）',
          serverText: segment.targetText,
          reviewAuthor: params.reviewAuthor,
          createdAt: now,
          dismissed: false,
        })
      }
      server.notices = [...newNotices, ...server.notices]
    }
    persist()
    return { ok: true, status: 200, message: 'reviewed', segments: clone(server.segments), notices: clone(server.notices) }
  },
  dismissNotice(noticeId: string, userId: string): { ok: boolean; status: number; message: string; notices?: ReturnNotice[] } {
    const server = load()
    const notice = server.notices.find((item) => item.id === noticeId)
    if (!notice) return { ok: false, status: 404, message: '通知不存在。' }
    if (notice.ownerId !== userId) return { ok: false, status: 403, message: '不能处理发给别人的退回通知。' }
    server.notices = server.notices.map((item) => item.id === noticeId ? { ...item, dismissed: true } : item)
    persist()
    return { ok: true, status: 200, message: 'dismissed', notices: clone(server.notices) }
  },
  /**
   * 译者提交草稿。服务端兜底：每段译文都必须由本人认领，且译者身份才能提交。
   */
  saveDraft(params: {
    userId: string
    userRole: string
    segments: Segment[]
  }): { ok: boolean; status: number; message: string; violations?: string[]; segments?: Segment[] } {
    const server = load()
    if (params.userRole !== 'translator') {
      return { ok: false, status: 403, message: '审校员不能提交译文，已在服务端拦截。' }
    }
    const current = new Map(server.segments.map((item) => [item.id, item]))
    const violations = params.segments
      .filter((incoming) => {
        const existing = current.get(incoming.id)
        return existing && existing.claimerId !== params.userId
      })
      .map((item) => item.id)
    if (violations.length) {
      return { ok: false, status: 403, message: `片段 ${violations.join('、')} 不是你认领的，提交已被服务端拒绝。`, violations }
    }
    const byId = new Map(params.segments.map((item) => [item.id, item]))
    server.segments = server.segments.map((existing) => {
      const incoming = byId.get(existing.id)
      if (!incoming || existing.claimerId !== params.userId) return existing
      // 认领人重新提交被退回的片段，状态回到草稿，等待再审
      const status = existing.status === 'returned' ? 'draft' as const : existing.status
      return { ...existing, targetText: incoming.targetText, status }
    })
    persist()
    return { ok: true, status: 200, message: 'saved', segments: clone(server.segments) }
  },
  isReviewFault(): boolean {
    return load().reviewFault
  },
  setReviewFault(value: boolean) {
    const server = load()
    server.reviewFault = value
    persist()
  },
}
