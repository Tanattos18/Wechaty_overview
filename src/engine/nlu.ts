/**
 * Entendimento de linguagem simples, sem IA: intenções por palavras-chave,
 * busca de produtos por nome e busca no FAQ do negócio.
 * Todas as funções recebem texto já normalizado (minúsculo, sem acento).
 */
import type { Product, TenantConfig } from '../types.js'

export type Intent =
  | 'thanks' | 'bye' | 'human' | 'order' | 'catalog' | 'price'
  | 'hours' | 'address' | 'phone' | 'delivery' | 'payment'

const GREETING_RE = /^(oi+e*|ola+|opa|eai|e ai|hey|hello|hi|salve|bom dia|boa tarde|boa noite|boa madrugada|tudo bem|tudo bom|td bem|blz|beleza)([\s,!.?]+|$)/

const INTENTS: [Intent, RegExp][] = [
  ['human', /\b(atendente|humano|pessoa de verdade|falar com alguem|gerente|reclamacao|reclamar|problema com (o |meu )?pedido)\b/],
  ['thanks', /\b(obrigad[oa]s?|obg|brigad[oa]|valeu|vlw|agradeco|grat[oa])\b/],
  ['bye', /\b(tchau|ate mais|ate logo|ate amanha|falou|flw|bye|so isso)\b/],
  ['price', /\b(quanto|preco|precos|valor|valores|custa|custam|sai por|ta quanto)\b/],
  ['catalog', /\b(cardapio|catalogo|produtos|sabores|o que (voces |vcs |vc )?(tem|vende|vendem)|quais (as )?opcoes|lista de)\b/],
  ['order', /\b(quero|queria|quer[oi]a?|gostaria de (pedir|comprar)|pedir|fazer (um )?pedido|encomendar|comprar|me (ve|manda|traz|da|de|desce))\b/],
  ['hours', /\b(horario|horarios|que horas|abre|abrem|aberto|aberta|abrir|fecha|fecham|fechado|funciona|funcionam|funcionamento|expediente|feriado)\b/],
  ['address', /\b(endereco|onde (fica|ficam|voces ficam|e)|localizacao|como (eu )?chego|mapa|ponto de referencia)\b/],
  ['delivery', /\b(entrega|entregam|entregar|delivery|frete|taxa|motoboy|demora|tempo de entrega|prazo|retirar|retirada|buscar)\b/],
  ['payment', /\b(pagamento|pagar|pago|pix|cartao|credito|debito|dinheiro|troco|vale refeicao|vr)\b/],
  ['phone', /\b(telefone|fone|numero de contato|contato|ligar)\b/],
]

const STOPWORDS = new Set((
  'a o as os um uma uns umas de da do das dos e ou que qual quais quanto quantos ' +
  'pra para por pelo pela com sem no na nos nas em ao aos eu me mim meu minha voce voces vc vcs ' +
  'seu sua seus suas ele ela isso esse essa este esta aqui ai la ja se mais muito bem so tambem ' +
  'tem tem ter tenho e sao foi ser esta estao como onde quando porque pq ne ok sim nao ' +
  'quero queria gostaria teria teriam saber pode poderia favor por favor oi ola obrigado obrigada tudo bom dia tarde noite'
).split(' '))

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
}

/** Separa a saudação do resto: "oi, que horas abre?" -> { greeting: true, rest: "que horas abre?" } */
export function splitGreeting (n: string): { greeting: boolean; rest: string } {
  let rest = n
  let greeting = false
  for (let m = GREETING_RE.exec(rest); m; m = GREETING_RE.exec(rest)) {
    greeting = true
    rest = rest.slice(m[0].length)
  }
  return { greeting, rest: rest.replace(/^[\s,!.?]+/, '').trim() }
}

export function detectIntents (n: string): Intent[] {
  return INTENTS.filter(([, re]) => re.test(n)).map(([intent]) => intent)
}

const stem = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

/** Palavras relevantes (sem stopwords, no singular simples). */
export function keywords (n: string): string[] {
  return n.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w)).map(stem)
}

function levenshtein (a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Igualdade tolerante a erros de digitação ("calabreza" ~ "calabresa"). */
export function similar (a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) return true
  return a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1
}

function normalizeText (text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export type ProductMatch =
  | { kind: 'one'; product: Product }
  | { kind: 'many'; products: Product[] }
  | { kind: 'none' }

/**
 * Encontra o produto citado no texto. Palavras que aparecem em vários produtos
 * (ex.: "pizza") valem menos que palavras únicas (ex.: "calabresa").
 */
export function findProduct (products: Product[], n: string): ProductMatch {
  const words = keywords(n)
  if (words.length === 0) return { kind: 'none' }
  const names = products.map(p => keywords(normalizeText(p.name)))
  const freq = new Map<string, number>()
  for (const tokens of names) for (const t of new Set(tokens)) freq.set(t, (freq.get(t) ?? 0) + 1)

  const scored = products.map((product, i) => {
    let score = 0
    for (const t of new Set(names[i])) {
      if (words.some(w => similar(w, t))) score += 1 / (freq.get(t) ?? 1)
    }
    return { product, score }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { kind: 'none' }
  const best = scored.filter(s => s.score === scored[0].score)
  return best.length === 1 ? { kind: 'one', product: best[0].product } : { kind: 'many', products: best.map(s => s.product) }
}

/** Quantidade pedida no trecho: "2 calabresa", "duas calabresas", "calabresa x3". Padrão 1. */
export function parseQuantity (n: string): number {
  const digit = /(?:^|\s|x)(\d{1,2})(?:\s|x|$)/.exec(n)
  if (digit) return Math.max(1, Math.min(99, Number(digit[1])))
  for (const w of n.split(/\s+/)) if (NUMBER_WORDS[w]) return NUMBER_WORDS[w]
  return 1
}

/** Separa pedidos com vários itens: "2 calabresa e 1 refri" -> ["2 calabresa", "1 refri"] */
export function splitItems (n: string): string[] {
  return n.split(/\s*(?:,|;|\be\b|\bmais\b|\+)\s*/).map(s => s.trim()).filter(Boolean)
}

const INTENT_HINTS: Partial<Record<Intent, string[]>> = {
  delivery: ['entrega', 'entregamo', 'delivery', 'taxa', 'frete', 'retirada', 'minuto'],
  payment: ['pix', 'cartao', 'credito', 'debito', 'dinheiro', 'pagamento', 'aceitamo'],
  hours: ['horario', 'abrimo', 'funcionamo', 'feriado', 'fechado'],
}

/** Frases do texto do negócio, para responder perguntas sem IA. */
function knowledgeSentences (tenant: TenantConfig): string[] {
  const text = [tenant.business.extraInfo, tenant.business.description].join('\n')
  return text.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3)
}

/**
 * Busca no FAQ/descrição as frases que mais compartilham palavras com a pergunta.
 * Retorna até 2 frases, ou nada se a sobreposição for fraca.
 */
export function searchKnowledge (tenant: TenantConfig, n: string, intents: Intent[] = []): string | undefined {
  // Palavras do próprio ramo (nome da empresa, palavras repetidas nos produtos) não ajudam a achar a resposta
  const generic = new Set(keywords(normalizeText(tenant.name)))
  const productWords = tenant.products.map(p => new Set(keywords(normalizeText(p.name))))
  for (const set of productWords) {
    for (const w of set) if (productWords.filter(s => s.has(w)).length > 1) generic.add(w)
  }
  const words = keywords(n).filter(w => ![...generic].some(g => similar(w, g)))
  for (const i of intents) words.push(...(INTENT_HINTS[i] ?? []))
  if (words.length === 0) return undefined

  const scored = knowledgeSentences(tenant).map(sentence => {
    const tokens = keywords(normalizeText(sentence))
    const score = new Set(words.filter(w => tokens.some(t => similar(w, t)))).size
    return { sentence, score }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)

  if (scored.length === 0) return undefined
  const top = scored[0].score
  return scored.filter(s => s.score === top).slice(0, 2).map(s => s.sentence).join('\n')
}
