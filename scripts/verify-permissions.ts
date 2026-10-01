// 端到端校验：片段认领权限、定向退回通知、本地草稿不被覆盖、越权 403、故障后待重试
import Module from 'node:module'
import path from 'node:path'

const originalResolve = (Module as unknown as { _resolveFilename: (request: string, parent: unknown, ...rest: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (request: string, parent: unknown, ...rest: unknown[]) => string })._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request.startsWith('@/')) request = path.join(process.cwd(), 'src', request.slice(2))
  return originalResolve.call(this, request, ...args)
}

const store = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  length: 0,
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = localStorageStub

import { serverStore } from '../src/mocks/server-state'

let pass = 0
let fail = 0
const check = (name: string, condition: boolean) => {
  if (condition) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}
const find = (id: string) => serverStore.getSegments().find((s) => s.id === id)!

console.log('\n— 初始认领状态 —')
check('seg-09 由 u-liran 认领', find('seg-09').claimerId === 'u-liran')
check('seg-04 由 u-chen 认领', find('seg-04').claimerId === 'u-chen')
check('seg-10 未认领', find('seg-10').claimerId === null)

console.log('\n— 认领边界 —')
check('译者可认领未认领片段', serverStore.claim('seg-10', 'u-chen').ok)
check('认领后 claimerId 生效', find('seg-10').claimerId === 'u-chen')
const conflictClaim = serverStore.claim('seg-10', 'u-liran')
check('他人重复认领被 409 拒绝', !conflictClaim.ok && conflictClaim.status === 409)
check('本人重复认领幂等成功', serverStore.claim('seg-10', 'u-chen').ok)
check('不能取消别人的认领 (403)', !serverStore.release('seg-10', 'u-liran').ok)
check('本人可取消认领', serverStore.release('seg-10', 'u-chen').ok)
check('取消后回到未认领', find('seg-10').claimerId === null)

console.log('\n— 退回原因只发给认领人 —')
const beforeReturn = find('seg-04').targetText
const review = serverStore.review({ action: 'bulk-return', segmentIds: ['seg-04'], reason: '链接译法请统一', reviewUserId: 'u-maya', reviewUserRole: 'reviewer', reviewAuthor: '审校 · Maya' })
check('审校退回成功', review.ok)
check('片段状态变为 returned', find('seg-04').status === 'returned')
check('服务端不改动译文正文（本地草稿不会被盖）', find('seg-04').targetText === beforeReturn)
const chenNotices = serverStore.getNoticesFor('u-chen')
check('认领人 u-chen 能收到退回原因', chenNotices.some((n) => n.segmentId === 'seg-04' && n.reason === '链接译法请统一'))
check('通知携带退回时的服务端快照', chenNotices.some((n) => n.segmentId === 'seg-04' && n.serverText === beforeReturn))
check('u-liran 看不到发给 u-chen 的原因', !serverStore.getNoticesFor('u-liran').some((n) => n.segmentId === 'seg-04'))
check('审校本人也拉取不到发给译者的原因', !serverStore.getNoticesFor('u-maya').some((n) => n.segmentId === 'seg-04'))

console.log('\n— 未认领片段不能退回（原因要有接收人）—')
const returnUnclaimed = serverStore.review({ action: 'return', segmentIds: ['seg-10'], reason: 'x', reviewUserId: 'u-maya', reviewUserRole: 'reviewer', reviewAuthor: '审校 · Maya' })
check('退回未认领片段被 409 拒绝', !returnUnclaimed.ok && returnUnclaimed.status === 409)
check('409 响应带出 unclaimed 列表', (returnUnclaimed.unclaimed ?? []).includes('seg-10'))

console.log('\n— 越权提交双层防护（服务端兜底）—')
check('译者不能执行审校动作 (403)', !serverStore.review({ action: 'confirm', segmentIds: ['seg-02'], reviewUserId: 'u-liran', reviewUserRole: 'translator', reviewAuthor: '译者 · 李然' }).ok)
check('审校不能提交译文 (403)', !serverStore.saveDraft({ userId: 'u-maya', userRole: 'reviewer', segments: [{ ...find('seg-02'), targetText: '恶意改动' }] }).ok)
const foreign = serverStore.saveDraft({ userId: 'u-liran', userRole: 'translator', segments: [{ ...find('seg-04'), targetText: 'u-liran 改了 u-chen 的片段' }] })
check('提交非本人认领片段被 403', !foreign.ok && foreign.status === 403)
check('403 响应带出违规片段', (foreign.violations ?? []).includes('seg-04'))
check('被拒后服务端译文保持原样', find('seg-04').targetText === beforeReturn)
const ownSave = serverStore.saveDraft({ userId: 'u-chen', userRole: 'translator', segments: [{ ...find('seg-04'), targetText: '开始前请阅读官方配置参考。' }] })
check('认领人可以正常提交', ownSave.ok)
check('重新提交后 returned → draft', find('seg-04').status === 'draft')
check('服务端更新为认领人的译文', find('seg-04').targetText === '开始前请阅读官方配置参考。')

console.log('\n— 通知只能本人处理 —')
const noticeId = serverStore.getNoticesFor('u-chen').find((n) => n.segmentId === 'seg-04')!.id
check('别人不能忽略我的通知 (403)', !serverStore.dismissNotice(noticeId, 'u-liran').ok)
check('本人可以忽略通知', serverStore.dismissNotice(noticeId, 'u-chen').ok)

console.log('\n— 故障模拟：服务端 503 后客户端待重试，服务端不落任何状态 —')
// 复刻 handlers.ts 里的顺序：故障开关先于 review 处理
const reviewThroughApi = (params: Parameters<typeof serverStore.review>[0]) =>
  serverStore.isReviewFault() ? { ok: false, status: 503, message: '审校服务暂时不可用' } : serverStore.review(params)
serverStore.setReviewFault(true)
check('故障开关读取为 true', serverStore.isReviewFault())
const snapshotBefore = serverStore.getSegments().map((s) => `${s.id}:${s.status}:${s.targetText}`).join('|')
const noticesBefore = serverStore.getNoticesFor('u-liran').length
const faultReview = reviewThroughApi({ action: 'bulk-return', segmentIds: ['seg-07'], reason: '占位符问题', reviewUserId: 'u-maya', reviewUserRole: 'reviewer', reviewAuthor: '审校 · Maya' })
check('故障时审校返回 503', !faultReview.ok && faultReview.status === 503)
check('503 后片段状态完全不变', serverStore.getSegments().map((s) => `${s.id}:${s.status}:${s.targetText}`).join('|') === snapshotBefore)
check('503 不产生任何通知', serverStore.getNoticesFor('u-liran').length === noticesBefore)
serverStore.setReviewFault(false)
const retryReview = reviewThroughApi({ action: 'bulk-return', segmentIds: ['seg-02'], reason: '占位符问题', reviewUserId: 'u-maya', reviewUserRole: 'reviewer', reviewAuthor: '审校 · Maya' })
check('恢复后重试成功', retryReview.ok && find('seg-02').status === 'returned')
check('恢复后通知定向发给 u-liran', serverStore.getNoticesFor('u-liran').some((n) => n.segmentId === 'seg-02' && n.reason === '占位符问题'))

console.log('\n— 持久化：模拟刷新（重新从 localStorage 读取）—')
serverStore.reset()
check('reset 后认领关系回到种子（seg-09 仍有 u-liran 的种子通知）', serverStore.getNoticesFor('u-liran').some((n) => n.segmentId === 'seg-09'))
check('reset 后 seg-04 claimer 为 u-chen', serverStore.getSegments().find((s) => s.id === 'seg-04')!.claimerId === 'u-chen')
check('reset 后通知仍按人隔离：u-chen 没有 seg-09 的通知', !serverStore.getNoticesFor('u-chen').some((n) => n.segmentId === 'seg-09'))

console.log(`\n结果：${pass} 通过，${fail} 失败\n`)
process.exit(fail ? 1 : 0)
