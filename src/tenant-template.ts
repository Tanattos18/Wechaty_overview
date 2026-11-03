import type { MenuOption, Product, ProductOption, TenantConfig } from './types.js'

/** Configuração inicial de um cliente novo — tudo editável depois pelo painel. */
export function newTenant (id: string, name: string, segmentPack?: string): TenantConfig {
  return {
    id,
    name,
    active: true,
    business: {
      description: '',
      hours: 'Segunda a sexta, 9h às 18h',
      address: '',
      phone: '',
      extraInfo: '',
    },
    messages: {
      welcome: '{saudacao}, {nome}! 😊 Aqui é da *{empresa}*. Como posso te ajudar?',
      fallback: 'Desculpe, não entendi. 🤔',
      humanHandoff: 'Claro! Vou chamar alguém da equipe pra falar com você. Só um instantinho! 🙋',
      humanBack: 'Voltei por aqui! 😊',
      orderConfirmed: '✅ Pedido *{pedido}* confirmado! Obrigado, {nome}. Já estamos preparando e em breve te avisamos sobre a entrega.',
      nonText: 'Por enquanto eu só consigo ler mensagens de texto. 😅 Pode me escrever o que precisa?',
    },
    menu: [
      { key: '1', label: 'Ver catálogo e fazer pedido', type: 'catalog' },
      { key: '2', label: 'Horário e endereço', type: 'text', text: '🕘 {empresa}\nHorário: (preencha no painel)\nEndereço: (preencha no painel)' },
      { key: '3', label: 'Tirar uma dúvida', type: 'ai' },
      { key: '4', label: 'Falar com atendente', type: 'human' },
    ],
    products: [],
    ai: { enabled: true, instructions: '' },
    humanTimeoutMin: 30,
    knowledge: {
      packs: segmentPack && segmentPack !== 'comum' ? ['comum', segmentPack] : ['comum'],
      variables: {},
      overrides: {},
    },
  }
}

const KEY_RE = /^[\w-]{1,40}$/

/** Valida pacotes ativos, informações preenchidas e respostas personalizadas vindas do painel. */
function sanitizeKnowledge (input: any, current: TenantConfig['knowledge']): NonNullable<TenantConfig['knowledge']> {
  const base = current ?? { packs: ['comum'], variables: {}, overrides: {} }
  if (!input || typeof input !== 'object') return base
  const packs = Array.isArray(input.packs)
    ? [...new Set<string>(input.packs.filter((p: unknown) => typeof p === 'string' && KEY_RE.test(p)))].slice(0, 20)
    : base.packs
  const variables: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.variables ?? base.variables)) {
    if (KEY_RE.test(k) && typeof v === 'string' && v.trim()) variables[k] = v.slice(0, 1000)
  }
  const overrides: Record<string, { answer?: string; enabled?: boolean }> = {}
  for (const [k, v] of Object.entries<any>(input.overrides ?? base.overrides)) {
    if (!/^[\w-]{1,40}\/[\w-]{1,40}$/.test(k) || !v || typeof v !== 'object') continue
    const answer = typeof v.answer === 'string' ? v.answer.slice(0, 2000) : ''
    const enabled = v.enabled !== false
    if (answer.trim() || !enabled) overrides[k] = { ...(answer.trim() ? { answer } : {}), ...(!enabled ? { enabled: false } : {}) }
  }
  // Frases ensinadas (tela "Treinar") só mudam pela rota própria: salvar a configuração nunca apaga
  return { packs, variables, overrides, ...(base.extraQuestions ? { extraQuestions: base.extraQuestions } : {}) }
}

/**
 * Tamanhos/adicionais vindos do painel: lista de {name, price} ou texto
 * "Média=49,90; Grande=59,90" (também aceita uma opção por linha).
 */
function sanitizeOptions (input: unknown): ProductOption[] | undefined {
  const raw: { name: unknown; price: unknown }[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[;\n]+/).map(part => {
          const m = /^(.+?)\s*[=:]\s*(?:R\$\s*)?([\d.,]+)\s*$/.exec(part.trim())
          return m ? { name: m[1], price: m[2] } : { name: '', price: 0 }
        })
      : []
  const out = raw.slice(0, 12).map(o => ({
    name: str(o?.name, 40).trim(),
    price: Math.max(0, Math.round(Number(String(o?.price ?? '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * 100) / 100 || 0),
  })).filter(o => o.name)
  return out.length ? out : undefined
}

/** Sinônimos: objeto {de: para} ou texto "coca=refrigerante" (um por linha). */
function sanitizeSynonyms (input: unknown, current: TenantConfig['synonyms']): TenantConfig['synonyms'] {
  if (input === undefined) return current
  const pairs: [string, string][] = typeof input === 'string'
    ? input.split('\n').map(l => l.split('=').map(s => s.trim()) as [string, string]).filter(p => p.length === 2)
    : Object.entries(input && typeof input === 'object' ? input as Record<string, string> : {})
  const out: Record<string, string> = {}
  for (const [from, to] of pairs.slice(0, 100)) {
    if (typeof from === 'string' && typeof to === 'string' && from.trim() && to.trim()) out[from.trim().slice(0, 40)] = to.trim().slice(0, 60)
  }
  return Object.keys(out).length ? out : undefined
}

const MENU_TYPES = new Set<MenuOption['type']>(['text', 'catalog', 'human', 'ai'])

const str = (v: unknown, max: number, fallback = '') =>
  typeof v === 'string' ? v.slice(0, max) : fallback

/**
 * Valida a configuração vinda do painel, mantendo id e senha do registro atual.
 * Campos desconhecidos são descartados.
 */
export function sanitizeTenant (input: any, current: TenantConfig): TenantConfig {
  const b = input?.business ?? {}
  const m = input?.messages ?? {}
  const menu: MenuOption[] = Array.isArray(input?.menu)
    ? input.menu.slice(0, 20).map((o: any): MenuOption => ({
        key: str(o?.key, 10).trim(),
        label: str(o?.label, 80).trim(),
        type: MENU_TYPES.has(o?.type) ? o.type : 'text',
        text: str(o?.text, 2000),
      })).filter((o: MenuOption) => o.key && o.label)
    : current.menu
  const products: Product[] = Array.isArray(input?.products)
    ? input.products.slice(0, 200).map((p: any, i: number): Product => ({
        id: str(p?.id, 40) || `p${Date.now().toString(36)}${i}`,
        name: str(p?.name, 100).trim(),
        price: Math.max(0, Math.round(Number(p?.price) * 100) / 100 || 0),
        description: str(p?.description, 300),
        active: p?.active !== false,
        sizes: sanitizeOptions(p?.sizes),
        extras: sanitizeOptions(p?.extras),
      })).filter((p: Product) => p.name)
    : current.products
  const halfHalf = input?.halfHalf === undefined ? current.halfHalf
    : ['max', 'avg', 'off'].includes(input.halfHalf) ? input.halfHalf as TenantConfig['halfHalf'] : undefined

  return {
    ...current,
    name: str(input?.name, 80).trim() || current.name,
    active: input?.active !== false,
    business: {
      description: str(b.description, 2000, current.business.description),
      hours: str(b.hours, 300, current.business.hours),
      address: str(b.address, 300, current.business.address),
      phone: str(b.phone, 40, current.business.phone),
      extraInfo: str(b.extraInfo, 8000, current.business.extraInfo),
    },
    messages: {
      welcome: str(m.welcome, 1000, current.messages.welcome),
      fallback: str(m.fallback, 1000, current.messages.fallback),
      humanHandoff: str(m.humanHandoff, 1000, current.messages.humanHandoff),
      humanBack: str(m.humanBack, 1000, current.messages.humanBack),
      orderConfirmed: str(m.orderConfirmed, 1000, current.messages.orderConfirmed),
      nonText: str(m.nonText, 1000, current.messages.nonText),
    },
    menu,
    products,
    ai: {
      enabled: Boolean(input?.ai?.enabled),
      instructions: str(input?.ai?.instructions, 4000, current.ai.instructions),
      mode: input?.ai?.mode === 'assist' ? 'assist' : input?.ai?.mode === 'agent' ? 'agent' : current.ai.mode ?? 'agent',
      agentName: str(input?.ai?.agentName, 40, current.ai.agentName ?? ''),
    },
    humanTimeoutMin: Math.min(24 * 60, Math.max(1, Number(input?.humanTimeoutMin) || current.humanTimeoutMin)),
    knowledge: sanitizeKnowledge(input?.knowledge, current.knowledge),
    style: input?.style === 'menu' ? 'menu' : input?.style === 'human' ? 'human' : current.style,
    halfHalf,
    synonyms: sanitizeSynonyms(input?.synonyms, current.synonyms),
  }
}
