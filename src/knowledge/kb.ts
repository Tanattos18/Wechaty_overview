import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { similar } from '../engine/nlu.js'
import type { TenantConfig } from '../types.js'

// ---------- formato dos pacotes (o mesmo do arquivo exportado) ----------

export interface PackVariable {
  key: string
  label: string
  example?: string
}

export type TopicAction = 'catalog' | 'human'

export interface PackTopic {
  key: string
  title: string
  category: string
  /** Pode usar {variaveis}. Vazio é permitido quando há uma ação. */
  answer: string
  action?: TopicAction
  questions: string[]
}

export interface KnowledgePack {
  id: string
  name: string
  segment: string
  version: number
  description: string
  variables: PackVariable[]
  topics: PackTopic[]
}

export interface PackSummary {
  id: string
  name: string
  segment: string
  version: number
  description: string
  variables: PackVariable[]
  topics: number
  questions: number
}

export type KbResult =
  | { status: 'answer'; packId: string; topic: string; title: string; score: number; answer: string; action?: TopicAction; question: string }
  /** Reconheceu o assunto, mas o cliente não preencheu a informação (ou desativou a resposta). */
  | { status: 'missing'; packId: string; topic: string; title: string; score: number; missing: string[]; question: string }

export interface UnansweredRow {
  id: number
  text: string
  count: number
  topic: string | null
  firstAt: string
  lastAt: string
}

/** Variáveis que vêm dos dados do negócio, sem precisar preencher de novo. */
export const BUILTIN_VARIABLES = ['empresa', 'horario', 'endereco', 'telefone']

const MIN_SCORE = 0.55

// ---------- texto ----------

const ABBREVIATIONS: Record<string, string> = {
  vc: 'voce', vcs: 'voces', voce: 'voce', voces: 'voces', q: 'que', oq: 'que', tb: 'tambem', tbm: 'tambem',
  pq: 'porque', qto: 'quanto', qnto: 'quanto', qdo: 'quando', td: 'tudo', tds: 'todos', hj: 'hoje', amanha: 'amanha',
  msg: 'mensagem', cel: 'celular', zap: 'whatsapp', wpp: 'whatsapp', insta: 'instagram', ig: 'instagram',
  tá: 'esta', ta: 'esta', tao: 'estao', to: 'estou', pra: 'para', pro: 'para', pros: 'para', num: 'em', dps: 'depois',
  cartao: 'cartao', cardapio: 'cardapio', refri: 'refrigerante', cachorra: 'cachorro', dog: 'cachorro', cao: 'cachorro',
}

/** Palavras que não ajudam a diferenciar assuntos (artigos, preposições, cortesia). */
const LIGHT_STOPWORDS = new Set((
  'a o as os um uma uns umas de da do das dos e em no na nos nas para por pelo pela com que ao aos ' +
  'me te se lhe eu ele ela isso esse essa este esta isto aquele aquela aquilo ai la aqui favor pf pfv por ola oi bom boa dia tarde noite ok'
).split(' '))

/** Palavras que aparecem em perguntas de todo tipo: sozinhas, não escolhem um assunto. */
const GENERIC_WORDS = new Set((
  'quero queria gostaria preciso pode poderia tem tenho ter voce voces sabe saber faz fazer ser esta estao estou ' +
  'como qual quais quanto onde quando porque mais meu minha seu sua algum alguma coisa ver sim nao'
).split(' ').map(stem))

function normalizeText (text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stem (w: string): string {
  if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1)
  if (w.length > 4 && w.endsWith('m')) w = w.slice(0, -1) // abrem -> abre, entregam -> entrega
  return w
}

export function kbTokens (text: string): string[] {
  const out = new Set<string>()
  for (const raw of normalizeText(text).split(' ')) {
    const w = ABBREVIATIONS[raw] ?? raw
    // Um dígito sozinho ("quero a 1") não diferencia assuntos e confundia com datas ("dia 1 de janeiro")
    if (!w || LIGHT_STOPWORDS.has(w) || /^\d$/.test(w)) continue
    out.add(stem(w))
  }
  return [...out]
}

// ---------- índice de busca ----------

interface Entry {
  packId: string
  topic: string
  title: string
  answer: string
  action?: TopicAction
  question: string
  norm: string
  tokens: string[]
}

interface TopicGroup {
  entries: Entry[]
  /** Todas as palavras usadas nas perguntas do assunto. */
  vocabulary: string[]
}

interface Index {
  topics: TopicGroup[]
  idf: Map<string, number>
  maxIdf: number
}

function buildIndex (entries: Entry[]): Index {
  const df = new Map<string, number>()
  for (const e of entries) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  const n = Math.max(1, entries.length)
  const idf = new Map<string, number>()
  for (const [t, f] of df) idf.set(t, Math.log(1 + n / f))

  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = `${e.packId}/${e.topic}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const topics = [...groups.values()].map(list => ({
    entries: list,
    vocabulary: [...new Set(list.flatMap(e => e.tokens))],
  }))
  return { topics, idf, maxIdf: Math.log(1 + n) }
}

/**
 * Comparação de palavras mais rígida que a do catálogo: só aceita erro de 1 letra
 * ou variações do mesmo radical ("parcela"/"parcelar"), nunca "conta"/"contato".
 */
function sameWord (a: string, b: string): boolean {
  if (a === b) return true
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  if (s.length >= 6 && l.startsWith(s) && l.length - s.length <= 3) return true
  return s.length >= 5 && similar(a, b) && !l.startsWith(s)
}

/**
 * Parecido de Dice ponderado: palavras raras (ex.: "estacionamento") pesam mais que
 * palavras comuns (ex.: "voces"). Palavras da mensagem que não existem em nenhuma
 * pergunta pesam o máximo e derrubam a nota, evitando respostas fora de contexto.
 */
function sentenceScore (index: Index, msg: string[], entry: Entry): number {
  const w = (t: string) => index.idf.get(t) ?? index.maxIdf
  let total = 0
  let matched = 0
  for (const t of msg) {
    total += w(t)
    if (entry.tokens.some(e => sameWord(t, e))) matched += w(t)
  }
  for (const e of entry.tokens) {
    total += w(e)
    if (msg.some(t => sameWord(t, e))) matched += w(e)
  }
  return total ? matched / total : 0
}

/** Quanto das palavras da mensagem aparece em alguma pergunta do assunto (ponderado). */
function coverage (index: Index, msg: string[], group: TopicGroup): number {
  const w = (t: string) => index.idf.get(t) ?? index.maxIdf
  let total = 0
  let matched = 0
  for (const t of msg) {
    total += w(t)
    if (group.vocabulary.some(v => sameWord(t, v))) matched += w(t)
  }
  return total ? matched / total : 0
}

// ---------- banco ----------

export class KnowledgeBase {
  private readonly db: DatabaseSync
  private indexes = new Map<string, Index>()

  constructor (file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        segment TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL,
        variables TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY,
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        action TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (pack_id, key)
      );
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY,
        topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        norm TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);
      CREATE TABLE IF NOT EXISTS unanswered (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        text TEXT NOT NULL,
        norm TEXT NOT NULL,
        topic TEXT,
        count INTEGER NOT NULL DEFAULT 1,
        first_at TEXT NOT NULL,
        last_at TEXT NOT NULL,
        UNIQUE (tenant_id, norm)
      );
    `)
  }

  close (): void {
    this.db.close()
  }

  /** Carrega os pacotes da pasta (knowledge/packs) quando o arquivo tem versão mais nova que o banco. */
  syncFromDir (dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    const updated: string[] = []
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as KnowledgePack
      const current = this.db.prepare('SELECT version FROM packs WHERE id = ?').get(pack.id) as { version: number } | undefined
      if (!current || current.version < pack.version) {
        this.importPack(pack)
        updated.push(pack.id)
      }
    }
    return updated
  }

  /** Grava (ou substitui por completo) um pacote. Lança erro com mensagem clara se o formato for inválido. */
  importPack (input: unknown): KnowledgePack {
    const pack = validatePack(input)
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM packs WHERE id = ?').run(pack.id)
      this.db.prepare(`INSERT INTO packs (id, name, segment, description, version, variables, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(pack.id, pack.name, pack.segment, pack.description, pack.version, JSON.stringify(pack.variables), now)
      const insertTopic = this.db.prepare(`INSERT INTO topics (pack_id, key, title, category, answer, action, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      const insertQuestion = this.db.prepare('INSERT INTO questions (topic_id, text, norm) VALUES (?, ?, ?)')
      pack.topics.forEach((t, i) => {
        const { lastInsertRowid } = insertTopic.run(pack.id, t.key, t.title, t.category, t.answer, t.action ?? null, i)
        const seen = new Set<string>()
        for (const q of t.questions) {
          const norm = normalizeText(q)
          if (!norm || seen.has(norm)) continue
          seen.add(norm)
          insertQuestion.run(lastInsertRowid, q.trim(), norm)
        }
      })
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    this.indexes.clear()
    return pack
  }

  listPacks (): PackSummary[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.name, p.segment, p.description, p.version, p.variables,
        (SELECT COUNT(*) FROM topics t WHERE t.pack_id = p.id) AS topics,
        (SELECT COUNT(*) FROM questions q JOIN topics t ON t.id = q.topic_id WHERE t.pack_id = p.id) AS questions
      FROM packs p ORDER BY CASE p.id WHEN 'comum' THEN 0 ELSE 1 END, p.name`).all() as any[]
    return rows.map(r => ({
      id: r.id, name: r.name, segment: r.segment, description: r.description, version: r.version,
      variables: JSON.parse(r.variables), topics: Number(r.topics), questions: Number(r.questions),
    }))
  }

  /** Pacote completo, no mesmo formato do arquivo JSON (usado para exportar). */
  getPack (id: string): KnowledgePack | undefined {
    const p = this.db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as any
    if (!p) return undefined
    const topics = this.db.prepare('SELECT * FROM topics WHERE pack_id = ? ORDER BY position').all(id) as any[]
    const questions = this.db.prepare(`SELECT q.topic_id, q.text FROM questions q JOIN topics t ON t.id = q.topic_id
      WHERE t.pack_id = ? ORDER BY q.id`).all(id) as any[]
    return {
      id: p.id,
      name: p.name,
      segment: p.segment,
      version: p.version,
      description: p.description,
      variables: JSON.parse(p.variables),
      topics: topics.map(t => ({
        key: t.key,
        title: t.title,
        category: t.category,
        answer: t.answer,
        ...(t.action ? { action: t.action as TopicAction } : {}),
        questions: questions.filter(q => q.topic_id === t.id).map(q => q.text),
      })),
    }
  }

  deletePack (id: string): boolean {
    const { changes } = this.db.prepare('DELETE FROM packs WHERE id = ?').run(id)
    this.indexes.clear()
    return Number(changes) > 0
  }

  private index (packIds: string[]): Index {
    const key = [...packIds].sort().join(',')
    let index = this.indexes.get(key)
    if (!index) {
      const placeholders = packIds.map(() => '?').join(',') || "''"
      const rows = this.db.prepare(`
        SELECT t.pack_id, t.key, t.title, t.answer, t.action, q.text, q.norm
        FROM questions q JOIN topics t ON t.id = q.topic_id
        WHERE t.pack_id IN (${placeholders})`).all(...packIds) as any[]
      index = buildIndex(rows.map(r => ({
        packId: r.pack_id, topic: r.key, title: r.title, answer: r.answer, action: r.action ?? undefined,
        question: r.text, norm: r.norm, tokens: kbTokens(r.norm),
      })))
      this.indexes.set(key, index)
    }
    return index
  }

  /** Procura a pergunta mais parecida nos pacotes ativos do cliente. */
  match (tenant: TenantConfig, text: string, minScore = MIN_SCORE): KbResult | undefined {
    const knowledge = tenantKnowledge(tenant)
    if (knowledge.packs.length === 0) return undefined
    const msg = kbTokens(text)
    // Só palavras genéricas ("quero", "pode", "como"...) não indicam assunto nenhum
    if (msg.length === 0 || msg.every(t => GENERIC_WORDS.has(t))) return undefined
    const norm = normalizeText(text)

    // Nota do assunto = 60% a pergunta mais parecida + 40% o vocabulário do assunto todo
    const index = this.index(knowledge.packs)
    let best: { entry: Entry; score: number } | undefined
    for (const group of index.topics) {
      let top: { entry: Entry; score: number } | undefined
      for (const entry of group.entries) {
        const s = entry.norm === norm ? 2 : sentenceScore(index, msg, entry)
        if (!top || s > top.score) top = { entry, score: s }
      }
      if (!top) continue
      const s = top.score >= 2 ? 1 : 0.6 * top.score + 0.4 * coverage(index, msg, group)
      if (!best || s > best.score) best = { entry: top.entry, score: s }
    }
    if (!best || best.score < minScore) return undefined

    const { entry } = best
    const base = { packId: entry.packId, topic: entry.topic, title: entry.title, score: round(best.score), question: entry.question }
    const override = knowledge.overrides[`${entry.packId}/${entry.topic}`]
    if (override?.enabled === false) return { status: 'missing', ...base, missing: [] }

    const template = override?.answer?.trim() ? override.answer : entry.answer
    const vars = tenantVariables(tenant)
    const missing = [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !vars[k]?.trim())
    if (missing.length > 0) return { status: 'missing', ...base, missing: [...new Set(missing)] }

    const answer = template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k].trim())
    return { status: 'answer', ...base, answer, action: entry.action }
  }

  // ---------- perguntas sem resposta ----------

  logUnanswered (tenantId: string, text: string, topic?: string): void {
    const norm = normalizeText(text)
    if (norm.length < 3) return
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO unanswered (tenant_id, text, norm, topic, count, first_at, last_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (tenant_id, norm) DO UPDATE SET count = count + 1, last_at = excluded.last_at,
        topic = COALESCE(excluded.topic, unanswered.topic)`)
      .run(tenantId, text.trim().slice(0, 500), norm, topic ?? null, now, now)
  }

  listUnanswered (tenantId: string, limit = 200): UnansweredRow[] {
    const rows = this.db.prepare(`SELECT id, text, count, topic, first_at, last_at FROM unanswered
      WHERE tenant_id = ? ORDER BY count DESC, last_at DESC LIMIT ?`).all(tenantId, limit) as any[]
    return rows.map(r => ({ id: Number(r.id), text: r.text, count: Number(r.count), topic: r.topic, firstAt: r.first_at, lastAt: r.last_at }))
  }

  deleteUnanswered (tenantId: string, id: number): void {
    this.db.prepare('DELETE FROM unanswered WHERE tenant_id = ? AND id = ?').run(tenantId, id)
  }
}

// ---------- configuração do cliente ----------

export interface TenantKnowledge {
  packs: string[]
  variables: Record<string, string>
  overrides: Record<string, { answer?: string; enabled?: boolean }>
}

export function tenantKnowledge (tenant: TenantConfig): TenantKnowledge {
  return {
    packs: tenant.knowledge?.packs ?? ['comum'],
    variables: tenant.knowledge?.variables ?? {},
    overrides: tenant.knowledge?.overrides ?? {},
  }
}

function tenantVariables (tenant: TenantConfig): Record<string, string> {
  return {
    ...tenantKnowledge(tenant).variables,
    empresa: tenant.name,
    horario: tenant.business.hours,
    endereco: tenant.business.address,
    telefone: tenant.business.phone,
  }
}

const round = (n: number) => Math.round(n * 100) / 100

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/

function validatePack (input: unknown): KnowledgePack {
  const p = input as Partial<KnowledgePack> | null
  const fail = (msg: string): never => { throw new Error(`Pacote inválido: ${msg}`) }
  if (!p || typeof p !== 'object') fail('o arquivo não é um objeto JSON')
  if (typeof p!.id !== 'string' || !ID_RE.test(p!.id)) fail('"id" deve ter letras minúsculas, números, "-" ou "_"')
  if (typeof p!.name !== 'string' || !p!.name.trim()) fail('"name" é obrigatório')
  if (!Array.isArray(p!.topics) || p!.topics.length === 0) fail('"topics" deve ter pelo menos um assunto')
  const keys = new Set<string>()
  const topics = p!.topics!.map((t, i) => {
    const where = `assunto ${i + 1}`
    if (!t || typeof t.key !== 'string' || !ID_RE.test(t.key)) fail(`${where}: "key" inválida`)
    if (keys.has(t.key)) fail(`${where}: "key" repetida (${t.key})`)
    keys.add(t.key)
    if (!Array.isArray(t.questions) || t.questions.filter(q => typeof q === 'string' && q.trim()).length === 0) {
      fail(`${where} (${t.key}): precisa de pelo menos uma pergunta`)
    }
    if (t.action && t.action !== 'catalog' && t.action !== 'human') fail(`${where} (${t.key}): "action" deve ser catalog ou human`)
    if (!t.action && !String(t.answer ?? '').trim()) fail(`${where} (${t.key}): precisa de resposta ou ação`)
    return {
      key: t.key,
      title: String(t.title ?? t.key).slice(0, 120),
      category: String(t.category ?? '').slice(0, 60),
      answer: String(t.answer ?? '').slice(0, 2000),
      ...(t.action ? { action: t.action } : {}),
      questions: t.questions.filter(q => typeof q === 'string' && q.trim()).map(q => q.slice(0, 300)),
    }
  })
  const variables = Array.isArray(p!.variables)
    ? p!.variables.filter(v => v && typeof v.key === 'string' && /^\w{1,40}$/.test(v.key))
        .map(v => ({ key: v.key, label: String(v.label ?? v.key).slice(0, 80), example: v.example ? String(v.example).slice(0, 300) : undefined }))
    : []
  return {
    id: p!.id!,
    name: p!.name!.trim().slice(0, 100),
    segment: String(p!.segment ?? '').slice(0, 40),
    version: Number.isInteger(p!.version) && p!.version! > 0 ? p!.version! : 1,
    description: String(p!.description ?? '').slice(0, 500),
    variables,
    topics,
  }
}
