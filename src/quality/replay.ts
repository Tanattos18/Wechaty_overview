import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Engine, type KnowledgeMatcher } from '../engine/engine.js'
import { Store } from '../store.js'
import type { TenantConfig } from '../types.js'

/** Dia e hora fixos (terça, 12h em Brasília): as respostas não mudam conforme o horário do teste. */
const FIXED_NOW = new Date('2026-01-06T15:00:00Z')

/**
 * Reproduz uma conversa num ambiente isolado (cópia do cliente, sem IA, frases sempre na mesma variação),
 * sem tocar nas conversas, pedidos e perguntas sem resposta reais.
 */
export async function replay (tenant: TenantConfig, knowledge: KnowledgeMatcher | undefined, messages: string[]): Promise<string[][]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-replay-'))
  const store = new Store(dir)
  store.saveTenant({ ...structuredClone(tenant), ai: { ...tenant.ai, enabled: false }, suspended: false })
  const quiet: KnowledgeMatcher | undefined = knowledge && {
    match: (t, text) => knowledge.match(t, text),
    candidates: knowledge.candidates && ((t, text) => knowledge.candidates!(t, text)),
    answerFor: knowledge.answerFor && ((t, key) => knowledge.answerFor!(t, key)),
    logUnanswered: () => {}, // ensaio não entra na lista de perguntas sem resposta
  }
  const engine = new Engine({ store, knowledge: quiet, random: () => 0, now: () => FIXED_NOW })
  const out: string[][] = []
  try {
    for (const text of messages) {
      out.push(await engine.handle({ tenantId: tenant.id, chatId: 'replay', name: 'Cliente', text, channel: 'simulator' }))
    }
  } finally {
    await store.flush()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return out
}
