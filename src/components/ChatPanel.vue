<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset, useEventListener } from '@vueuse/core'
import { computed, markRaw, nextTick, onUnmounted, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import { copyChatLog } from '@/app/ai/debug'
import { clearToolLogEntries, didHitStepLimit } from '@/app/ai/tools'
import { activeTab } from '@/app/tabs'
import AcpPermissionDialog from '@/components/chat/AcpPermissionDialog.vue'
import ChatExportMenu from '@/components/chat/ChatExportMenu.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import ChatSessionMenu from '@/components/chat/ChatSessionMenu.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import { useI18n } from '@open-pencil/vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { JsonObject } from '@open-pencil/core/types'

const IS_DEV = import.meta.env.DEV

const { isConfigured, ensureChat, clearCurrentSessionMessages, flushChat, sessions } = useAIChat()
const { dialogs } = useI18n()
const editorStore = useEditorStore()

const chat = ref<Chat<UIMessage> | null>(null)
const sessionStore = computed(() => sessions.value)

ensureChat().then((c) => {
  if (c) chat.value = markRaw(c)
})
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const messages = computed(() => chat.value?.messages ?? [])
const status = computed(() => chat.value?.status ?? 'ready')
const isChatBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const isThinking = computed(() => {
  const s = status.value
  if (s !== 'submitted' && s !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as JsonObject
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return s === 'submitted'
})

const showContinue = computed(() => {
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

function scrollToBottom() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
}

watch(messages, scrollToBottom, { deep: true })

// Persist every message change into the active sessions store.
// sessions store is the source of truth; ai-sdk Chat is just the live runtime.
watch(
  messages,
  (msgs) => {
    const s = sessionStore.value
    if (s) s.setMessages(msgs as UIMessage[])
  },
  { deep: true }
)

// When active tab changes, ask the chat manager to rebuild a Chat instance
// for the new doc (transports.ts swaps the sessions store automatically).
watch(
  () => activeTab.value?.id,
  async () => {
    const nextChat = await ensureChat()
    chat.value = nextChat ? markRaw(nextChat) : null
  }
)

// Also re-ensure when the active document source or name changes
// (e.g., on first open of a file in the current tab, the tab id is the
// same but documentName and the non-reactive source path are filled in later).
watch(
  () =>
    `${activeTab.value?.id ?? ''}::${editorStore.state.documentName ?? ''}::${
      editorStore.state.documentSourceVersion
    }`,
  async () => {
    const nextChat = await ensureChat()
    chat.value = nextChat ? markRaw(nextChat) : null
  }
)

watch(
  () => chat.value?.error,
  (error) => {
    if (error) toast.error(error.message)
  }
)

watch(isChatBusy, (busy, wasBusy) => {
  if (!busy && wasBusy) {
    flushCurrentChat()
    void editorStore.writeRecoverySnapshot()
  }
})

function flushCurrentChat() {
  void flushChat()
}

onUnmounted(flushCurrentChat)
useEventListener(window, 'pagehide', flushCurrentChat)
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCurrentChat()
})

async function handleSubmit(text: string) {
  if (isChatBusy.value) return
  try {
    const c = await ensureChat()
    if (c) chat.value = markRaw(c)
  } catch (e) {
    console.error('Failed to initialize chat:', e)
    toast.error(e instanceof Error ? e.message : String(e))
    return
  }
  chat.value?.sendMessage({ text }).catch((e: unknown) => {
    console.error('Chat error:', e)
    toast.error(e instanceof Error ? e.message : String(e))
  })
}

function handleStop() {
  chat.value?.stop()
}

async function handleCopyDebug() {
  await copyChatLog(messages.value)
  debugCopied.value = true
}

async function handleCopyAcpLog() {
  const text = getAcpDebugText()
  if (!text) return
  await navigator.clipboard.writeText(text)
  acpLogCopied.value = true
}

function handleClearChat() {
  chat.value = null
  clearCurrentSessionMessages()
  clearToolLogEntries()
  clearAcpDebugLog()
}

async function onSessionSwitched() {
  const nextChat = await ensureChat()
  chat.value = nextChat ? markRaw(nextChat) : null
  await flushChat()
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <header
        v-if="sessionStore"
        class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
      >
        <ChatSessionMenu
          :store="sessionStore"
          :disabled="isChatBusy"
          @switched="onSessionSwitched"
        />
      </header>

      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <!-- Empty state -->
          <div
            v-if="messages.length === 0"
            data-test-id="chat-empty-state"
            class="flex h-full flex-col items-center justify-center gap-3 text-muted"
          >
            <icon-lucide-message-circle class="size-8 opacity-50" />
            <p class="text-center text-xs">{{ dialogs.describeCreateOrChange }}</p>
          </div>

          <!-- Messages -->
          <div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
            <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

            <!-- Thinking indicator: shown when AI is working but no visible activity -->
            <div v-if="isThinking" data-test-id="chat-typing-indicator" class="flex gap-2">
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
              >
                AI
              </div>
              <div class="flex items-center gap-1 py-2">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 0ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 150ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 300ms"
                />
              </div>
            </div>

            <!-- Continue button when step limit reached -->
            <div v-if="showContinue" class="flex justify-center py-2">
              <button
                class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                @click="handleSubmit('Continue where you left off')"
              >
                <icon-lucide-play class="size-3" />
                Continue
              </button>
            </div>

            <div ref="messagesEnd" />
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
          <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <!-- Chat toolbar -->
      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <ChatExportMenu :messages="messages" />
        <AppTextButton
          v-if="IS_DEV"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyDebug"
        >
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </AppTextButton>
        <AppTextButton
          v-if="IS_DEV && hasAcpDebugEntries()"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyAcpLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppTextButton>
        <AppTextButton
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </AppTextButton>
      </div>

      <ChatInput :status="status" @submit="handleSubmit" @stop="handleStop" />

      <AcpPermissionDialog />
    </template>
  </div>
</template>
