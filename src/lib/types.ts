export type SegmentKind = 'heading' | 'paragraph' | 'code' | 'link' | 'variable'
export type SegmentStatus = 'draft' | 'needs-work' | 'confirmed' | 'returned'
export type IssueType = 'missing-translation' | 'missing-variable' | 'link-mismatch' | 'glossary' | 'code-format'
export type IssueSeverity = 'error' | 'warning'

export interface Segment {
  id: string
  index: number
  kind: SegmentKind
  sourceText: string
  targetText: string
  status: SegmentStatus
  protectedTokens: string[]
  note: string
  /** 认领人（译者身份）；只有认领人能改译文，null 表示未认领 */
  claimedBy: string | null
  claimedAt?: number
  /** 审校退回原因：服务端只下发给认领人本人，其他人不可见 */
  returnReason?: string
  returnedAt?: number
  /** 投递该退回结果的服务端消息 id，用于去重 */
  returnResultId?: string
  /** 退回请求在服务端失败后留在本地等待重试的标记 */
  returnPending?: boolean
}

export interface GlossaryTerm {
  id: string
  source: string
  target: string
  caseSensitive: boolean
  note: string
}

export interface Discussion {
  id: string
  segmentId: string
  author: string
  body: string
  resolved: boolean
  createdAt: number
}

export interface TranslationIssue {
  id: string
  segmentId: string
  type: IssueType
  severity: IssueSeverity
  message: string
  expected?: string
}

export interface HistoryEntry {
  id: string
  segmentId: string
  author: string
  action: 'edit' | 'confirm' | 'return' | 'resolve-conflict' | 'import' | 'discussion'
  before: string
  after: string
  createdAt: number
}

export interface TranslationConflict {
  id: string
  segmentId: string
  localText: string
  remoteText: string
  remoteAuthor: string
  createdAt: number
}

export interface LocalizationDocument {
  id: string
  title: string
  sourceFile: string
  sourceLanguage: string
  targetLanguage: string
  updatedAt: number
  segments: Segment[]
  glossary: GlossaryTerm[]
  discussions: Discussion[]
}

/** 审校服务端产生的退回/确认结果，退回原因只投递给认领人 */
export interface ReviewResult {
  id: string
  segmentId: string
  action: 'return' | 'confirm'
  reason?: string
  reviewer: string
  createdAt: number
}

/** 服务端退回失败后留在本地重试队列中的请求 */
export interface PendingReturn {
  tempId: string
  segmentIds: string[]
  reason: string
  action: 'return'
  createdAt: number
}
