<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { ref, useTemplateRef } from 'vue'

import { serializeChatLog } from '@/app/ai/debug'
import { useI18n } from '@open-pencil/vue'
import { toast } from '@/app/shell/ui'

import type { UIMessage } from 'ai'

const { messages } = defineProps<{
  messages: UIMessage[]
}>()

const { dialogs } = useI18n()
const dialogsValue = () => dialogs.value
const open = ref(false)

function serializeMarkdown(messages: UIMessage[]): string {
  const lines: string[] = []
  lines.push(`# AI chat export (${new Date().toISOString()})`)
  lines.push('')
  for (const msg of messages) {
    lines.push(`## ${msg.role}`)
    lines.push('')
    for (const part of msg.parts) {
      const p = part as {
        type: string
        text?: string
        content?: string
        toolName?: string
        state?: string
        output?: unknown
        input?: unknown
      }
      if (p.type === 'text' && typeof p.text === 'string') {
        lines.push(p.text)
        lines.push('')
      } else if (p.type === 'reasoning') {
        let r = ''
        if (typeof p.text === 'string') {
          r = p.text
        } else if (typeof p.content === 'string') {
          r = p.content
        }
        lines.push(`> ${r.split('\n').join('\n> ')}`)
        lines.push('')
      } else if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
        lines.push('```json')
        lines.push(
          JSON.stringify(
            { tool: p.toolName, input: p.input, output: p.output, state: p.state },
            null,
            2
          )
        )
        lines.push('```')
        lines.push('')
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

function buildFilename(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `openpencil-chat-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`
}

const downloadLink = useTemplateRef<HTMLAnchorElement>('downloadLink')

async function copyAsText() {
  await navigator.clipboard.writeText(serializeChatLog(messages))
  toast.info(dialogsValue().copied)
  open.value = false
}

async function copyAsMarkdown() {
  await navigator.clipboard.writeText(serializeMarkdown(messages))
  toast.info(dialogsValue().copied)
  open.value = false
}

function exportMarkdown() {
  const blob = new Blob([serializeMarkdown(messages)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  if (downloadLink.value) {
    downloadLink.value.href = url
    downloadLink.value.download = buildFilename()
    downloadLink.value.click()
  }
  setTimeout(() => URL.revokeObjectURL(url), 0)
  open.value = false
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-test-id="chat-export-toggle"
        class="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-surface"
      >
        <icon-lucide-download class="size-3" />
        Export
      </button>
    </DropdownMenuTrigger>

    <a ref="downloadLink" class="hidden" aria-hidden="true" />

    <DropdownMenuPortal>
      <DropdownMenuContent
        data-test-id="chat-export-dropdown"
        side="top"
        align="start"
        :side-offset="4"
        class="z-50 flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-panel p-1 shadow-lg"
      >
        <DropdownMenuItem
          data-test-id="chat-export-copy-text"
          class="cursor-pointer rounded-md px-2 py-1.5 text-left text-xs text-surface transition-colors hover:bg-hover"
          @select="copyAsText"
        >
          Copy as text
        </DropdownMenuItem>
        <DropdownMenuItem
          data-test-id="chat-export-copy-markdown"
          class="cursor-pointer rounded-md px-2 py-1.5 text-left text-xs text-surface transition-colors hover:bg-hover"
          @select="copyAsMarkdown"
        >
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem
          data-test-id="chat-export-download-markdown"
          class="cursor-pointer rounded-md px-2 py-1.5 text-left text-xs text-surface transition-colors hover:bg-hover"
          @select="exportMarkdown"
        >
          Export .md
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
