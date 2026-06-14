<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onClickOutside, templateRef, useEventListener } from '@vueuse/core'

import { PageListRoot, useI18n, useInlineRename } from '@open-pencil/vue'

import { useMenuUI } from '@/components/ui/menu'
import Tip from '@/components/ui/Tip.vue'

const pageInput = templateRef<HTMLInputElement>('pageInput')
const rename = useInlineRename((id, name) => pageActions.value?.rename(id, name))
const { panels, pages: t } = useI18n()

const pageActions = ref<{
  rename: (pageId: string, name: string) => void
  delete: (pageId: string) => void
} | null>(null)

function setPageActions(
  renamePage: (pageId: string, name: string) => void,
  deletePage: (pageId: string) => void
) {
  pageActions.value = { rename: renamePage, delete: deletePage }
}

const menuCls = useMenuUI({
  content: 'min-w-40',
  separator: 'my-1',
  item: 'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:text-muted/50 data-[highlighted]:bg-hover justify-start'
})

watch(pageInput, (input) => {
  if (input) void rename.focusInput(input)
})

function startRename(pg: { id: string; name: string }) {
  rename.start(pg.id, pg.name)
}

function handlePageDblClick(
  pg: { id: string; name: string },
  renamePage: (pageId: string, name: string) => void,
  deletePage: (pageId: string) => void
) {
  setPageActions(renamePage, deletePage)
  startRename(pg)
}

type ContextPage = { id: string; name: string }

const contextPage = ref<ContextPage | null>(null)
const menuPosition = ref({ x: 0, y: 0 })
const menuOpen = ref(false)
const menuHighlight = ref(0)
const menuEl = ref<HTMLElement | null>(null)
const menuDisabled = ref({ rename: false, delete: false })

function openMenu(
  pg: ContextPage,
  e: MouseEvent,
  canDelete: boolean,
  renamePage: (id: string, name: string) => void,
  deletePage: (id: string) => void
) {
  e.preventDefault()
  contextPage.value = pg
  setPageActions(renamePage, deletePage)
  menuDisabled.value = { rename: false, delete: !canDelete }
  menuPosition.value = { x: e.clientX, y: e.clientY }
  menuHighlight.value = 0
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
  contextPage.value = null
}

onClickOutside(menuEl, closeMenu, { ignore: [] })

useEventListener(document, 'keydown', (e: KeyboardEvent) => {
  if (!menuOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeMenu()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    menuHighlight.value = menuHighlight.value === 1 ? 0 : 1
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    menuHighlight.value = menuHighlight.value === 0 ? 1 : 0
  } else if (e.key === 'Enter') {
    e.preventDefault()
    triggerAction(menuHighlight.value === 0 ? 'rename' : 'delete')
  }
})

const menuStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${menuPosition.value.y}px`,
  left: `${menuPosition.value.x}px`
}))

function triggerAction(action: 'rename' | 'delete') {
  if (!pageActions.value || !contextPage.value) return
  const { rename: renamePage, delete: deletePage } = pageActions.value
  if (action === 'rename') {
    const pg = contextPage.value
    closeMenu()
    void nextTick(() => {
      setPageActions(renamePage, deletePage)
      startRename(pg)
    })
  } else if (action === 'delete') {
    const id = contextPage.value.id
    closeMenu()
    if (id) deletePage(id)
  }
}

function onMenuHover(index: number) {
  menuHighlight.value = index
}

function onMenuClick(action: 'rename' | 'delete') {
  triggerAction(action)
}
</script>

<template>
  <PageListRoot v-slot="{ pages: list, currentPageId, isDivider, actions }">
    <div data-test-id="pages-panel" class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center justify-between px-3 py-1.5">
        <span data-test-id="pages-header" class="text-[11px] tracking-wider text-muted uppercase">{{
          panels.pages
        }}</span>
        <Tip :label="panels.addPage">
          <button
            data-test-id="pages-add"
            class="cursor-pointer rounded border-none bg-transparent px-1 text-base leading-none text-muted hover:bg-hover hover:text-surface"
            @click="actions.add()"
          >
            +
          </button>
        </Tip>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <div
          data-test-id="pages-scroll"
          class="scrollbar-thin h-full overflow-x-hidden overflow-y-auto px-1 pb-1"
        >
          <div v-for="pg in list" :key="pg.id">
            <div
              v-if="rename.editingId.value === pg.id"
              class="flex w-full items-center gap-1.5 rounded px-2 py-1"
            >
              <icon-lucide-file class="size-3 shrink-0 opacity-70" />
              <input
                ref="pageInput"
                data-test-id="pages-item-input"
                class="min-w-0 flex-1 rounded border border-accent bg-input px-1 py-0 text-xs text-surface outline-none"
                :value="pg.name"
                @blur="rename.commit(pg.id, $event)"
                @keydown.stop="rename.onKeydown"
              />
            </div>
            <div
              v-else-if="isDivider(pg)"
              class="my-1 flex items-center px-2"
              @dblclick="startRename(pg)"
            >
              <div class="h-px flex-1 bg-border" />
            </div>
            <button
              v-else
              data-test-id="pages-item"
              :data-page-id="pg.id"
              class="flex w-full cursor-pointer items-center gap-1.5 rounded border-none px-2 py-1 text-left text-xs"
              :class="
                pg.id === currentPageId
                  ? 'bg-hover text-surface'
                  : 'bg-transparent text-muted hover:bg-hover hover:text-surface'
              "
              @click="actions.switch(pg.id)"
              @contextmenu="
                (e) => openMenu(pg, e, list.length > 1, actions.rename, actions.delete)
              "
              @dblclick="handlePageDblClick(pg, actions.rename, actions.delete)"
            >
              <icon-lucide-file class="size-3 shrink-0" />
              <span class="truncate">{{ pg.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <Teleport v-if="menuOpen" to="body">
      <div
        ref="menuEl"
        role="menu"
        data-test-id="pages-context-menu"
        :class="menuCls.content"
        :style="menuStyle"
      >
        <button
          type="button"
          role="menuitem"
          data-test-id="pages-rename"
          :class="[
            menuCls.item,
            menuHighlight === 0 ? 'bg-hover' : '',
            menuDisabled.rename ? 'pointer-events-none opacity-50' : ''
          ]"
          :disabled="menuDisabled.rename"
          :data-highlighted="menuHighlight === 0 ? '' : undefined"
          @click="onMenuClick('rename')"
          @mouseenter="onMenuHover(0)"
        >
          <span>{{ t.rename }}</span>
        </button>
        <div :class="menuCls.separator" />
        <button
          type="button"
          role="menuitem"
          data-test-id="pages-delete"
          :class="[
            menuCls.item,
            menuHighlight === 1 ? 'bg-hover' : '',
            menuDisabled.delete ? 'pointer-events-none opacity-50' : ''
          ]"
          :disabled="menuDisabled.delete"
          :data-highlighted="menuHighlight === 1 ? '' : undefined"
          @click="onMenuClick('delete')"
          @mouseenter="onMenuHover(1)"
        >
          <span>{{ t.delete }}</span>
        </button>
      </div>
    </Teleport>
  </PageListRoot>
</template>
