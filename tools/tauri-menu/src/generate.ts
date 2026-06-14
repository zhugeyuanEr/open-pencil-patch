import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { APP_MENU_SCHEMA } from '@/app/shell/menu/schema'
import type { AppMenuEntry, AppMenuGroupSchema } from '@/app/shell/menu/schema'
import { shortcutTokenToAccelerator } from '@/app/shell/menu/shortcut'

function isNativeVisible(entry: { target?: string }): boolean {
  return entry.target !== 'browser'
}

const ZH_LABELS: Record<string, string> = {
  File: '文件',
  Edit: '编辑',
  View: '视图',
  Object: '对象',
  Arrange: '排列',
  Text: '文本',
  New: '新建',
  'Open…': '打开…',
  Save: '保存',
  'Save As…': '另存为…',
  'Export Selection': '导出所选内容',
  'Export selection': '导出所选内容',
  PNG: 'PNG',
  SVG: 'SVG',
  '.fig': '.fig',
  Autosave: '自动保存到本地文件',
  'Close Tab': '关闭标签页',
  Undo: '撤销',
  Redo: '重做',
  Copy: '复制',
  Cut: '剪切',
  Paste: '粘贴',
  'Paste to replace': '粘贴并替换',
  Duplicate: '复制',
  Delete: '删除',
  'Select All': '全选',
  'Zoom to 100%': '缩放到 100%',
  'Zoom to Fit': '适应屏幕',
  'Zoom to Selection': '适应所选内容',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  Theme: '主题',
  Light: '浅色',
  Dark: '深色',
  Auto: '自动',
  Language: '语言',
  'Toggle UI': '切换界面',
  Profiler: '性能分析器',
  'Developer Tools': '开发者工具',
  'Group Selection': '编组所选内容',
  'Frame Selection': '为所选内容添加画框',
  'Ungroup Selection': '取消编组',
  'Union selection': '合并所选内容',
  'Subtract selection': '减去所选内容',
  'Intersect selection': '相交所选内容',
  'Exclude selection': '排除所选内容',
  Flatten: '扁平化',
  'Outline text': '文本转轮廓',
  'Outline stroke': '描边转轮廓',
  'Create Component': '创建组件',
  'Create Component Set': '创建组件集',
  'Detach Instance': '分离实例',
  'Bring to Front': '置于顶层',
  'Send to Back': '置于底层',
  Bold: '加粗',
  Italic: '斜体',
  Underline: '下划线',
  'Wrap in Auto Layout': '添加自动布局',
  'Align Left': '左对齐',
  'Align Center': '水平居中',
  'Align Right': '右对齐',
  'Align Top': '顶部对齐',
  'Align Middle': '垂直居中',
  'Align Bottom': '底部对齐'
}

function translate(label: string): string {
  return ZH_LABELS[label] ?? label
}

function cleanEntry(entry: AppMenuEntry): unknown | null {
  if (!isNativeVisible(entry)) return null
  if (entry.type === 'separator') return { type: 'separator' }
  return {
    id: entry.id,
    label: translate(entry.label),
    accelerator: entry.accelerator ?? shortcutTokenToAccelerator(entry.shortcut),
    checkbox: entry.checkbox,
    sub: entry.sub?.map(cleanEntry).filter(Boolean)
  }
}

function cleanGroup(group: AppMenuGroupSchema): unknown | null {
  if (!isNativeVisible(group)) return null
  return {
    label: translate(group.label),
    items: group.items.map(cleanEntry).filter(Boolean)
  }
}

const outputPath = 'desktop/generated/menu.json'
const menu = APP_MENU_SCHEMA.map(cleanGroup).filter(Boolean)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(menu, null, 2)}\n`)
