export type SegmentKind = 'heading' | 'paragraph' | 'code' | 'link' | 'variable'
export type SegmentStatus = 'draft' | 'needs-work' | 'confirmed' | 'returned'
export type IssueType = 'missing-translation' | 'missing-variable' | 'link-mismatch' | 'glossary' | 'code-format'
export type IssueSeverity = 'error' | 'warning'
export type UserRole = 'translator' | 'reviewer'

export interface User {
  id: string
  name: string
  role: UserRole
}

export interface Segment {
  id: string
  index: number
  kind: SegmentKind
  sourceText: string
  targetText: string
  status: SegmentStatus
  protectedTokens: string[]
  note: string
  /** 认领该片段的译者 id；未认领时为 null，只有认领人能修改译文 */
  claimerId: string | null
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
  action: 'edit' | 'confirm' | 'return' | 'resolve-conflict' | 'import' | 'discussion' | 'claim' | 'release'
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

/** 审校退回时服务端定向发给认领人的通知，非认领人不可见 */
export interface ReturnNotice {
  id: string
  segmentId: string
  /** 只有该用户（片段认领人）能收到退回原因 */
  ownerId: string
  reason: string
  /** 服务端执行退回时记录的译文快照，仅供认领人参考，不覆盖本地草稿 */
  serverText: string
  reviewAuthor: string
  createdAt: number
  dismissed: boolean
}

/** 审校退回提交失败后留在本地、等待重试的记录 */
export interface PendingReturnOperation {
  id: string
  segmentIds: string[]
  reason: string
  reviewUserId: string
  reviewAuthor: string
  createdAt: number
  /** 最近一次提交失败的原因 */
  lastError: string
  attempts: number
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
