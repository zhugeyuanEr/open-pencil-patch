<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'

import type { ChatSessionsStore } from '@/app/ai/chat/sessions'
import Tip from '@/components/ui/Tip.vue'

const { store, disabled = false } = defineProps<{
  store: ChatSessionsStore
  disabled?: boolean
}>()

const emit = defineEmits<{
  switched: []
}>()

const open = ref(false)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')

function setRenameInput(el: Element | ComponentPublicInstance | null) {
  if (el && 'focus' in el && typeof (el as HTMLInputElement).focus === 'function') {
    nextTick(() => (el as HTMLInputElement).focus())
  }
}

function close() {
  open.value = false
  renamingId.value = null
}

watch(open, (isOpen) => {
  if (!isOpen) renamingId.value = null
})

function onSelect(id: string) {
  if (id === store.getCurrentSession().id) {
    close()
    return
  }
  store.switchSession(id)
  close()
  emit('switched')
}

function startRename(id: string, name: string) {
  renamingId.value = id
  renameDraft.value = name
}

function commitRename() {
  if (renamingId.value && renameDraft.value.trim()) {
    store.renameSession(renamingId.value, renameDraft.value)
  }
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

function handleNew() {
  store.createSession()
  close()
  emit('switched')
}

function handleDelete(id: string) {
  if (store.getAllSessions().length <= 1) return
  store.deleteSession(id)
  emit('switched')
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-test-id="chat-session-toggle"
        :disabled="disabled"
        class="flex max-w-[200px] items-center gap-1.5 rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-surface data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
      >
        <icon-lucide-messages-square class="size-3.5" />
        <span class="truncate">{{ store.getCurrentSession().name }}</span>
        <icon-lucide-chevron-down class="size-3 opacity-50" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        data-test-id="chat-session-dropdown"
        side="bottom"
        align="start"
        :side-offset="4"
        class="z-50 flex w-64 flex-col gap-0.5 rounded-lg border border-border bg-panel p-1 shadow-lg"
      >
        <div
          v-for="session in store.getAllSessions()"
          :key="session.id"
          data-test-id="chat-session-item"
          :data-session-id="session.id"
          class="flex items-center gap-1 rounded-md px-1 py-1 text-xs transition-colors hover:bg-hover"
          :class="{ 'bg-hover': session.id === store.getCurrentSession().id }"
        >
          <template v-if="renamingId === session.id">
            <input
              :ref="setRenameInput"
              v-model="renameDraft"
              data-test-id="chat-session-rename-input"
              class="min-w-0 flex-1 rounded border border-accent bg-input px-1.5 py-0.5 text-xs text-surface outline-none"
              @keydown.enter.prevent="commitRename"
              @keydown.escape.prevent="cancelRename"
              @blur="commitRename"
            />
          </template>
          <template v-else>
            <button
              type="button"
              class="min-w-0 flex-1 cursor-pointer truncate rounded border-none bg-transparent px-1.5 py-0.5 text-left text-xs text-surface"
              @click="onSelect(session.id)"
            >
              {{ session.name }}
            </button>
            <Tip :label="`Rename ${session.name}`">
              <button
                type="button"
                data-test-id="chat-session-rename"
                class="shrink-0 cursor-pointer rounded p-1 text-muted transition-colors hover:bg-accent/20 hover:text-surface"
                @click.stop="startRename(session.id, session.name)"
              >
                <icon-lucide-pencil class="size-3" />
              </button>
            </Tip>
            <Tip :label="`Delete ${session.name}`">
              <button
                type="button"
                data-test-id="chat-session-delete"
                class="shrink-0 cursor-pointer rounded p-1 text-muted transition-colors hover:bg-accent/20 hover:text-surface data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30"
                :disabled="store.getAllSessions().length <= 1"
                @click.stop="handleDelete(session.id)"
              >
                <icon-lucide-trash-2 class="size-3" />
              </button>
            </Tip>
          </template>
        </div>

        <DropdownMenuSeparator class="my-1 h-px bg-border" />

        <DropdownMenuItem
          data-test-id="chat-session-new"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-surface"
          @select="handleNew"
        >
          <icon-lucide-plus class="size-3" />
          <span>New session</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
