import type { Discussion, GlossaryTerm, HistoryEntry, LocalizationDocument, ReturnNotice, Segment, TranslationConflict, User } from './types'

export const seedUsers: User[] = [
  { id: 'u-liran', name: '译者 · 李然', role: 'translator' },
  { id: 'u-chen', name: '译者 · Chen', role: 'translator' },
  { id: 'u-maya', name: '审校 · Maya', role: 'reviewer' },
]

export const seedSegments: Segment[] = [
  { id: 'seg-01', index: 1, kind: 'heading', sourceText: '# Deployment Guide', targetText: '# 部署指南', status: 'confirmed', protectedTokens: [], note: '保留 Markdown 标题层级。', claimerId: null },
  { id: 'seg-02', index: 2, kind: 'paragraph', sourceText: 'This guide explains how to deploy {{project_name}} version {{version}} to a Kubernetes cluster.', targetText: '本指南介绍如何将 {{project_name}} {{version}} 版部署到 Kubernetes 集群。', status: 'draft', protectedTokens: ['{{project_name}}', '{{version}}'], note: '项目名和版本号保留占位符。', claimerId: 'u-liran' },
  { id: 'seg-03', index: 3, kind: 'heading', sourceText: '## Prerequisites', targetText: '## 前置条件', status: 'confirmed', protectedTokens: [], note: '', claimerId: null },
  { id: 'seg-04', index: 4, kind: 'link', sourceText: 'Before you begin, review the [configuration reference](https://docs.example.com/config) and install `kubectl`.', targetText: '开始前，请阅读 [配置参考](https://docs.example.com/config)，并安装 `kubectl`。', status: 'draft', protectedTokens: ['https://docs.example.com/config'], note: '', claimerId: 'u-chen' },
  { id: 'seg-05', index: 5, kind: 'paragraph', sourceText: 'The operator requires cluster-admin privileges during installation. Production environments should use a dedicated service account.', targetText: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', status: 'needs-work', protectedTokens: [], note: 'operator 的术语待 unified。', claimerId: 'u-liran' },
  { id: 'seg-06', index: 6, kind: 'code', sourceText: '```bash\nhelm upgrade --install {{release_name}} oci://registry.example.com/operator --version {{version}}\n```', targetText: '```bash\nhelm upgrade --install {{release_name}} oci://registry.example.com/operator --version {{version}}\n```', status: 'confirmed', protectedTokens: ['{{release_name}}', '{{version}}'], note: '命令保持原样。', claimerId: null },
  { id: 'seg-07', index: 7, kind: 'variable', sourceText: 'Set `replicaCount` to `{replica_count}` in your values file.', targetText: '在 values 文件中将 `replicaCount` 设置为 `{replica_count}`。', status: 'draft', protectedTokens: ['{replica_count}'], note: '', claimerId: 'u-liran' },
  { id: 'seg-08', index: 8, kind: 'paragraph', sourceText: 'If the controller cannot reach the API server, check the network policy and then restart the pod.', targetText: '如果控制器无法连接 API 服务器，请检查网络策略，然后重启 Pod。', status: 'draft', protectedTokens: [], note: '', claimerId: 'u-chen' },
  { id: 'seg-09', index: 9, kind: 'link', sourceText: 'See [Troubleshooting](https://docs.example.com/troubleshooting#connectivity) for detailed diagnostics.', targetText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', status: 'returned', protectedTokens: ['https://docs.example.com/troubleshooting#connectivity'], note: '锚点链接丢失，需要修复。', claimerId: 'u-liran' },
  { id: 'seg-10', index: 10, kind: 'heading', sourceText: '## Upgrade Notes', targetText: '', status: 'draft', protectedTokens: [], note: '漏译示例。', claimerId: null },
]

export const seedGlossary: GlossaryTerm[] = [
  { id: 'term-01', source: 'operator', target: 'Operator', caseSensitive: false, note: 'Kubernetes 扩展概念，保留首字母大写。' },
  { id: 'term-02', source: 'service account', target: '服务账号', caseSensitive: false, note: '统一使用“服务账号”。' },
  { id: 'term-03', source: 'network policy', target: '网络策略', caseSensitive: false, note: 'Kubernetes 资源名称。' },
  { id: 'term-04', source: 'pod', target: 'Pod', caseSensitive: false, note: '资源对象名称保持 Pod。' },
]

export const seedDiscussions: Discussion[] = [
  { id: 'disc-01', segmentId: 'seg-05', author: '译者 · 李然', body: '这里的 operator 指本项目控制器还是通用 Kubernetes Operator？会影响是否保留英文。', resolved: false, createdAt: Date.now() - 4200000 },
  { id: 'disc-02', segmentId: 'seg-09', author: '审校 · Maya', body: '源链接包含 connectivity 锚点，请勿省略。', resolved: false, createdAt: Date.now() - 2600000 },
  { id: 'disc-03', segmentId: 'seg-02', author: '术语负责人 · Chen', body: '占位符里的变量名不能翻译。', resolved: true, createdAt: Date.now() - 9600000 },
]

export const seedHistory: HistoryEntry[] = [
  { id: 'h-01', segmentId: 'seg-05', author: '译者 · 李然', action: 'edit', before: '', after: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', createdAt: Date.now() - 5200000 },
  { id: 'h-02', segmentId: 'seg-09', author: '译者 · 李然', action: 'edit', before: '', after: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', createdAt: Date.now() - 4000000 },
  { id: 'h-03', segmentId: 'seg-01', author: '审校 · Maya', action: 'confirm', before: '# 部署指南', after: '# 部署指南', createdAt: Date.now() - 3200000 },
  { id: 'h-04', segmentId: 'seg-09', author: '审校 · Maya', action: 'return', before: '', after: '源链接包含 connectivity 锚点，请勿省略。', createdAt: Date.now() - 2600000 },
]

export const seedConflicts: TranslationConflict[] = [
  { id: 'cf-01', segmentId: 'seg-05', localText: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', remoteText: '安装 Operator 时需要集群管理员权限。生产环境应使用专用服务账号。', remoteAuthor: '远端协作者 · Alex', createdAt: Date.now() - 1200000 },
  { id: 'cf-02', segmentId: 'seg-09', localText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', remoteText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting#connectivity)。', remoteAuthor: 'MSW 模拟审校者', createdAt: Date.now() - 900000 },
]

// 退回原因只定向发给认领人（seg-09 认领人为 u-liran），其他用户拉取不到。
export const seedNotices: ReturnNotice[] = [
  {
    id: 'notice-01',
    segmentId: 'seg-09',
    ownerId: 'u-liran',
    reason: '源链接包含 connectivity 锚点，译文中丢失了，请勿省略。',
    serverText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。',
    reviewAuthor: '审校 · Maya',
    createdAt: Date.now() - 2600000,
    dismissed: false,
  },
]

export const seedDocument: LocalizationDocument = {
  id: 'doc-k8s-operator',
  title: 'Kubernetes Operator Developer Guide',
  sourceFile: 'docs/deployment.md',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  updatedAt: Date.now(),
  segments: seedSegments,
  glossary: seedGlossary,
  discussions: seedDiscussions,
}
