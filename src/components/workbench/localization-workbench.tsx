'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, ArrowDown, ArrowUp, Bell, BookOpen, Check, CheckCheck, ChevronRight,
  CircleAlert, Cloud, CloudOff, Code2, Download, FileText, GitCompare, History, Import,
  Languages, Link2, Loader2, Lock, MessageSquare, RefreshCw, RotateCcw, RotateCw, Save, Search,
  Send, ShieldCheck, Sparkles, Undo2, UndoDot, UserCheck, UserPlus, Variable, X, Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { analyzeDocument, parseMarkdown, renderTargetMarkdown } from '@/lib/markdown'
import {
  seedConflicts, seedDiscussions, seedDocument, seedGlossary, seedHistory, seedSegments, seedUsers,
} from '@/lib/seed'
import type {
  Discussion, GlossaryTerm, HistoryEntry, PendingReturnOperation, ReturnNotice,
  Segment, SegmentStatus, TranslationConflict, TranslationIssue, User,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const LOCAL_STATE_KEY = 'sologsb-1003-workbench-local-v2'
const CURRENT_USER_KEY = 'sologsb-1003-current-user'
const kindIcon = { heading: <FileText className="h-3.5 w-3.5" />, paragraph: <FileText className="h-3.5 w-3.5" />, code: <Code2 className="h-3.5 w-3.5" />, link: <Link2 className="h-3.5 w-3.5" />, variable: <Variable className="h-3.5 w-3.5" /> }
const kindLabel: Record<Segment['kind'], string> = { heading: '标题', paragraph: '段落', code: '代码块', link: '链接', variable: '占位符' }
const statusLabel: Record<SegmentStatus, string> = { draft: '草稿', 'needs-work': '待处理', confirmed: '已确认', returned: '已退回' }
const statusClass: Record<SegmentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700', 'needs-work': 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800', returned: 'bg-red-100 text-red-800',
}
const issueLabel: Record<TranslationIssue['type'], string> = {
  'missing-translation': '漏译', 'missing-variable': '变量缺失', 'link-mismatch': '链接不一致', glossary: '术语不一致', 'code-format': '代码格式',
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const actionLabel: Record<HistoryEntry['action'], string> = {
  edit: '编辑译文', confirm: '审校确认', return: '审校退回', 'resolve-conflict': '解决冲突', import: '导入文档', discussion: '添加讨论', claim: '认领片段', release: '取消认领',
}

interface LocalState {
  /** 未提交的译文改动，按用户隔离：{ [userId]: { [segmentId]: text } } */
  edits: Record<string, Record<string, string>>
  /** 审校退回提交失败后留在本地待重试的记录，按审校用户隔离 */
  pendingReturns: Record<string, PendingReturnOperation[]>
  /** 已忽略的通知，按用户隔离 */
  dismissedNotices: Record<string, string[]>
}

interface EditorSnapshot {
  edits: Record<string, string>
  discussions: Discussion[]
}

interface Toast {
  id: string
  tone: 'info' | 'success' | 'error'
  message: string
}

const emptyLocalState: LocalState = { edits: {}, pendingReturns: {}, dismissedNotices: {} }

export function LocalizationWorkbench() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [currentUser, setCurrentUser] = useState<User>(() => {
    if (typeof window === 'undefined') return seedUsers[0]
    const savedId = localStorage.getItem(CURRENT_USER_KEY)
    return seedUsers.find((user) => user.id === savedId) ?? seedUsers[0]
  })
  const [serverSegments, setServerSegments] = useState<Segment[]>(seedSegments)
  const [glossary] = useState<GlossaryTerm[]>(seedGlossary)
  const [discussions, setDiscussions] = useState<Discussion[]>(seedDiscussions)
  const [history, setHistory] = useState<HistoryEntry[]>(seedHistory)
  const [conflicts, setConflicts] = useState<TranslationConflict[]>(seedConflicts)
  const [checkedIssues, setCheckedIssues] = useState<TranslationIssue[] | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState('seg-05')
  const [mode, setMode] = useState<'translate' | 'review'>('translate')
  const [filter, setFilter] = useState<'all' | 'issues' | 'untranslated' | 'confirmed'>('all')
  const [glossarySearch, setGlossarySearch] = useState('')
  const [discussionDraft, setDiscussionDraft] = useState('')
  const [selectedForReturn, setSelectedForReturn] = useState<Set<string>>(new Set())
  const [returnReason, setReturnReason] = useState('请根据术语表修改后重新提交。')
  const [dirty, setDirty] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [localState, setLocalState] = useState<LocalState>(emptyLocalState)
  const [notices, setNotices] = useState<ReturnNotice[]>([])
  const [inboxOpen, setInboxOpen] = useState(false)
  const [reviewFault, setReviewFault] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [past, setPast] = useState<EditorSnapshot[]>([])
  const [future, setFuture] = useState<EditorSnapshot[]>([])

  const isReviewer = currentUser.role === 'reviewer'
  const myEdits = localState.edits[currentUser.id] ?? {}
  const myPendingReturns = localState.pendingReturns[currentUser.id] ?? []
  const myDismissed = new Set(localState.dismissedNotices[currentUser.id] ?? [])

  const pushToast = (tone: Toast['tone'], message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts((current) => [...current, { id, tone, message }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200)
  }

  const patchLocalState = (patch: (current: LocalState) => LocalState, markDirty = true) => {
    setLocalState((current) => patch(current))
    if (markDirty) setDirty(true)
  }

  // ---------- 数据加载 ----------
  const documentQuery = useQuery({
    queryKey: ['localization-document'],
    queryFn: async () => {
      const response = await fetch('/api/document')
      if (!response.ok) throw new Error('document request failed')
      return response.json() as Promise<typeof seedDocument>
    },
    initialData: seedDocument,
  })
  const historyQuery = useQuery({
    queryKey: ['localization-history'],
    queryFn: async () => {
      const response = await fetch('/api/history')
      if (!response.ok) throw new Error('history request failed')
      return response.json() as Promise<HistoryEntry[]>
    },
    initialData: seedHistory,
  })
  const conflictQuery = useQuery({
    queryKey: ['localization-conflicts'],
    queryFn: async () => {
      const response = await fetch('/api/conflicts')
      if (!response.ok) throw new Error('conflicts request failed')
      return response.json() as Promise<TranslationConflict[]>
    },
    initialData: seedConflicts,
  })
  const noticesQuery = useQuery({
    queryKey: ['return-notices', currentUser.id],
    enabled: hydrated,
    queryFn: async () => {
      const response = await fetch(`/api/notices?userId=${encodeURIComponent(currentUser.id)}`)
      if (!response.ok) throw new Error('notices request failed')
      return response.json() as Promise<{ notices: ReturnNotice[] }>
    },
  })

  // 初始水合：服务端文档 + 本地未提交状态
  useEffect(() => {
    if (hydrated) return
    setServerSegments(documentQuery.data.segments)
    setDiscussions(documentQuery.data.discussions)
    try {
      const raw = localStorage.getItem(LOCAL_STATE_KEY)
      if (raw) setLocalState({ ...clone(emptyLocalState), ...(JSON.parse(raw) as LocalState) })
    } catch { /* start empty */ }
    setHydrated(true)
  }, [hydrated, documentQuery.data])

  useEffect(() => {
    if (!hydrated) return
    setServerSegments(documentQuery.data.segments)
    setDiscussions(documentQuery.data.discussions)
  }, [documentQuery.data, hydrated])

  useEffect(() => {
    if (noticesQuery.data) setNotices(noticesQuery.data.notices)
  }, [noticesQuery.data])

  useEffect(() => {
    if (historyQuery.data) setHistory(historyQuery.data)
  }, [historyQuery.data])
  useEffect(() => {
    if (conflictQuery.data) setConflicts(conflictQuery.data)
  }, [conflictQuery.data])

  // 同步持久化的审校服务故障开关
  useEffect(() => {
    fetch('/api/debug/review-fault')
      .then((response) => response.ok ? response.json() as Promise<{ reviewFault: boolean }> : null)
      .then((data) => { if (data) setReviewFault(data.reviewFault) })
      .catch(() => { /* MSW 未就绪时按默认正常状态 */ })
  }, [hydrated])

  // 本地未提交状态持久化
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(localState)) } catch { /* storage may be unavailable */ }
  }, [hydrated, localState])

  useEffect(() => {
    try { localStorage.setItem(CURRENT_USER_KEY, currentUser.id) } catch { /* ignore */ }
  }, [currentUser.id])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  // 切换身份：重置与身份绑定的临时视图
  const switchUser = (user: User) => {
    if (user.id === currentUser.id) return
    setCurrentUser(user)
    setSelectedForReturn(new Set())
    setInboxOpen(false)
    setCheckedIssues(null)
    setPast([])
    setFuture([])
    setMode(user.role === 'reviewer' ? 'review' : 'translate')
  }

  // ---------- 派生数据：服务端片段 + 当前用户未提交改动 ----------
  const segments = useMemo<Segment[]>(() => serverSegments.map((segment) => (
    Object.prototype.hasOwnProperty.call(myEdits, segment.id)
      ? { ...segment, targetText: myEdits[segment.id] }
      : segment
  )), [serverSegments, myEdits])

  const dirtySegmentIds = useMemo(() => new Set(serverSegments
    .filter((segment) => Object.prototype.hasOwnProperty.call(myEdits, segment.id) && myEdits[segment.id] !== segment.targetText)
    .map((segment) => segment.id)), [serverSegments, myEdits])

  const activeNotices = useMemo(() => notices
    .filter((notice) => !notice.dismissed && !myDismissed.has(notice.id))
    .sort((a, b) => b.createdAt - a.createdAt), [notices, myDismissed])
  const noticeBySegment = useMemo(() => activeNotices.reduce<Record<string, ReturnNotice>>((map, notice) => {
    map[notice.segmentId] = notice
    return map
  }, {}), [activeNotices])

  const liveIssues = useMemo(() => analyzeDocument(segments, glossary), [segments, glossary])
  const issues = checkedIssues ?? liveIssues
  const issueMap = useMemo(() => issues.reduce<Record<string, TranslationIssue[]>>((map, issue) => {
    map[issue.segmentId] = [...(map[issue.segmentId] ?? []), issue]
    return map
  }, {}), [issues])
  const issueSegmentIds = useMemo(() => new Set(issues.map((issue) => issue.segmentId)), [issues])
  const filteredSegments = useMemo(() => segments.filter((segment) => {
    if (filter === 'issues') return issueSegmentIds.has(segment.id)
    if (filter === 'untranslated') return !segment.targetText.trim()
    if (filter === 'confirmed') return segment.status === 'confirmed'
    return true
  }), [filter, issueSegmentIds, segments])
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0]
  const confirmedCount = segments.filter((segment) => segment.status === 'confirmed').length
  const translatedCount = segments.filter((segment) => segment.targetText.trim()).length
  const progress = segments.length ? Math.round((confirmedCount / segments.length) * 100) : 0
  const filteredGlossary = glossary.filter((term) => `${term.source} ${term.target}`.toLowerCase().includes(glossarySearch.toLowerCase()))
  const selectedDiscussions = discussions.filter((discussion) => discussion.segmentId === selectedSegment?.id)
  const mockConnected = documentQuery.isFetched && historyQuery.isFetched && conflictQuery.isFetched
  const userMap = useMemo(() => new Map(seedUsers.map((user) => [user.id, user])), [])
  const claimerName = (id: string | null) => id ? userMap.get(id)?.name ?? '未知译者' : null

  // ---------- 撤销 / 重做（只覆盖译文编辑与讨论） ----------
  const takeSnapshot = (): EditorSnapshot => ({ edits: clone(myEdits), discussions: clone(discussions) })
  const pushUndo = () => {
    setPast((current) => [...current.slice(-49), takeSnapshot()])
    setFuture([])
  }
  const undo = () => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((current) => [takeSnapshot(), ...current])
    setPast((current) => current.slice(0, -1))
    restoreSnapshot(previous)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((current) => [...current, takeSnapshot()])
    setFuture((current) => current.slice(1))
    restoreSnapshot(next)
  }
  const restoreSnapshot = (snapshotToRestore: EditorSnapshot) => {
    patchLocalState((current) => ({
      ...current,
      edits: { ...current.edits, [currentUser.id]: snapshotToRestore.edits },
    }))
    setDiscussions(snapshotToRestore.discussions)
    setCheckedIssues(null)
  }

  const pushHistoryEntry = (segmentId: string, action: HistoryEntry['action'], before: string, after: string, author = currentUser.name) => {
    setHistory((current) => [{ id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, segmentId, author, action, before, after, createdAt: Date.now() }, ...current])
  }

  // ---------- 译文编辑：只有认领人（译者）能改 ----------
  const canEditSegment = (segment: Segment) => !isReviewer && segment.claimerId === currentUser.id
  const updateTarget = (segment: Segment, targetText: string) => {
    if (isReviewer) { pushToast('error', '审校员不能直接修改译文，只能确认或退回。'); return }
    if (segment.claimerId !== currentUser.id) { pushToast('error', `该片段由 ${claimerName(segment.claimerId) ?? '其他译者'} 认领，你只能参与讨论。`); return }
    pushUndo()
    patchLocalState((current) => ({
      ...current,
      edits: { ...current.edits, [currentUser.id]: { ...(current.edits[currentUser.id] ?? {}), [segment.id]: targetText } },
    }))
  }

  // ---------- 认领 / 取消认领 ----------
  const claimMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const response = await fetch(`/api/segments/${segmentId}/claim`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, userRole: currentUser.role }),
      })
      const body = await response.json().catch(() => ({})) as { message?: string; segments?: Segment[] }
      if (!response.ok) throw new Error(body.message ?? '认领失败')
      return body
    },
    onSuccess: (body, segmentId) => {
      if (body.segments) setServerSegments(body.segments)
      pushHistoryEntry(segmentId, 'claim', '', '认领片段')
      setDirty(true)
      pushToast('success', '认领成功，现在只有你能修改这段译文。')
    },
    onError: (error: Error) => pushToast('error', error.message),
  })
  const releaseMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const response = await fetch(`/api/segments/${segmentId}/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, userRole: currentUser.role }),
      })
      const body = await response.json().catch(() => ({})) as { message?: string; segments?: Segment[] }
      if (!response.ok) throw new Error(body.message ?? '取消认领失败')
      return body
    },
    onSuccess: (body, segmentId) => {
      if (body.segments) setServerSegments(body.segments)
      pushHistoryEntry(segmentId, 'release', '认领片段', '')
      pushToast('info', '已取消认领，未提交的本地改动仍然保留。')
    },
    onError: (error: Error) => pushToast('error', error.message),
  })

  // ---------- 术语检查 ----------
  const checkMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments, glossary }) })
      if (!response.ok) throw new Error('check failed')
      return response.json() as Promise<{ checkedAt: number; issues: TranslationIssue[] }>
    },
    onSuccess: (data) => {
      setCheckedIssues(data.issues)
      setFilter('issues')
    },
    onError: () => pushToast('error', '术语检查请求失败，请稍后重试。'),
  })

  // ---------- 保存草稿：客户端先挡越权，服务端再兜底 ----------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payloadSegments = serverSegments
        .filter((segment) => dirtySegmentIds.has(segment.id))
        .map((segment) => ({ ...segment, targetText: myEdits[segment.id] }))
      const response = await fetch('/api/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, userRole: currentUser.role, segments: payloadSegments }),
      })
      const body = await response.json().catch(() => ({})) as { message?: string; segments?: Segment[] }
      if (!response.ok) throw new Error(body.message ?? '保存失败')
      return body
    },
    onSuccess: (body) => {
      if (body.segments) setServerSegments(body.segments)
      // 提交成功后清掉本地未提交改动
      patchLocalState((current) => {
        const nextEdits = { ...(current.edits[currentUser.id] ?? {}) }
        dirtySegmentIds.forEach((id) => { delete nextEdits[id] })
        return { ...current, edits: { ...current.edits, [currentUser.id]: nextEdits } }
      }, false)
      setDirty(false)
      pushToast('success', `已提交 ${dirtySegmentIds.size} 个片段的译文。`)
      void queryClient.invalidateQueries({ queryKey: ['localization-document'] })
    },
    onError: (error: Error) => pushToast('error', `提交被拒绝：${error.message}`),
  })
  const saveDraft = () => {
    // 客户端第一道拦截：审校 / 没有自己的未提交改动
    if (isReviewer) { pushToast('error', '审校员不能提交译文。'); return }
    if (!dirtySegmentIds.size) { pushToast('info', '当前没有属于你的未提交改动。'); return }
    // 客户端第二道拦截：每段都必须由本人认领
    const foreign = serverSegments
      .filter((segment) => dirtySegmentIds.has(segment.id) && segment.claimerId !== currentUser.id)
      .map((segment) => `#${segment.index}`)
    if (foreign.length) { pushToast('error', `片段 ${foreign.join('、')} 不是你认领的，已在客户端挡下，不会发送请求。`); return }
    saveMutation.mutate()
  }

  // ---------- 审校确认 / 退回 ----------
  const reviewMutation = useMutation({
    mutationFn: async (payload: { action: 'confirm' | 'return' | 'bulk-return'; segmentIds: string[]; reason?: string }) => {
      const response = await fetch('/api/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, reviewUserId: currentUser.id, reviewUserRole: currentUser.role, reviewAuthor: currentUser.name }),
      })
      const body = await response.json().catch(() => ({})) as { message?: string; segments?: Segment[] }
      if (!response.ok) throw new Error(body.message ?? '审校请求失败')
      return body
    },
  })
  const guardReviewable = (segmentIds: string[]): boolean => {
    if (!isReviewer) { pushToast('error', '只有审校员可以确认或退回，操作已在客户端挡下。'); return false }
    const unclaimed = serverSegments.filter((segment) => segmentIds.includes(segment.id) && !segment.claimerId)
    if (unclaimed.length) { pushToast('error', `片段 ${unclaimed.map((segment) => `#${segment.index}`).join('、')} 还没有译者认领，退回原因没有接收人。`); return false }
    return true
  }
  const submitReview = async (action: 'confirm' | 'return' | 'bulk-return', segmentIds: string[], reason?: string) => {
    if (!segmentIds.length || !guardReviewable(segmentIds)) return
    try {
      const body = await reviewMutation.mutateAsync({ action, segmentIds, reason })
      if (body.segments) setServerSegments(body.segments)
      segmentIds.forEach((id) => {
        const segment = serverSegments.find((item) => item.id === id)
        pushHistoryEntry(id, action === 'confirm' ? 'confirm' : 'return', segment?.targetText ?? '', action === 'confirm' ? '审校确认' : `退回原因：${reason ?? ''}`, currentUser.name)
      })
      setSelectedForReturn(new Set())
      pushToast('success', action === 'confirm' ? `已确认 ${segmentIds.length} 个片段。` : `已退回 ${segmentIds.length} 个片段，原因仅发送给对应认领人。`)
      void queryClient.invalidateQueries({ queryKey: ['return-notices'] })
      void queryClient.invalidateQueries({ queryKey: ['localization-document'] })
    } catch (error) {
      // 服务端退回失败：保留在本地待重试，认领人的译文与状态都不改动
      if (action !== 'confirm') {
        const operation: PendingReturnOperation = {
          id: `pending-return-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          segmentIds: [...segmentIds],
          reason: reason ?? '',
          reviewUserId: currentUser.id,
          reviewAuthor: currentUser.name,
          createdAt: Date.now(),
          lastError: error instanceof Error ? error.message : '未知错误',
          attempts: 1,
        }
        patchLocalState((current) => ({
          ...current,
          pendingReturns: { ...current.pendingReturns, [currentUser.id]: [...(current.pendingReturns[currentUser.id] ?? []), operation] },
        }), false)
        pushToast('error', `退回提交失败，已保留在本地待重试：${operation.lastError}`)
      } else {
        pushToast('error', `确认失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
  }
  const updateStatus = (segmentId: string, status: 'confirmed' | 'returned') => {
    void submitReview(status === 'confirmed' ? 'confirm' : 'return', [segmentId], status === 'returned' ? returnReason : undefined)
  }
  const bulkReturn = () => {
    const ids = Array.from(selectedForReturn)
    void submitReview('bulk-return', ids, returnReason)
  }
  const retryPendingReturn = async (operation: PendingReturnOperation) => {
    try {
      const body = await reviewMutation.mutateAsync({ action: 'bulk-return', segmentIds: operation.segmentIds, reason: operation.reason })
      if (body.segments) setServerSegments(body.segments)
      patchLocalState((current) => ({
        ...current,
        pendingReturns: {
          ...current.pendingReturns,
          [currentUser.id]: (current.pendingReturns[currentUser.id] ?? []).filter((item) => item.id !== operation.id),
        },
      }), false)
      operation.segmentIds.forEach((id) => pushHistoryEntry(id, 'return', '', `退回原因：${operation.reason}`, operation.reviewAuthor))
      pushToast('success', '重试成功，退回原因已发送给认领人。')
      void queryClient.invalidateQueries({ queryKey: ['return-notices'] })
      void queryClient.invalidateQueries({ queryKey: ['localization-document'] })
    } catch (error) {
      patchLocalState((current) => ({
        ...current,
        pendingReturns: {
          ...current.pendingReturns,
          [currentUser.id]: (current.pendingReturns[currentUser.id] ?? []).map((item) => item.id === operation.id
            ? { ...item, attempts: item.attempts + 1, lastError: error instanceof Error ? error.message : '未知错误' }
            : item),
        },
      }), false)
      pushToast('error', `重试仍失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
  const cancelPendingReturn = (operationId: string) => {
    patchLocalState((current) => ({
      ...current,
      pendingReturns: {
        ...current.pendingReturns,
        [currentUser.id]: (current.pendingReturns[currentUser.id] ?? []).filter((item) => item.id !== operationId),
      },
    }), false)
    pushToast('info', '已取消这条待重试的退回。')
  }

  // ---------- 退回通知（仅认领人可见） ----------
  const dismissNotice = (notice: ReturnNotice) => {
    setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, dismissed: true } : item))
    patchLocalState((current) => ({
      ...current,
      dismissedNotices: { ...current.dismissedNotices, [currentUser.id]: [...(current.dismissedNotices[currentUser.id] ?? []), notice.id] },
    }), false)
    void fetch(`/api/notices/${notice.id}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id }),
    }).catch(() => { /* 本地已忽略，服务端标记失败可忽略 */ })
  }
  // 采用服务端退回时的译文快照：写入本地未提交编辑，原本没提交的改动仍可通过撤销找回
  const adoptServerText = (notice: ReturnNotice) => {
    pushUndo()
    patchLocalState((current) => ({
      ...current,
      edits: { ...current.edits, [currentUser.id]: { ...(current.edits[currentUser.id] ?? {}), [notice.segmentId]: notice.serverText } },
    }))
    const segment = serverSegments.find((item) => item.id === notice.segmentId)
    pushHistoryEntry(notice.segmentId, 'edit', segment?.targetText ?? '', notice.serverText, currentUser.name)
    dismissNotice(notice)
    setSelectedSegmentId(notice.segmentId)
    pushToast('info', '已把退回时的服务端译文放入编辑区，修改后重新提交即可。')
  }

  // ---------- 讨论：任何身份都可以留 ----------
  const addDiscussion = () => {
    if (!selectedSegment || !discussionDraft.trim()) return
    const nextDiscussion: Discussion = { id: `discussion-${Date.now()}`, segmentId: selectedSegment.id, author: currentUser.name, body: discussionDraft.trim(), resolved: false, createdAt: Date.now() }
    pushUndo()
    setDiscussions((current) => [nextDiscussion, ...current])
    pushHistoryEntry(selectedSegment.id, 'discussion', '', nextDiscussion.body)
    setDiscussionDraft('')
  }

  // ---------- 冲突：只有认领人能处理自己片段 ----------
  const resolveConflict = (conflict: TranslationConflict, strategy: 'local' | 'remote') => {
    const segment = segments.find((item) => item.id === conflict.segmentId)
    if (!segment) return
    if (isReviewer || segment.claimerId !== currentUser.id) {
      pushToast('error', `只有认领人 ${claimerName(segment.claimerId)} 能处理该片段的冲突。`)
      return
    }
    const targetText = strategy === 'local' ? conflict.localText : conflict.remoteText
    pushUndo()
    patchLocalState((current) => ({
      ...current,
      edits: { ...current.edits, [currentUser.id]: { ...(current.edits[currentUser.id] ?? {}), [conflict.segmentId]: targetText } },
    }))
    pushHistoryEntry(segment.id, 'resolve-conflict', segment.targetText, targetText, strategy === 'local' ? '保留本地' : conflict.remoteAuthor)
    setConflicts((current) => current.filter((item) => item.id !== conflict.id))
  }

  // ---------- 导入 ----------
  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = parseMarkdown(text)
    if (!imported.length) return
    const response = await fetch('/api/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: imported }),
    }).catch(() => null)
    if (response?.ok) {
      const body = await response.json() as { segments: Segment[] }
      setServerSegments(body.segments)
    } else {
      setServerSegments(imported)
    }
    setDiscussions([])
    setConflicts([])
    patchLocalState((current) => ({ ...current, edits: { ...current.edits, [currentUser.id]: {} } }))
    pushHistoryEntry(imported[0].id, 'import', '', file.name)
    setSelectedSegmentId(imported[0].id)
    event.target.value = ''
    pushToast('success', '文档已导入，所有片段为未认领状态，认领后才能翻译。')
  }
  const exportMarkdown = () => {
    const blob = new Blob([renderTargetMarkdown(segments)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = documentQuery.data.sourceFile.replace(/\.md$/, '.zh-CN.md')
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const toggleReturnSelection = (segmentId: string) => setSelectedForReturn((current) => {
    const next = new Set(current)
    next.has(segmentId) ? next.delete(segmentId) : next.add(segmentId)
    return next
  })

  // ---------- 故障开关（演示服务端退回失败 → 本地待重试） ----------
  const toggleFault = async () => {
    const next = !reviewFault
    const response = await fetch('/api/debug/review-fault', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (response?.ok) {
      setReviewFault(next)
      pushToast(next ? 'info' : 'success', next ? '已模拟审校服务故障，退回会失败并进入待重试队列。' : '审校服务已恢复，可以重试。')
    }
  }

  const selectAndScroll = (segmentId: string) => {
    setSelectedSegmentId(segmentId)
    requestAnimationFrame(() => document.getElementById(`segment-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const nextIssue = (direction: 1 | -1 = 1) => {
    const ids = Array.from(new Set(issues.map((issue) => issue.segmentId)))
    if (!ids.length) return
    const index = Math.max(0, ids.indexOf(selectedSegmentId))
    const nextIndex = direction > 0 ? (index + 1) % ids.length : (index - 1 + ids.length) % ids.length
    selectAndScroll(ids[nextIndex])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo(); return
      }
      if (editing) return
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); nextIssue(1) }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); nextIssue(-1) }
      // C / R 是审校动作：客户端同样先挡越权
      if (event.key.toLowerCase() === 'c' && selectedSegment && mode === 'review') updateStatus(selectedSegment.id, 'confirmed')
      if (event.key.toLowerCase() === 'r' && selectedSegment && mode === 'review') updateStatus(selectedSegment.id, 'returned')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const reviewerPendingBanner = isReviewer && myPendingReturns.length > 0

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8f1ff_0,transparent_32%)] pb-24">
      {/* 轻提示 */}
      <div className="pointer-events-none fixed left-1/2 top-3 z-[70] flex w-full max-w-xl -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div key={toast.id} className={cn('pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs shadow-lg', toast.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : toast.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800')}>
            {toast.tone === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : toast.tone === 'success' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <Bell className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="leading-5">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 text-white shadow-xl backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/15 text-blue-300"><Languages className="h-5 w-5" /></div>
            <div className="min-w-0"><h1 className="truncate font-semibold tracking-tight">开源文档本地化工作台</h1><p className="truncate text-[11px] text-slate-400">{documentQuery.data.sourceFile} · {documentQuery.data.title}</p></div>
          </div>
          <Badge className={cn(mockConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300', 'hidden border-0 lg:inline-flex')}>{mockConnected ? <Cloud className="mr-1 h-3 w-3" /> : <CloudOff className="mr-1 h-3 w-3" />}{mockConnected ? 'MSW 已连接' : '连接模拟接口'}</Badge>

          {/* 身份切换：演示认领边界与定向通知 */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 py-1 pl-2 pr-1">
              {isReviewer ? <ShieldCheck className="h-3.5 w-3.5 text-violet-300" /> : <UserCheck className="h-3.5 w-3.5 text-blue-300" />}
              <select
                aria-label="切换当前身份"
                value={currentUser.id}
                onChange={(event) => switchUser(seedUsers.find((user) => user.id === event.target.value) ?? seedUsers[0])}
                className="max-w-[150px] bg-transparent text-xs text-slate-200 outline-none [&>option]:text-slate-900"
              >
                {seedUsers.map((user) => <option key={user.id} value={user.id}>{user.name}（{user.role === 'reviewer' ? '审校' : '译者'}）</option>)}
              </select>
            </div>

            {/* 退回通知收件箱：只有本人能看到发给自己的原因 */}
            <div className="relative">
              <Button variant="outline" size="sm" className={cn('relative border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white', activeNotices.length && 'border-red-500/60')} onClick={() => setInboxOpen((open) => !open)}>
                <Bell className="h-4 w-4" />退回通知
                {activeNotices.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{activeNotices.length}</span>}
              </Button>
              {inboxOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setInboxOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-[380px] max-w-[88vw] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
                    <div className="border-b bg-slate-50 px-3.5 py-2.5"><b className="text-xs">退回原因 · 仅 {currentUser.name} 可见</b><p className="mt-0.5 text-[10px] text-slate-500">服务端只把原因发给片段认领人；本地未提交的改动不会被覆盖。</p></div>
                    <div className="max-h-[420px] overflow-auto p-2.5">
                      {!activeNotices.length && <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-400"><Bell className="mx-auto mb-2 h-5 w-5" />没有发给你的退回通知</div>}
                      {activeNotices.map((notice) => {
                        const segment = serverSegments.find((item) => item.id === notice.segmentId)
                        const hasLocalDraft = Object.prototype.hasOwnProperty.call(myEdits, notice.segmentId) && myEdits[notice.segmentId] !== notice.serverText
                        return (
                          <div key={notice.id} className="mb-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <b className="text-xs text-red-800">片段 #{segment?.index ?? '—'} 被退回</b>
                              <span className="text-[10px] text-slate-400">{new Date(notice.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="mt-1.5 text-[11px] leading-5 text-slate-700">{notice.reason}</p>
                            <p className="mt-1 text-[10px] text-slate-400">{notice.reviewAuthor} · 审校退回</p>
                            {hasLocalDraft && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-700">你本地还有未提交的改动，两边都保留着：采用服务端快照会覆盖编辑区，可随时撤销找回。</p>}
                            <div className="mt-2.5 flex gap-2">
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => adoptServerText(notice)}>采用服务端快照</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-slate-500" onClick={() => { dismissNotice(notice); selectAndScroll(notice.segmentId) }}>保留我的草稿，去修改</Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <Button variant="outline" size="sm" className={cn('hidden border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white xl:inline-flex', reviewFault && 'border-amber-500/60 text-amber-300')} onClick={() => void toggleFault()} title="模拟审校服务故障，用于演示退回失败后的本地重试">
              <Zap className="h-4 w-4" />{reviewFault ? '停止故障模拟' : '模拟审校故障'}
            </Button>
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'translate' | 'review')}><TabsList className="bg-slate-800"><TabsTrigger value="translate" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">翻译</TabsTrigger><TabsTrigger value="review" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">审校</TabsTrigger></TabsList></Tabs>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={undo} disabled={!past.length}><Undo2 className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={redo} disabled={!future.length}><RotateCw className="h-4 w-4" /></Button>
            <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" className="hidden" onChange={(event) => void importMarkdown(event)} />
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => fileInput.current?.click()}><Import className="h-4 w-4" /></Button>
            <Button size="sm" onClick={saveDraft} disabled={saveMutation.isPending}><Save className="h-4 w-4" />提交译文{dirtySegmentIds.size ? ` (${dirtySegmentIds.size})` : ''}</Button>
          </div>
        </div>
      </header>

      {/* 审校：服务端退回失败后的待重试队列 */}
      {reviewerPendingBanner && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 lg:px-6">
          <div className="mx-auto max-w-[1800px] space-y-2">
            {myPendingReturns.map((operation) => (
              <div key={operation.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs shadow-sm">
                <RefreshCw className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-amber-800">退回未送达 · 待重试</span>
                <span className="text-slate-600">片段 {operation.segmentIds.map((id) => `#${serverSegments.find((segment) => segment.id === id)?.index ?? id}`).join('、')}</span>
                <span className="max-w-md truncate text-slate-500" title={operation.reason}>原因：{operation.reason}</span>
                <Badge variant="warning">已尝试 {operation.attempts} 次</Badge>
                <span className="text-red-600">最近失败：{operation.lastError}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={reviewMutation.isPending || reviewFault} onClick={() => void retryPendingReturn(operation)}><RotateCcw className="h-3.5 w-3.5" />重试</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] text-slate-500" onClick={() => cancelPendingReturn(operation.id)}>取消</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-b bg-white/85 px-4 py-2.5 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span><b className="text-slate-900">{segments.length}</b> 个内容块</span>
          <span><b className="text-slate-900">{translatedCount}</b> 已翻译</span>
          <span className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5 text-amber-600" /><b className="text-slate-900">{issues.length}</b> 个检查结果</span>
          <span className="flex items-center gap-1"><CheckCheck className="h-3.5 w-3.5 text-emerald-600" /><b className="text-slate-900">{confirmedCount}</b> 已确认</span>
          <span className="flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 text-blue-600" /><b className="text-slate-900">{segments.filter((segment) => segment.claimerId).length}</b> 已认领</span>
          <div className="ml-auto flex min-w-[220px] items-center gap-3"><span>审校进度 {progress}%</span><Progress value={progress} className="w-36" /></div>
          <Button size="sm" variant="secondary" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}>{checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}运行本地术语检查</Button>
          <Button size="sm" variant="outline" onClick={exportMarkdown}><Download className="h-4 w-4" />导出译文</Button>
        </div>
      </div>

      <main className="workbench-grid mx-auto grid max-w-[1800px] grid-cols-[270px_minmax(620px,1fr)_340px] gap-4 p-4 lg:p-5">
        <aside className="workbench-left space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="h-4 w-4 text-blue-600" />本地术语表 <Badge variant="secondary">{glossary.length}</Badge></CardTitle><div className="relative mt-2"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={glossarySearch} onChange={(event) => setGlossarySearch(event.target.value)} placeholder="搜索术语" className="h-9 pl-8 text-xs" /></div></CardHeader>
            <CardContent className="space-y-2">
              {filteredGlossary.map((term) => <div key={term.id} className="rounded-lg border bg-slate-50/70 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-800">{term.source}</span><ChevronRight className="h-3.5 w-3.5 text-slate-400" /><span className="text-xs font-semibold text-blue-700">{term.target}</span></div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{term.note}</p></div>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-amber-600" />问题导航 <Badge variant={issues.length ? 'warning' : 'success'}>{issues.length}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {issues.slice(0, 14).map((issue) => {
                const segment = segments.find((item) => item.id === issue.segmentId)
                return <button key={issue.id} className={cn('w-full rounded-lg border p-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50', selectedSegmentId === issue.segmentId && 'border-blue-300 bg-blue-50')} onClick={() => selectAndScroll(issue.segmentId)}><div className="flex items-center justify-between gap-2"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{segment?.index}</span></div><p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{issue.message}</p></button>
              })}
              {!issues.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有检查已通过</div>}
            </CardContent>
          </Card>

          {isReviewer && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><GitCompare className="h-4 w-4 text-violet-600" />批量退回 {myPendingReturns.length > 0 && <Badge variant="warning">{myPendingReturns.length} 待重试</Badge>}</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-3 text-[11px] leading-relaxed text-slate-500">勾选已认领的片段，退回原因只发送给对应认领人；提交失败会留在本地等重试。</p>
                <Textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} className="text-xs" />
                <Button className="mt-3 w-full" variant="destructive" disabled={!selectedForReturn.size || reviewMutation.isPending} onClick={bulkReturn}>{reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UndoDot className="h-4 w-4" />}批量退回 {selectedForReturn.size || ''}</Button>
                {reviewFault && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-700">当前审校服务处于故障模拟状态，退回会被收入待重试队列。</p>}
              </CardContent>
            </Card>
          )}
        </aside>

        <section className="workbench-center min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2.5 shadow-sm">
            <div className="flex items-center rounded-lg bg-slate-100 p-1">
              {([['all', '全部'], ['issues', '问题'], ['untranslated', '漏译'], ['confirmed', '已确认']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{label}</button>)}
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500"><span>{filteredSegments.length} / {segments.length}</span><Button variant="outline" size="sm" onClick={() => nextIssue(-1)}><ArrowUp className="h-3.5 w-3.5" />上一问题</Button><Button variant="outline" size="sm" onClick={() => nextIssue(1)}>下一问题<ArrowDown className="h-3.5 w-3.5" /></Button></div></div>

          {filteredSegments.map((segment) => {
            const segmentIssues = issueMap[segment.id] ?? []
            const isSelected = selectedSegment?.id === segment.id
            const isReturnSelected = selectedForReturn.has(segment.id)
            const claimer = claimerName(segment.claimerId)
            const mine = segment.claimerId === currentUser.id
            const editable = canEditSegment(segment)
            const isDirty = dirtySegmentIds.has(segment.id)
            const notice = noticeBySegment[segment.id]
            const pendingForSegment = isReviewer ? myPendingReturns.filter((operation) => operation.segmentIds.includes(segment.id)) : []
            return (
              <article id={`segment-${segment.id}`} key={segment.id} onClick={() => setSelectedSegmentId(segment.id)} className={cn('scroll-mt-32 overflow-hidden rounded-xl border bg-white shadow-sm transition', isSelected && 'ring-2 ring-blue-500/30', segment.status === 'returned' && 'border-red-200', segmentIssues.some((issue) => issue.severity === 'error') && 'border-red-200')}>
                <header className="flex flex-wrap items-center gap-2 border-b bg-slate-50/80 px-3 py-2.5">
                  {isReviewer && <input type="checkbox" checked={isReturnSelected} onChange={() => toggleReturnSelection(segment.id)} className="h-4 w-4 rounded border-slate-300 accent-blue-600" aria-label={`选择片段 ${segment.index}`} />}
                  <span className="text-[11px] font-semibold text-slate-500">#{String(segment.index).padStart(2, '0')}</span>
                  <Badge variant="outline" className="gap-1 text-[10px]">{kindIcon[segment.kind]}{kindLabel[segment.kind]}</Badge>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusClass[segment.status])}>{statusLabel[segment.status]}</span>
                  {/* 认领边界 */}
                  {claimer ? (
                    <Badge className={cn('gap-1 border-0 text-[10px]', mine ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600')} title="只有认领人能修改译文">
                      <Lock className="h-3 w-3" />{mine ? `我已认领（${currentUser.name.replace(/^[^·]+·\s*/, '')}）` : `认领人：${claimer.replace(/^[^·]+·\s*/, '')}`}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-dashed text-[10px] text-slate-500"><UserPlus className="h-3 w-3" />未认领</Badge>
                  )}
                  {isDirty && <Badge variant="warning" className="text-[10px]">未提交</Badge>}
                  {segment.protectedTokens.length > 0 && <Badge variant="secondary" className="gap-1 text-[10px]"><Variable className="h-3 w-3" />{segment.protectedTokens.length} 个受保护标记</Badge>}
                  {!!segmentIssues.length && <Badge variant="destructive" className="ml-auto">{segmentIssues.length} 个问题</Badge>}
                  <div className={cn('flex gap-1.5', !segmentIssues.length && 'ml-auto')}>
                    {!isReviewer && !mine && (
                      <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" disabled={claimMutation.isPending || segment.claimerId !== null} onClick={(event) => { event.stopPropagation(); claimMutation.mutate(segment.id) }}>
                        <UserPlus className="h-3.5 w-3.5" />{segment.claimerId ? '已被认领' : '认领'}
                      </Button>
                    )}
                    {!isReviewer && mine && (
                      <Button size="sm" variant="ghost" className="text-slate-500" disabled={releaseMutation.isPending} onClick={(event) => { event.stopPropagation(); releaseMutation.mutate(segment.id) }}>
                        <UserCheck className="h-3.5 w-3.5" />取消认领
                      </Button>
                    )}
                    {isReviewer && <><Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={(event) => { event.stopPropagation(); updateStatus(segment.id, 'confirmed') }}><Check className="h-3.5 w-3.5" />确认</Button><Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" disabled={!segment.claimerId} onClick={(event) => { event.stopPropagation(); updateStatus(segment.id, 'returned') }}><X className="h-3.5 w-3.5" />退回</Button></>}
                  </div>
                </header>
                <div className="compare-grid grid grid-cols-2 divide-x">
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">English · Source</span><Badge variant="outline" className="text-[9px]">只读</Badge></div>
                    <div className={cn('document-prose text-sm leading-6 text-slate-700', segment.kind === 'code' && 'markdown-code rounded-lg bg-slate-950 p-3 text-xs text-slate-100')}>{segment.sourceText}</div>
                    {segment.note && <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">译者备注：{segment.note}</p>}
                  </div>
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">简体中文 · Target</span>
                      {editable
                        ? <Badge variant="outline" className="gap-1 text-[9px] text-blue-700"><UserCheck className="h-3 w-3" />{isDirty ? '编辑中 · 未提交' : '认领人可编辑'}</Badge>
                        : <Badge variant="secondary" className="gap-1 text-[9px]"><Lock className="h-3 w-3" />{isReviewer ? '审校只读' : claimer ? '仅讨论' : '认领后可编辑'}</Badge>}
                    </div>
                    <Textarea
                      id={`target-${segment.id}`}
                      value={segment.targetText}
                      readOnly={!editable}
                      aria-readonly={!editable}
                      onChange={(event) => updateTarget(segment, event.target.value)}
                      rows={Math.max(3, Math.ceil(segment.sourceText.length / 46))}
                      className={cn('min-h-[84px] resize-y border-slate-200 bg-slate-50/40 text-sm leading-6 focus-visible:bg-white', !editable && 'cursor-not-allowed bg-slate-100/70 text-slate-500', segment.kind === 'code' && 'markdown-code text-xs')}
                      placeholder={isReviewer ? '审校模式下译文只读…' : claimer ? '这段译文由认领人负责，你可以在右侧讨论区留言…' : '认领该片段后才能输入译文…'}
                    />
                    {segment.protectedTokens.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{segment.protectedTokens.map((token) => <code key={token} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{token}</code>)}</div>}
                  </div>
                </div>

                {/* 认领人专属：退回原因 + 服务端快照，本地草稿不受影响 */}
                {notice && (
                  <div className="border-t border-red-200 bg-red-50/70 px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="destructive" className="gap-1"><UndoDot className="h-3 w-3" />收到退回（仅你可见）</Badge>
                      <span className="text-[10px] text-slate-400">{notice.reviewAuthor} · {new Date(notice.createdAt).toLocaleString('zh-CN')}</span>
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => adoptServerText(notice)}>采用服务端快照</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-slate-500" onClick={() => dismissNotice(notice)}>保留草稿并忽略</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-red-800">退回原因：{notice.reason}</p>
                    {isDirty && <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-700">检测到本地未提交改动，当前编辑区保留的是你的草稿；服务端退回时的译文仍可一键采用，不会丢失任何一边。</p>}
                  </div>
                )}
                {pendingForSegment.length > 0 && (
                  <div className="border-t border-amber-200 bg-amber-50/70 px-3.5 py-2 text-[11px] text-amber-800">
                    该片段有 {pendingForSegment.length} 条退回未送达，已留在本地待重试。
                    <Button size="sm" variant="outline" className="ml-2 h-6 text-[10px]" disabled={reviewFault} onClick={(event) => { event.stopPropagation(); void retryPendingReturn(pendingForSegment[0]) }}>立即重试</Button>
                  </div>
                )}
                {!!segmentIssues.length && <div className="border-t bg-red-50/50 px-3.5 py-2.5"><div className="space-y-1.5">{segmentIssues.map((issue) => <div key={issue.id} className="flex items-start gap-2 text-[11px]"><CircleAlert className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', issue.severity === 'error' ? 'text-red-600' : 'text-amber-600')} /><span className={issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>{issue.message}</span></div>)}</div></div>}
                <footer className="flex items-center gap-2 border-t bg-white px-3 py-2 text-[10px] text-slate-400"><span>{editable ? '你是认领人，改动仅你可写' : claimer ? '译文由认领人维护，你可以留言讨论' : '未认领片段'}</span><span>·</span><span>讨论对所有人开放</span><button className="ml-auto flex items-center gap-1 text-blue-600 hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedSegmentId(segment.id); document.getElementById('discussion-tab')?.click() }}><MessageSquare className="h-3 w-3" />讨论 {discussions.filter((item) => item.segmentId === segment.id && !item.resolved).length}</button></footer>
              </article>
            )
          })}
          {!filteredSegments.length && <Card><CardContent className="grid min-h-52 place-items-center text-center"><div><Sparkles className="mx-auto mb-2 h-7 w-7 text-blue-500" /><p className="mt-3 text-sm font-medium">当前筛选下没有片段</p><p className="mt-1 text-xs text-slate-500">切换筛选条件或运行检查。</p></div></CardContent></Card>}
        </section>

        <aside className="workbench-right min-w-0">
          <Card className="sticky top-[74px] max-h-[calc(100vh-96px)] overflow-hidden">
            <Tabs defaultValue="discussion" className="flex h-full flex-col">
              <TabsList className="mx-3 mt-3 grid grid-cols-4"><TabsTrigger id="discussion-tab" value="discussion" className="px-1 text-[11px]">讨论</TabsTrigger><TabsTrigger value="issues" className="px-1 text-[11px]">问题</TabsTrigger><TabsTrigger value="history" className="px-1 text-[11px]">历史</TabsTrigger><TabsTrigger value="conflicts" className="px-1 text-[11px]">冲突 {conflicts.length ? `(${conflicts.length})` : ''}</TabsTrigger></TabsList>
              <TabsContent value="discussion" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3">
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-2.5"><p className="text-[10px] font-semibold text-blue-800">当前片段 #{selectedSegment?.index} · 讨论不改动译文，所有人可发言</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-blue-700">{selectedSegment?.targetText || selectedSegment?.sourceText}</p></div>
                <div className="mt-3 flex gap-2"><Textarea value={discussionDraft} onChange={(event) => setDiscussionDraft(event.target.value)} rows={2} placeholder="针对当前句子留下讨论…" className="text-xs" /><Button size="icon" className="h-auto self-stretch" onClick={addDiscussion}><Send className="h-4 w-4" /></Button></div>
                <div className="mt-4 space-y-3">{selectedDiscussions.map((discussion) => <div key={discussion.id} className="rounded-lg border p-3"><div className="flex items-center justify-between"><b className="text-xs text-slate-800">{discussion.author}</b><Badge variant={discussion.resolved ? 'success' : 'warning'}>{discussion.resolved ? '已解决' : '待回应'}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-600">{discussion.body}</p><p className="mt-2 text-[10px] text-slate-400">{hydrated ? new Date(discussion.createdAt).toLocaleString('zh-CN') : null}</p></div>)}{!selectedDiscussions.length && <p className="py-8 text-center text-xs text-slate-400">当前片段还没有讨论</p>}</div>
              </TabsContent>
              <TabsContent value="issues" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-2">{issues.map((issue) => <button key={issue.id} onClick={() => selectAndScroll(issue.segmentId)} className="w-full rounded-lg border p-3 text-left hover:border-amber-300 hover:bg-amber-50"><div className="flex items-center justify-between"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{segments.find((item) => item.id === issue.segmentId)?.index}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{issue.message}</p></button>)}{!issues.length && <p className="py-8 text-center text-xs text-emerald-600">没有待处理问题</p>}</div></TabsContent>
              <TabsContent value="history" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-0">{history.map((entry) => <div key={entry.id} className="relative border-l border-slate-200 pb-4 pl-4"><span className="absolute -left-1.5 top-0 h-3 w-3 rounded-full border-2 border-white bg-blue-500" /><div className="flex items-center justify-between"><b className="text-[11px] text-slate-700">{entry.author}</b><span className="text-[9px] text-slate-400">{hydrated ? new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null}</span></div><p className="mt-1 text-[10px] text-slate-500">片段 #{segments.find((item) => item.id === entry.segmentId)?.index ?? '—'} · {actionLabel[entry.action]}</p>{entry.after && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{entry.after}</p>}</div>)}</div></TabsContent>
              <TabsContent value="conflicts" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-3">{conflicts.map((conflict) => {
                const conflictSegment = segments.find((item) => item.id === conflict.segmentId)
                const canResolve = !isReviewer && conflictSegment?.claimerId === currentUser.id
                return (
                  <div key={conflict.id} className={cn('overflow-hidden rounded-lg border', canResolve ? 'border-red-200' : 'border-slate-200 bg-slate-50/60')}>
                    <div className={cn('px-3 py-2', canResolve ? 'bg-red-50' : 'bg-slate-100')}><b className={cn('text-xs', canResolve ? 'text-red-800' : 'text-slate-600')}>片段 #{segments.find((item) => item.id === conflict.segmentId)?.index} 存在并发修改</b><p className="mt-1 text-[10px] text-slate-500">{conflict.remoteAuthor} 修改了同一句{canResolve ? '' : ` · 仅认领人 ${claimerName(conflictSegment?.claimerId ?? null)} 可处理`}</p></div>
                    <div className="space-y-2 p-3"><div><span className="text-[9px] font-semibold text-slate-400">本地版本</span><p className="mt-1 text-[11px] leading-5 text-slate-600">{conflict.localText}</p></div><div><span className="text-[9px] font-semibold text-slate-400">远端版本</span><p className="mt-1 text-[11px] leading-5 text-blue-700">{conflict.remoteText}</p></div>{canResolve && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => resolveConflict(conflict, 'local')}>保留本地</Button><Button size="sm" onClick={() => resolveConflict(conflict, 'remote')}>采用远端</Button></div>}{!canResolve && <div className="flex items-center gap-1.5 text-[10px] text-slate-400"><Lock className="h-3 w-3" />你不是该片段的认领人，只能查看。</div>}</div>
                  </div>
                )
              })}{!conflicts.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有冲突已解决</div>}</div></TabsContent>
            </Tabs>
          </Card>
          <div className="mt-3 rounded-xl border bg-slate-950 px-3 py-3 text-[10px] text-slate-400"><p className="mb-2 font-semibold text-slate-200">键盘操作</p><div className="grid grid-cols-2 gap-2"><span><kbd>J</kbd> 下一问题</span><span><kbd>K</kbd> 上一问题</span><span><kbd>C</kbd> 确认（审校）</span><span><kbd>R</kbd> 退回（审校）</span><span><kbd>⌘ Z</kbd> 撤销</span><span><kbd>⌘ ⇧ Z</kbd> 重做</span></div></div>
        </aside>
      </main>

      {isReviewer && selectedForReturn.size > 0 && <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-slate-950 px-4 py-3 text-white shadow-2xl"><div className="mx-auto flex max-w-[1800px] items-center gap-3"><ShieldCheck className="h-4 w-4 text-amber-300" /><span className="text-xs">已选择 <b>{selectedForReturn.size}</b> 个片段（退回原因仅发送给认领人）</span><Input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} className="ml-auto max-w-lg border-slate-700 bg-slate-900 text-white" /><Button variant="destructive" size="sm" disabled={reviewMutation.isPending} onClick={bulkReturn}>确认批量退回</Button><Button variant="ghost" size="sm" className="text-slate-300" onClick={() => setSelectedForReturn(new Set())}>取消</Button></div></div>}
    </div>
  )
}
