import fs from 'node:fs'
import path from 'node:path'
import type { KnowledgeBase } from '../knowledge/kb.js'
import type { SavedTest, Store } from '../store.js'
import type { Conversation, TenantConfig } from '../types.js'
import { replay } from './replay.js'

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
const day = (d: Date | string) => DAY.format(new Date(d))

// ---------- painel de qualidade ----------

/**
 * Quanto o bot entendeu nos últimos dias: cada mensagem do cliente respondida pelo bot
 * conta como entendida, a não ser que a resposta tenha sido "não entendi".
 */
export function qualityStats (store: Store, kb: KnowledgeBase, tenant: TenantConfig, days = 7) {
  const last = Array.from({ length: days }, (_, i) => day(new Date(Date.now() - (days - 1 - i) * 86_400_000)))
  const byDay = Object.fromEntries(last.map(d => [d, { answered: 0, understood: 0 }]))
  let answered = 0
  let understood = 0
  let handoffs = 0
  let clarified = 0
  let markedWrong = 0
  for (const c of store.listConversations(tenant.id)) {
    for (const m of c.messages) {
      if (m.from !== 'bot') continue
      if (m.feedback === 'bad') markedWrong++
      if (!m.kind) continue // mensagens antigas, de antes da marcação
      const d = day(m.at)
      if (!(d in byDay)) continue
      answered++
      byDay[d].answered++
      if (m.kind !== 'fallback') { understood++; byDay[d].understood++ }
      if (m.kind === 'handoff') handoffs++
      if (m.kind === 'clarify') clarified++
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  return {
    understoodPct: pct(understood, answered),
    answered,
    notUnderstood: answered - understood,
    handoffs,
    clarified,
    markedWrong,
    unanswered: kb.listUnanswered(tenant.id, 10),
    days: last.map(d => ({ day: d, pct: pct(byDay[d].understood, byDay[d].answered), answered: byDay[d].answered })),
  }
}

// ---------- bateria de testes antes de vender ----------

interface QaPhrase { text: string; expect: string | null }

let qaPhrases: QaPhrase[] | undefined
function phrases (): QaPhrase[] {
  qaPhrases ??= JSON.parse(fs.readFileSync(path.resolve('knowledge/qa-phrases.json'), 'utf8')) as QaPhrase[]
  return qaPhrases
}

/**
 * Roda frases típicas do ramo contra a configuração do cliente e lista o que falha,
 * os assuntos sem informação preenchida e os fluxos básicos (saudação, cardápio, pedido, atendente).
 */
export async function runQa (kb: KnowledgeBase, tenant: TenantConfig) {
  const packs = tenant.knowledge?.packs ?? ['comum']
  const variables = new Map(kb.listPacks().flatMap(p => p.variables.map(v => [v.key, v.label] as const)))

  // 1) Frases: o bot acerta o assunto?
  const results = phrases()
    .filter(p => p.expect === null || packs.includes(p.expect.split('/')[0]))
    .map(p => {
      const r = kb.match(tenant, p.text)
      const got = r ? `${r.packId}/${r.topic}` : null
      if (got !== p.expect) return { text: p.text, expect: p.expect, got, status: 'errado' as const, title: r?.title }
      if (r?.status === 'missing') {
        return { text: p.text, expect: p.expect, got, status: 'sem-info' as const, title: r.title, missing: r.missing.map(k => variables.get(k) ?? k) }
      }
      return { text: p.text, expect: p.expect, got, status: 'ok' as const, title: r?.title }
    })

  // 2) Assuntos dos pacotes ativos que ainda não têm a informação do cliente
  const missingTopics: { key: string; title: string; missing: string[] }[] = []
  for (const packId of packs) {
    const pack = kb.getPack(packId)
    for (const t of pack?.topics ?? []) {
      const r = kb.answerFor(tenant, `${packId}/${t.key}`)
      if (r?.status === 'missing') missingTopics.push({ key: `${packId}/${t.key}`, title: t.title, missing: r.missing.map(k => variables.get(k) ?? k) })
    }
  }

  // 3) Fluxos básicos, reproduzidos num ambiente isolado
  const flows: { name: string; ok: boolean; detail: string }[] = []
  const check = async (name: string, messages: string[], test: (last: string) => boolean) => {
    const out = await replay(tenant, kb, messages)
    const last = out.at(-1)?.join('\n') ?? ''
    flows.push({ name, ok: test(last), detail: last.slice(0, 160) })
  }
  await check('Saudação com o nome do negócio', ['oi'], t => t.includes(tenant.name))
  if (tenant.products.some(p => p.active)) {
    await check('Mostrar o cardápio', ['oi', 'cardapio'], t => /Catálogo/.test(t))
    await check('Pedir pelo número da lista', ['cardapio', '1'], t => /1x |Qual tamanho/.test(t))
    await check('Total do pedido', ['cardapio', '1', 'quanto deu tudo?'], t => /deu \*|Qual tamanho/.test(t))
  } else {
    flows.push({ name: 'Cardápio cadastrado', ok: false, detail: 'Nenhum produto ativo: o bot não consegue anotar pedidos.' })
  }
  await check('Chamar atendente', ['oi', 'quero falar com um atendente'], () => true)

  const ok = results.filter(r => r.status === 'ok').length
  return {
    score: results.length ? Math.round((ok / results.length) * 100) : 0,
    total: results.length,
    ok,
    results: results.filter(r => r.status !== 'ok'),
    missingTopics,
    flows,
  }
}

// ---------- conversas salvas como teste ----------

export async function runSavedTests (kb: KnowledgeBase, tenant: TenantConfig, tests: SavedTest[]) {
  const out = []
  for (const t of tests) {
    const got = await replay(tenant, kb, t.messages)
    const diffs = t.messages.flatMap((said, i) => {
      const expected = (t.expected[i] ?? []).join('\n')
      const now = (got[i] ?? []).join('\n')
      return expected === now ? [] : [{ step: i + 1, said, expected, got: now }]
    })
    out.push({ id: t.id, title: t.title, ok: diffs.length === 0, diffs, got })
  }
  return out
}

// ---------- exportar conversas ----------

export function exportConversations (store: Store, tenant: TenantConfig, format: 'txt' | 'json', days: number): string {
  const since = Date.now() - days * 86_400_000
  const convs = store.listConversations(tenant.id)
    .filter(c => new Date(c.updatedAt).getTime() >= since)
    .map(c => ({ ...c, messages: c.messages.filter(m => new Date(m.at).getTime() >= since) }))
  if (format === 'json') {
    return JSON.stringify(convs.map(c => ({
      name: c.name, channel: c.channel, state: c.state,
      messages: c.messages.map(m => ({ from: m.from, text: m.text, at: m.at, kind: m.kind, feedback: m.feedback })),
    })), null, 2)
  }
  const hour = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const who = { customer: 'Cliente', bot: 'Bot', agent: 'Atendente' } as const
  const block = (c: Conversation) => [
    `==================== ${c.name || 'Sem nome'} (${c.channel === 'simulator' ? 'simulador' : 'WhatsApp'})`,
    ...c.messages.map(m => `[${hour(m.at)}] ${who[m.from]}${m.feedback === 'bad' ? ' 👎' : ''}: ${m.text.replace(/\n+/g, ' ⏎ ')}`),
    '',
  ].join('\n')
  return `Conversas de ${tenant.name} — últimos ${days} dias — ${convs.length} conversa(s)\n\n${convs.map(block).join('\n')}`
}
