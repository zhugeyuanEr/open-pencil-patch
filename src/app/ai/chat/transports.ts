import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, UIMessage } from 'ai'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { createLanguageModel, resolveLanguageModelID } from '@/app/ai/chat/model'
import {
  createChatSessionsStore,
  type ChatSessionsStore,
  deleteChatSessions,
  docKeyForTab,
  loadChatDocStorage,
  loadChatSessionsStore
} from '@/app/ai/chat/sessions'
import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'
import { activeTab } from '@/app/tabs'

type EditorStore = ReturnType<typeof getActiveEditorStore>
type TaggedChat = Chat<UIMessage> & { _docKey?: string; _sessionId?: string }

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  apiKey: Ref<string>
  modelID: Ref<string>
  customModelID: Ref<string>
  customBaseURL: Ref<string>
  customAPIType: Ref<'completions' | 'responses'>
  maxOutputTokens: Ref<number>
  getActiveEditorStore: () => EditorStore
}

type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
  maxOutputTokens: number
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

export async function createACPTransport(providerID: AIProviderID) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  return new ACPChatTransport({ agentDef, cwd: await homeDir() })
}

export function createToolLoopTransport({
  store,
  providerID,
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens
}: ToolLoopTransportOptions) {
  const tools = createAITools(store)
  const effectiveModelID = resolveLanguageModelID({ providerID, modelID, customModelID })
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined

  const agent = new ToolLoopAgent({
    model: createLanguageModel({
      providerID,
      apiKey,
      modelID,
      customModelID,
      customBaseURL,
      customAPIType
    }),
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    providerOptions: cacheProviderOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions: cacheProviderOptions
      }
    },
    onStepFinish: ({ usage }) => {
      recordStepUsage(
        {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
          timestamp: Date.now()
        },
        store
      )
    }
  })

  return new DirectChatTransport({ agent }) as ChatTransport<UIMessage>
}

export function createChatSessionManager({
  isConfigured,
  isACPProvider,
  providerID,
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens,
  getActiveEditorStore
}: ChatSessionOptions) {
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let chat: Chat<UIMessage> | null = null
  let currentChatSessions: ChatSessionsStore | null = null
  let acpTransportInstance: { destroy(): Promise<void> } | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null

  let ensureVersion = 0
  const docKeysByStore = new WeakMap<EditorStore, string>()
  const sessionsByDocKey = new Map<string, ChatSessionsStore>()
  const sessionLoads = new Map<string, Promise<ChatSessionsStore>>()
  const sessionsStore = ref<ChatSessionsStore | null>(null)

  function markTransportDirty() {
    transportDirty = true
  }

  async function createActiveACPTransport() {
    await acpTransportInstance?.destroy()
    const transport = await createACPTransport(providerID.value)
    acpTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  function createTransport(store: EditorStore) {
    if (overrideTransport) return overrideTransport()

    void acpTransportInstance?.destroy()
    acpTransportInstance = null

    return createToolLoopTransport({
      store,
      providerID: providerID.value,
      apiKey: apiKey.value,
      modelID: modelID.value,
      customModelID: customModelID.value,
      customBaseURL: customBaseURL.value,
      customAPIType: customAPIType.value,
      maxOutputTokens: maxOutputTokens.value
    })
  }

  function computeDocKey(store: EditorStore): string {
    const tabId = activeTab.value?.id ?? 'unknown'
    return docKeyForTab(tabId, store.getFilePath(), store.state.documentName)
  }

  async function loadOrReuseSessions(
    store: EditorStore,
    docKey: string
  ): Promise<ChatSessionsStore> {
    const previousDocKey = docKeysByStore.get(store)
    if (previousDocKey && previousDocKey !== docKey) {
      await migrateStoreDocKey(store, previousDocKey, docKey)
    }
    docKeysByStore.set(store, docKey)
    return loadSessionsForDocKey(docKey)
  }

  async function loadSessionsForDocKey(docKey: string): Promise<ChatSessionsStore> {
    const cached = sessionsByDocKey.get(docKey)
    if (cached) return cached

    let load = sessionLoads.get(docKey)
    if (!load) {
      load = loadChatSessionsStore(docKey).then((store) => {
        sessionsByDocKey.set(docKey, store)
        sessionLoads.delete(docKey)
        return store
      })
      sessionLoads.set(docKey, load)
    }
    return load
  }

  async function migrateStoreDocKey(
    store: EditorStore,
    previousDocKey: string,
    nextDocKey: string
  ): Promise<void> {
    if (!nextDocKey.startsWith('fp:') || previousDocKey.startsWith('fp:')) return

    const previousStore = sessionsByDocKey.get(previousDocKey)
    if (!previousStore) return

    if (currentChatStore === store && chat) {
      previousStore.setMessages(chat.messages)
    }
    await previousStore.flush()

    const existingTarget = await loadChatDocStorage(nextDocKey)
    let deletePreviousDocKey = false
    if (!existingTarget) {
      const migrated = createChatSessionsStore({
        docKey: nextDocKey,
        initialStorage: previousStore.getStorageSnapshot()
      })
      sessionsByDocKey.set(nextDocKey, migrated)
      await migrated.flush()
      deletePreviousDocKey = true
    }

    sessionsByDocKey.delete(previousDocKey)
    await previousStore.dispose()
    if (deletePreviousDocKey) {
      await deleteChatSessions(previousDocKey)
    }
  }

  function syncCurrentChatMessages() {
    if (chat && currentChatSessions) {
      const taggedChat = chat as TaggedChat
      if (taggedChat._sessionId) {
        currentChatSessions.setSessionMessages(taggedChat._sessionId, chat.messages)
      } else {
        currentChatSessions.setMessages(chat.messages)
      }
    }
  }

  async function ensureChat(): Promise<Chat<UIMessage> | null> {
    if (!isConfigured.value) return null

    const requestVersion = ++ensureVersion
    const store = getActiveEditorStore()
    syncCurrentChatMessages()

    const docKey = computeDocKey(store)
    const sessions = await loadOrReuseSessions(store, docKey)
    const stillCurrent =
      requestVersion === ensureVersion &&
      getActiveEditorStore() === store &&
      computeDocKey(store) === docKey
    if (!stillCurrent) return chat

    sessionsStore.value = sessions
    const currentSession = sessions.getCurrentSession()

    const needsNewTransport = transportDirty || currentChatStore !== store
    const taggedChat = chat as TaggedChat | null
    const needsNewSession = taggedChat
      ? taggedChat._docKey !== docKey || taggedChat._sessionId !== currentSession.id
      : true
    const needsNewChat = !chat || needsNewTransport || needsNewSession

    if (needsNewChat) {
      const transport: ChatTransport<UIMessage> = isACPProvider.value
        ? await createActiveACPTransport()
        : createTransport(store)
      chat = new Chat<UIMessage>({ transport, messages: currentSession.messages })
      ;(chat as TaggedChat)._docKey = docKey
      ;(chat as TaggedChat)._sessionId = currentSession.id
      currentChatStore = store
      currentChatSessions = sessions
      transportDirty = false
    } else {
      currentChatStore = store
      currentChatSessions = sessions
    }
    return chat
  }

  function clearCurrentSessionMessages() {
    if (sessionsStore.value) {
      sessionsStore.value.setMessages([])
    }
    chat = null
    currentChatStore = null
    currentChatSessions = null
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  async function flush(): Promise<void> {
    syncCurrentChatMessages()
    await Promise.all(Array.from(sessionsByDocKey.values(), (store) => store.flush()))
  }

  const sessions = computed<ChatSessionsStore | null>(() => sessionsStore.value)

  return {
    ensureChat,
    clearCurrentSessionMessages,
    markTransportDirty,
    setOverrideTransport,
    flush,
    sessions
  }
}
