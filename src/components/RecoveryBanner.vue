<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFigFile } from '@open-pencil/core/io/formats/fig'

import { activeTab } from '@/app/tabs'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

const store = useEditorStore()
const snapshot = ref<Uint8Array | null>(null)
const restoring = ref(false)
const discarding = ref(false)

// RecoveryBanner lives in App.vue (above the router view), so it does not
// remount on tab switch — re-read the snapshot whenever the active tab
// changes. `immediate: true` covers the first paint after EditorView has
// called createTab() (App.vue mounts before EditorView runs).
const activeTabId = computed(() => activeTab.value?.id ?? '')

async function loadSnapshot() {
  // Guard: the banner must mirror the docKey the recovery module uses.
  // If the active tab's identity changes between read and restore, the
  // snapshot's docKey is stale and we must not apply it.
  const data = await store.readRecoverySnapshot()
  snapshot.value = data ?? null
}

watch(activeTabId, () => {
  void loadSnapshot()
}, { immediate: true })

async function restore() {
  if (!snapshot.value || restoring.value) return
  // Re-check the active tab at click time — users can switch tabs while
  // the banner is open and a stale snapshot must never overwrite a
  // different document.
  const tabIdAtClick = activeTabId.value
  restoring.value = true
  try {
    const blob = new Blob([snapshot.value])
    const file = new File([blob], 'recovery.fig')
    const imported = await readFigFile(file, { populate: 'first-page' })
    if (activeTabId.value !== tabIdAtClick) {
      snapshot.value = null
      return
    }
    await store.applyImportedDocument(imported)
    await store.clearRecoverySnapshot()
    snapshot.value = null
  } catch (e) {
    toast.error(`Failed to restore: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    restoring.value = false
  }
}

async function discard() {
  if (discarding.value) return
  const tabIdAtClick = activeTabId.value
  discarding.value = true
  try {
    await store.clearRecoverySnapshot()
    if (activeTabId.value === tabIdAtClick) snapshot.value = null
  } finally {
    discarding.value = false
  }
}
</script>

<template>
  <div
    v-if="snapshot"
    data-test-id="recovery-banner"
    class="flex items-center gap-3 border-b border-[var(--color-info-border)] bg-[var(--color-info-bg)] px-3 py-2 text-xs text-[var(--color-info-text)]"
  >
    <span class="flex-1">
      We found unsaved AI-generated content from your last session. Restore it or discard?
    </span>
    <button
      data-test-id="recovery-banner-discard"
      class="shrink-0 rounded px-2 py-1 font-medium text-[var(--color-info-text)] opacity-80 transition-opacity hover:opacity-100"
      :disabled="discarding || restoring"
      @click="discard"
    >
      Discard
    </button>
    <button
      data-test-id="recovery-banner-restore"
      class="shrink-0 rounded bg-[var(--color-info-action)] px-2 py-1 font-medium text-[var(--color-info-action-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
      :disabled="restoring || discarding"
      @click="restore"
    >
      {{ restoring ? 'Restoring…' : 'Restore' }}
    </button>
  </div>
</template>