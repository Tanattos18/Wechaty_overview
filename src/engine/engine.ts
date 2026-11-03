import type { KbResult } from '../knowledge/kb.js'
import type { Store } from '../store.js'
import type { AiResponder, Channel, Conversation, MenuOption, Product, TenantConfig } from '../types.js'
import {
  detectIntents, findProduct, keywords, parseQuantity, searchKnowledge, similar, splitGreeting, splitItems, type Intent,
} from './nlu.js'
import { periodGreeting, pick, PHRASES, type Random } from './phrases.js'

export interface IncomingMessage {
  tenantId: string
  chatId: string
  name: string
  text: string
  channel: Channel
}

/** Base de perguntas e respostas (SQLite). */
export interface KnowledgeMatcher {
  match (tenant: TenantConfig, text: string): KbResult | undefined
  logUnanswered (tenantId: string, text: string, topic?: string): void
}

export interface EngineDeps {
  store: Store
  ai?: AiResponder
  knowledge?: KnowledgeMatcher
  now?: () => Date
  /** Sorteia as variações de frases (fixo nos testes). */
  random?: Random
  /** Chamado quando um pedido novo é confirmado (ex.: para avisar o painel). */
  onOrder?: (tenantId: string, orderId: string) => void
}

const MENU_WORDS = new Set(['menu', '0', 'inicio', 'voltar', 'opcoes', 'ajuda', 'help'])
const HUMAN_WORDS = new Set(['atendente', 'humano', 'falar com atendente', 'pessoa'])
const YES = new Set([
  'sim', 's', 'ss', 'sim sim', 'confirmar', 'confirmo', 'ok', 'okay', 'isso', 'isso mesmo', 'pode', 'pode ser', 'pode sim',
  'claro', 'certo', 'quero', 'quero sim', 'manda', 'bora', 'pode anotar', 'sim pode', 'sim por favor', 'por favor', 'uhum',
  'aham', 'beleza', 'fechado', 'perfeito', 'com certeza',
])
const NO = new Set(['nao', 'n', 'nn', 'agora nao', 'nao obrigado', 'nao obrigada', 'depois', 'deixa', 'deixa pra la', 'ainda nao', 'nao quero'])
const FINISH_RE = /^(finalizar|fechar|fechar pedido|pode fechar|so isso|e so isso|so isso mesmo|so|pronto|concluir|nada mais|mais nada|nao so isso|e so|acabou)$/
const PICKUP_RE = /\b(retirar|retiro|retirada|buscar|busco|vou buscar|pego ai|pegar ai)\b/
const HOW_ARE_YOU_RE = /tudo (bem|bom|certo|joia)|td bem|como vai|blz|beleza/
const TOTAL_RE = /\b(quanto (deu|ficou|vai dar|vai ficar)|quanto (e|ta|esta|fica) (tudo|o total|meu pedido|o pedido)|quanto (eu )?(devo|vou) pagar|quanto devo|valor total|total do (meu )?pedido|qual (e )?o total|quanto custa tudo|deu quanto|ficou (em )?quanto)\b/
/** Palavras de serviço/informação: "tem X?" com elas não é pergunta de produto. */
const NOT_PRODUCT_RE = /^(estacionamento|vaga|wifi|wi|internet|banheiro|cadeira|mesa|reserva|entrega|delivery|frete|taxa|pix|cartao|credito|debito|dinheiro|troco|desconto|promoc|cupom|parcel|emprego|horario|atendimento|atendente|acessibilidade|rampa|ar|climatiza|espaco|kids|brinquedo|musica|show|tele|telefone|whatsapp|site|instagram|endereco|loja|unidade|filial|nota|fiscal|garantia|troca|devoluc|agenda|horar)/

const ACK_WORDS = new Set(['boa', 'show', 'top', 'massa', 'otimo', 'legal', 'joia', 'combinado', 'fechou', 'tranquilo', 'entendi', 'ta bom', 'ta', 'tabom', 'perfeito', 'beleza', 'blz', 'certo', 'ok', 'okay', 'oks', 'show de bola', 'maravilha'])
const OTHER_OPTIONS_RE = /\b((tem|teria) (outro|outra|outros|outras|mais) (sabor|sabores|opcao|opcoes|tipo|tipos|pizza|pizzas)|(outro|outros|mais) (sabor|sabores|opcoes)|so tem (esse|esses|essa|essas|isso)|tem mais (alguma coisa|opcao|opcoes|sabor|sabores))\b/
const INFO_INTENTS: Intent[] = ['hours', 'address', 'phone', 'delivery', 'payment']
const QUESTION_RE = /\?\s*$|^(qual|quais|como|onde|quando|quanto|o que|que|tem|voces|vcs|e)\b/

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatPrice = (value: number) => brl.format(value)

/** Minúsculas, sem acentos e sem espaços extras: "Olá!" -> "ola!" */
export function normalize (text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

interface Understood {
  replies?: string[]
  /** Resposta informativa: pode ganhar um "Posso ajudar em mais alguma coisa?" */
  informative?: boolean
  missingTopic?: string
}

/**
 * Motor do chatbot: recebe uma mensagem do cliente final e devolve as respostas.
 * Não conhece o WhatsApp — o mesmo motor atende o canal WhatsApp e o simulador do painel.
 */
export class Engine {
  private readonly now: () => Date
  private readonly random: Random

  constructor (private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date())
    this.random = deps.random ?? Math.random
  }

  async handle (msg: IncomingMessage): Promise<string[]> {
    const { store } = this.deps
    const tenant = store.getTenant(msg.tenantId)
    if (!tenant) throw new Error(`Cliente não encontrado: ${msg.tenantId}`)
    if (tenant.suspended) return [] // cliente suspenso: o bot não responde

    const conv = store.getConversation(tenant.id, msg.chatId, msg.name, msg.channel)
    store.appendMessage(conv, 'customer', msg.text, this.now())
    conv.unread++

    const replies = (await this.route(tenant, conv, msg.text.trim())).filter(Boolean)
    for (const reply of replies) store.appendMessage(conv, 'bot', reply, this.now())
    store.saveConversations(tenant.id)
    return replies
  }

  /** Atendente assumiu a conversa pelo painel: o bot fica em silêncio. */
  takeOver (conv: Conversation): void {
    conv.state = 'human'
    conv.humanSince = this.now().toISOString()
    conv.needsAgent = false
  }

  /** Atendente devolveu a conversa ao bot. Retorna a mensagem a enviar ao cliente. */
  release (tenant: TenantConfig, conv: Conversation): string {
    conv.state = 'menu'
    conv.humanSince = undefined
    conv.needsAgent = false
    const next = style(tenant) === 'menu' ? `\n\n${this.menuText(tenant)}` : ` ${this.pick(PHRASES.howCanIHelp)}`
    return fill(tenant.messages.humanBack, tenant, conv, this.now()) + next
  }

  // ------------------------------------------------------------------

  private pick<T> (list: readonly T[]): T {
    return pick(list, this.random)
  }

  private async route (tenant: TenantConfig, conv: Conversation, text: string): Promise<string[]> {
    const n = normalize(text)

    if (conv.state === 'human') {
      const since = conv.humanSince ? new Date(conv.humanSince).getTime() : 0
      const expired = this.now().getTime() - since > tenant.humanTimeoutMin * 60_000
      if (!expired) return [] // um atendente está cuidando dessa conversa
      conv.state = 'menu'
      conv.humanSince = undefined
    }

    if (!text) return [fill(tenant.messages.nonText, tenant, conv, this.now())]
    const bare = n.replace(/[!.?,]+/g, '').trim()

    // Resposta a "Quer que eu anote uma pra você?"
    if (conv.offer) {
      const product = this.activeProducts(tenant).find(p => p.id === conv.offer)
      conv.offer = undefined
      const qty = /^\d{1,2}$/.test(bare) ? Number(bare) : YES.has(bare) ? 1 : 0
      if (product && qty > 0) {
        this.addToCart(conv, product, qty)
        conv.state = 'catalog'
        return [`${this.pick(PHRASES.added)} ${qty}x ${product.name}.\n\n${this.cartText(conv)}`]
      }
      if (product && NO.has(bare)) return [this.pick(PHRASES.offerDecline)]
    }

    if (MENU_WORDS.has(bare)) return [this.showMenu(tenant, conv)]
    if (HUMAN_WORDS.has(bare)) return [this.handoff(tenant, conv)]
    if (bare === 'cancelar') {
      const hadOrder = conv.cart.length > 0 || conv.state.startsWith('checkout')
      conv.cart = []
      conv.checkout = {}
      conv.state = 'menu'
      return [hadOrder ? `${this.pick(PHRASES.cancelled)} ${this.pick(PHRASES.followUp)}` : `Tudo bem! ${this.pick(PHRASES.howCanIHelp)}`]
    }

    // Só pontuação ou emoji ("?", "👍"): responde conforme o momento da conversa
    if (!/[a-z0-9]/.test(bare)) {
      if (/👍|👌|🙏|❤|😊|🙂|😉/u.test(text)) return ['😊 Qualquer coisa, é só chamar!']
      if (conv.state === 'checkout_name') return ['Pra finalizar, me diz o seu nome? 😊']
      if (conv.state === 'checkout_address') return ['Qual o endereço de entrega? Se preferir retirar aqui, é só dizer *retirar*.']
      if (conv.state === 'checkout_confirm') return ['É só me responder *sim* pra confirmar ou *cancelar* se quiser desistir. 😊']
      if (conv.state === 'catalog' && conv.cart.length > 0) return [`Ficou alguma dúvida? 😊\n\n${this.cartText(conv)}`]
      if (conv.state === 'catalog') return [this.orderHelp(tenant)]
      return [`Pode me dizer como posso te ajudar? 😊\n\n${this.capabilities(tenant)}`]
    }

    switch (conv.state) {
      case 'checkout_name': {
        // "sim" confirma o nome do WhatsApp; qualquer outra resposta é o nome a usar
        conv.checkout.name = YES.has(bare) && conv.name
          ? conv.name.slice(0, 80)
          : text.replace(/^(meu nome (e|é)|me chamo|sou o|sou a|e|é|nao,?|não,?)\s+/i, '').slice(0, 80)
        conv.state = 'checkout_address'
        const first = firstName(conv)
        return [`Prazer${first ? `, ${first}` : ''}! 😊 Qual o endereço de entrega? Se preferir retirar aqui, é só dizer *retirar*.`]
      }

      case 'checkout_address':
        conv.checkout.address = PICKUP_RE.test(bare) && bare.split(' ').length <= 4 ? 'Retirada no local' : text.slice(0, 300)
        conv.state = 'checkout_confirm'
        return [`Confere pra mim, por favor:\n\n${this.orderSummary(conv)}\n\nPosso confirmar? (responda *sim* ou *cancelar*)`]

      case 'checkout_confirm':
        if (YES.has(bare)) return [this.confirmOrder(tenant, conv)]
        if (NO.has(bare)) {
          conv.state = 'catalog'
          return [`Sem problemas! O que você quer mudar? Pode adicionar mais itens ou digitar *cancelar* pra desistir.\n\n${this.cartText(conv)}`]
        }
        return ['É só me responder *sim* pra confirmar ou *cancelar* se quiser desistir. 😊']

      case 'catalog': {
        const reply = this.handleCatalog(tenant, conv, bare, n)
        if (reply) return [reply]
        break
      }

      case 'menu': {
        const option = this.matchOption(tenant, bare)
        if (option) return this.runOption(tenant, conv, option)
        break
      }
    }

    return this.converse(tenant, conv, n)
  }

  private aiAvailable (tenant: TenantConfig): boolean {
    return tenant.ai.enabled && Boolean(this.deps.ai)
  }

  /** Texto livre: saudações, perguntas, pedidos por nome, IA e, por último, o fallback. */
  private async converse (tenant: TenantConfig, conv: Conversation, n: string): Promise<string[]> {
    const first = conv.state === 'idle'
    const { greeting, rest } = splitGreeting(n)
    const name = firstName(conv)

    // Só uma saudação ("oi", "bom dia!", "oi, tudo bem?")
    if (!rest) {
      conv.misses = 0
      if (conv.messages.length <= 2) {
        const welcome = this.welcome(tenant, conv)
        if (!HOW_ARE_YOU_RE.test(n)) return [welcome]
        // "boa noite, tudo bem?" no primeiro contato: responde a pergunta junto com as boas-vindas
        return [welcome.includes('😊') ? welcome.replace('😊', '😊 Tudo ótimo por aqui, e com você?') : `${welcome} Tudo ótimo por aqui! 😊`]
      }
      conv.state = 'menu'
      const next = style(tenant) === 'menu' ? `\n\n${this.menuText(tenant)}` : ` ${this.pick(PHRASES.howCanIHelp)}`
      return [greetBack(n, name, this.now()) + next]
    }

    if (first) conv.state = 'menu'
    const hello = greeting || first ? `${greetBack(n, name, this.now())} ` : ''

    const { replies, informative, missingTopic } = await this.understand(tenant, conv, rest, detectIntents(rest))
    if (replies && replies.length > 0) {
      conv.misses = 0
      replies[0] = hello + replies[0]
      if (informative && this.random() < 0.4) replies[replies.length - 1] += `\n\n${this.pick(PHRASES.followUp)}`
      return replies
    }

    // Registra para o cliente (e, no futuro, a IA) completar a base de conhecimento
    this.deps.knowledge?.logUnanswered(tenant.id, rest, missingTopic)
    conv.misses = (conv.misses ?? 0) + 1

    // Pergunta sem resposta cadastrada: diz isso e oferece o atendente
    if (QUESTION_RE.test(rest)) {
      return [`${hello}${this.pick(PHRASES.noInfo)} ${this.pick(PHRASES.offerHuman)}`]
    }

    if (style(tenant) === 'menu') {
      const hint = conv.misses >= 2 ? '\n\nSe preferir, digite *atendente* que chamo uma pessoa da equipe. 🙋' : ''
      return [`${hello}${fill(tenant.messages.fallback, tenant, conv, this.now())}\n\n${this.menuText(tenant)}${hint}`]
    }
    // Não entendeu: na segunda vez seguida, oferece o atendente
    if (conv.misses >= 2) {
      return [`${hello}${this.pick(PHRASES.notUnderstood)} Se preferir, digite *atendente* que eu chamo uma pessoa da equipe pra falar com você. 🙋`]
    }
    return [`${hello}${this.pick(PHRASES.notUnderstood)} ${this.pick(PHRASES.rephrase)}\n\n${this.capabilities(tenant)}`]
  }

  private async understand (tenant: TenantConfig, conv: Conversation, n: string, intents: Intent[]): Promise<Understood> {
    const has = (i: Intent) => intents.includes(i)
    const short = n.split(' ').length <= 6
    const asksInfo = INFO_INTENTS.some(has)
    const isQuestion = QUESTION_RE.test(n)
    const name = firstName(conv)

    if (has('human')) return { replies: [this.handoff(tenant, conv)] }
    if (has('thanks') && short) return { replies: [this.pick(PHRASES.thanks).replace('{nome}', name ? `, ${name}` : '')] }
    if (has('bye') && short) return { replies: [this.pick(PHRASES.bye)] }

    // "quanto deu tudo?", "quanto devo pagar": o total do pedido, não as formas de pagamento
    if (TOTAL_RE.test(n)) return { replies: [this.totalText(tenant, conv)] }
    // "boa", "show", "combinado": confirmação curta
    if (ACK_WORDS.has(n.replace(/[!.?,]+/g, '').trim())) {
      return {
        replies: [conv.cart.length
          ? `${this.pick(['Show! 😊', 'Combinado! 😊', 'Beleza! 😊'])} Quer mais alguma coisa ou posso *finalizar* o pedido?`
          : '😊 Qualquer coisa, é só chamar!'],
      }
    }
    // "tem outro sabor?", "só tem esses?": lista curta do que existe
    if (OTHER_OPTIONS_RE.test(n)) return { replies: [this.optionsSummary(tenant, conv)] }

    // Produtos: pedir pelo nome ("quero 2 calabresa") ou perguntar de um produto específico
    const products = this.activeProducts(tenant)
    const match = findProduct(products, n)
    const wantsToOrder = has('order') && !isQuestion
    const catalogOnScreen = conv.state === 'catalog' || lastBotWasCatalog(conv)
    if (wantsToOrder || (conv.state === 'catalog' && match.kind === 'one' && !isQuestion && !asksInfo)) {
      const reply = this.addItemsByName(tenant, conv, n, catalogOnScreen)
      if (reply) return { replies: [reply] }
    }
    if (match.kind === 'one' && !asksInfo && !wantsToOrder) {
      const p = match.product
      conv.offer = p.id
      return {
        replies: [`A *${p.name}* sai por *${formatPrice(p.price)}* 😋${p.description ? `\n_${p.description}_` : ''}\n\n` +
          'Quer que eu já anote uma pra você?'],
      }
    }

    // Base de conhecimento: a pergunta cadastrada mais parecida
    const kb = this.deps.knowledge?.match(tenant, n)
    if (kb?.status === 'answer') return this.knowledgeReply(tenant, conv, kb)
    const missingTopic = kb?.status === 'missing' ? `${kb.packId}/${kb.topic}` : undefined

    // Ingrediente citado ("quero azeitona", "tem com cebola?"): sugere o produto que leva
    const withIngredient = this.ingredientReply(products, conv, n)
    if (withIngredient) return { replies: [withIngredient] }
    // "tem coxinha?": item que não está no catálogo (só quando a base não reconheceu o assunto)
    if (!kb && match.kind === 'none') {
      const notSold = this.notInCatalog(tenant, conv, n)
      if (notSold) return { replies: [notSold] }
    }

    if (wantsToOrder || has('catalog') || (has('price') && !asksInfo) || (has('order') && isQuestion && !asksInfo)) {
      conv.state = 'catalog'
      // O catálogo acabou de ser enviado: em vez de repetir a lista, explica como pedir
      if (wantsToOrder && lastBotWasCatalog(conv)) return { replies: [this.orderHelp(tenant)] }
      return { replies: [this.pick(PHRASES.catalogIntro), this.catalogText(tenant, conv)] }
    }

    // Perguntas abertas: a IA responde quando está configurada
    if (this.aiAvailable(tenant)) {
      try {
        const result = await this.deps.ai!(tenant, conv)
        if (result.handoff) return { replies: [result.text, this.handoff(tenant, conv)].filter(Boolean) }
        if (result.text) return { replies: [result.text] }
      } catch (err) {
        console.error(`[ai] ${tenant.id}:`, err instanceof Error ? err.message : err)
      }
    }

    // Sem IA: responde com os dados cadastrados do negócio
    const info = this.infoAnswer(tenant, n, intents)
    if (info) return { replies: [info], informative: true }
    return { missingTopic }
  }

  private knowledgeReply (tenant: TenantConfig, conv: Conversation, kb: Extract<KbResult, { status: 'answer' }>): Understood {
    if (kb.action === 'catalog') {
      conv.state = 'catalog'
      return { replies: [kb.answer || this.pick(PHRASES.catalogIntro), this.catalogText(tenant, conv)] }
    }
    if (kb.action === 'human') return { replies: [kb.answer, this.handoff(tenant, conv)].filter(Boolean) }
    return { replies: [kb.answer], informative: true }
  }

  /** Responde horário, endereço, telefone, entrega, pagamento e o FAQ, sem IA. */
  private infoAnswer (tenant: TenantConfig, n: string, intents: Intent[]): string | undefined {
    const b = tenant.business
    const parts: string[] = []
    if (intents.includes('hours') && b.hours) parts.push(`🕘 Nosso horário: *${b.hours}*`)
    if (intents.includes('address') && b.address) parts.push(`📍 Estamos em: *${b.address}*`)
    if (intents.includes('phone') && b.phone) parts.push(`📞 Nosso telefone: *${b.phone}*`)

    const needsKnowledge = parts.length === 0 || intents.includes('delivery') || intents.includes('payment') || /feriado/.test(n)
    const known = needsKnowledge ? searchKnowledge(tenant, n, intents) : undefined
    if (known) parts.push(known)
    return parts.length ? parts.join('\n') : undefined
  }

  // ---------- boas-vindas e menu ----------

  private welcome (tenant: TenantConfig, conv: Conversation): string {
    conv.state = 'menu'
    const text = fill(tenant.messages.welcome, tenant, conv, this.now())
    return style(tenant) === 'menu' ? `${text}\n\n${this.menuText(tenant)}` : text
  }

  /** O cliente pediu o menu ("menu", "ajuda", "opções"). */
  private showMenu (tenant: TenantConfig, conv: Conversation): string {
    conv.state = 'menu'
    return `Claro! Por aqui eu consigo te ajudar com:\n\n${this.menuText(tenant)}\n\nÉ só me mandar o número ou escrever o que precisa. 😉`
  }

  private menuText (tenant: TenantConfig): string {
    return tenant.menu.map(o => `*${o.key}* - ${o.label}`).join('\n')
  }

  /** O menu em forma de frase: "Posso te ajudar com pedidos, horário... ou chamar alguém da equipe." */
  private capabilities (tenant: TenantConfig): string {
    const labels = tenant.menu.map(o => o.label.charAt(0).toLowerCase() + o.label.slice(1))
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ou ${labels.at(-1)}` : labels[0] ?? ''
    return list ? `Por aqui eu consigo te ajudar a ${list}. 😉` : ''
  }

  private matchOption (tenant: TenantConfig, n: string): MenuOption | undefined {
    return tenant.menu.find(o => normalize(o.key) === n) ??
      tenant.menu.find(o => normalize(o.label) === n)
  }

  private runOption (tenant: TenantConfig, conv: Conversation, option: MenuOption): string[] {
    switch (option.type) {
      case 'catalog':
        conv.state = 'catalog'
        return [this.catalogText(tenant, conv)]
      case 'human':
        return [this.handoff(tenant, conv)]
      case 'ai':
        return ['Pode perguntar! Me conta sua dúvida que eu te ajudo. 😉']
      case 'text':
      default:
        return [fill(option.text ?? '', tenant, conv, this.now())]
    }
  }

  private handoff (tenant: TenantConfig, conv: Conversation): string {
    conv.state = 'human'
    conv.humanSince = this.now().toISOString()
    conv.needsAgent = true
    conv.offer = undefined
    return fill(tenant.messages.humanHandoff, tenant, conv, this.now())
  }

  // ---------- catálogo e carrinho ----------

  private activeProducts (tenant: TenantConfig): Product[] {
    return tenant.products.filter(p => p.active)
  }

  private catalogText (tenant: TenantConfig, conv: Conversation): string {
    const products = this.activeProducts(tenant)
    if (products.length === 0) {
      conv.state = 'menu'
      return 'Nosso catálogo ainda não está disponível por aqui. Se quiser, digite *atendente* que alguém da equipe te passa as opções.'
    }
    const lines = products.map((p, i) =>
      `*${i + 1}* - ${p.name} — ${formatPrice(p.price)}${p.description ? `\n      _${p.description}_` : ''}`)
    return [
      '🛍️ *Catálogo*',
      '',
      ...lines,
      '',
      `Pra pedir, me diga o *número* ou o *nome*. Ex.: *1 e ${Math.min(products.length, 4)}* ou *2 ${shortName(products[0], products)}*` +
        (products.length > 1 ? ` e *1 ${shortName(products.at(-1)!, products)}*.` : '.'),
    ].join('\n')
  }

  /** Retorna a resposta, ou undefined se a mensagem não é um comando do catálogo. */
  private handleCatalog (tenant: TenantConfig, conv: Conversation, n: string, raw = n): string | undefined {
    if (/^(carrinho|meu pedido|pedido|ver carrinho|ver pedido)$/.test(n)) return this.cartText(conv)
    if (n === 'catalogo' || n === 'cardapio') return this.catalogText(tenant, conv)
    if (FINISH_RE.test(n) || (NO.has(n) && conv.cart.length > 0)) {
      if (conv.cart.length === 0) return 'Seu pedido ainda está vazio. Me diga o que você quer que eu anoto! 😊'
      conv.state = 'checkout_name'
      // Já sabemos o nome pelo WhatsApp: só confirma, em vez de perguntar de novo
      const known = firstName({ ...conv, checkout: {} })
      return known
        ? `Ótimo! Posso colocar o pedido no nome de *${known}*? Responda *sim* ou me diga o nome certo. 😊`
        : this.pick(PHRASES.askName)
    }
    // Com o catálogo na tela, números se referem aos itens da lista: "1 e 4", "quero a 2", "duas da 3".
    // Nomes de produto seguem pelo fluxo normal, que separa pedido de pergunta ("a calabresa é apimentada?").
    // (usa o texto com vírgulas: "1, 2 e 3")
    const chunks = orderChunks(raw)
    const onlyNumbers = chunks.length > 0 && chunks.every(c => numberedItem(c))
    const eachOne = new RegExp(`\\b(${QTY_WORD})\\s+de\\s+cada\\b`).test(n) && !QUESTION_RE.test(raw)
    return onlyNumbers || eachOne ? this.addItemsByName(tenant, conv, raw, true) : undefined
  }

  /** Total do pedido em andamento (ou do último pedido confirmado nesta conversa). */
  private totalText (tenant: TenantConfig, conv: Conversation): string {
    if (conv.cart.length) return `Seu pedido até agora deu *${formatPrice(cartTotal(conv))}* 😊\n\n${this.cartText(conv)}`
    const last = this.deps.store.listOrders(tenant.id).find(o => o.chatId === conv.chatId && o.status !== 'cancelado')
    if (last) return `Seu último pedido (*#${last.number}*) deu *${formatPrice(last.total)}*. Quer pedir mais alguma coisa? 😊`
    return 'Seu pedido ainda está vazio. Me diga o que você quer que eu anoto! 😊'
  }

  /** Lista curta e numerada do que existe ("tem outro sabor?"). */
  private optionsSummary (tenant: TenantConfig, conv: Conversation): string {
    const products = this.activeProducts(tenant)
    if (!products.length) return this.catalogText(tenant, conv)
    conv.state = 'catalog'
    const list = products.map((p, i) => `*${i + 1}* - ${p.name} — ${formatPrice(p.price)}`).join('\n')
    return `No momento temos estas opções:\n\n${list}\n\nQuer pedir alguma? É só mandar o número ou o nome. 😊`
  }

  /** Procura o ingrediente na descrição dos produtos: "quero azeitona" → a Calabresa leva azeitona. */
  private ingredientReply (products: Product[], conv: Conversation, n: string): string | undefined {
    const nameWords = new Set(products.flatMap(p => keywords(normalize(p.name))))
    const words = keywords(n).filter(w => w.length >= 4 && ![...nameWords].some(nw => similar(w, nw)))
    if (!words.length) return undefined
    const found = products.filter(p => p.description && keywords(normalize(p.description)).some(d => words.some(w => similar(w, d))))
    if (!found.length || found.length === products.length) return undefined
    const ingredient = words.find(w => found.some(p => keywords(normalize(p.description!)).some(d => similar(w, d))))!
    if (found.length === 1) {
      const p = found[0]
      conv.offer = p.id
      return `A *${p.name}* vem com ${ingredient} 😋 _(${p.description})_ — sai por *${formatPrice(p.price)}*.\n\nQuer que eu anote uma pra você?`
    }
    conv.state = 'catalog'
    return `Temos ${ingredient} nestas opções:\n\n${found.map(p => `*${products.indexOf(p) + 1}* - ${p.name} — ${formatPrice(p.price)}\n      _${p.description}_`).join('\n')}\n\nQual você quer?`
  }

  /** "tem coxinha?" → avisa que não está no cardápio e mostra o que existe. */
  private notInCatalog (tenant: TenantConfig, conv: Conversation, n: string): string | undefined {
    const products = this.activeProducts(tenant)
    if (!products.length) return undefined
    const m = /^(?:e\s+)?(?:voces |vcs |vc |voce )?(?:tem|teria|vende|vendem|faz|fazem|trabalha com|trabalham com)\s+(.{2,40}?)[?!.]*$/.exec(n)
    if (!m) return undefined
    const item = m[1].replace(/^(a|o|as|os|um|uma|algum|alguma)\s+/, '').trim()
    const words = keywords(item)
    // Só para coisas com cara de produto: serviço e informação ("tem estacionamento?") não são itens do cardápio
    if (!words.length || words.length > 4 || words.some(w => NOT_PRODUCT_RE.test(w)) || INFO_INTENTS.some(i => detectIntents(n).includes(i))) {
      return undefined
    }
    conv.state = 'catalog'
    const names = products.map((p, i) => `*${i + 1}* - ${p.name}`).join('\n')
    return `Não encontrei *${item}* no nosso cardápio 😕 Por aqui temos:\n\n${names}\n\nQuer pedir alguma dessas? Se for outra coisa, digite *atendente* que alguém da equipe te ajuda.`
  }

  /** Ajuda curta quando o cliente quer pedir mas não deu para entender os itens. */
  private orderHelp (tenant: TenantConfig): string {
    const products = this.activeProducts(tenant)
    const a = products[0] ? shortName(products[0], products) : 'calabresa'
    const b = products.at(-1) && products.length > 1 ? shortName(products.at(-1)!, products) : a
    return 'Não consegui identificar os itens 😅 Me diga o *número* ou o *nome* do que você quer, por exemplo: ' +
      `*1 e ${Math.min(products.length, 4) || 2}* ou *2 ${a} e 1 ${b}*.`
  }

  private addToCart (conv: Conversation, product: Product, qty: number): void {
    const item = conv.cart.find(i => i.productId === product.id)
    if (item) item.qty += qty
    else conv.cart.push({ productId: product.id, name: product.name, price: product.price, qty })
  }

  /**
   * Pedido escrito: "quero 2 calabresa e 1 refrigerante", "uma de cada" e,
   * com o catálogo na tela (byNumber), pelos números da lista: "1 e 4", "quero a 2", "duas da 3", "1x2".
   * Retorna undefined quando nenhum produto foi reconhecido.
   */
  private addItemsByName (tenant: TenantConfig, conv: Conversation, n: string, byNumber = false): string | undefined {
    const products = this.activeProducts(tenant)
    const added: string[] = []
    const ambiguous: Product[][] = []
    const invalid: string[] = []
    let last: Product | undefined

    // "uma de cada" / "duas de cada": todos os itens do grupo principal (ex.: as pizzas)
    const each = new RegExp(`\\b(${QTY_WORD})\\s+de\\s+cada\\b`).exec(n)
    if (each && products.length > 0) {
      const qty = parseQuantity(each[1])
      for (const p of mainGroup(products)) {
        this.addToCart(conv, p, qty)
        added.push(`${qty}x ${p.name}`)
      }
      conv.state = 'catalog'
      return `${this.pick(PHRASES.added)} ${added.join(', ')}.\n\n${this.cartText(conv)}`
    }

    for (const chunk of byNumber ? orderChunks(n) : splitItems(n)) {
      const numbered = byNumber ? numberedItem(chunk) : undefined
      if (numbered) {
        const product = products[numbered.index - 1]
        if (!product) { invalid.push(String(numbered.index)); continue }
        this.addToCart(conv, product, numbered.qty)
        added.push(`${numbered.qty}x ${product.name}`)
        last = product
        continue
      }
      const match = findProduct(products, chunk)
      if (match.kind === 'many') { ambiguous.push(match.products); continue }
      if (match.kind !== 'one') continue
      const explicitQty = /\d|\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.test(chunk)
      // "frango e catupiry" é um produto só: não adiciona de novo o mesmo item sem quantidade
      if (match.product === last && !explicitQty) continue
      const qty = parseQuantity(chunk)
      this.addToCart(conv, match.product, qty)
      added.push(`${qty}x ${match.product.name}`)
      last = match.product
    }

    const notFound = invalid.length
      ? `Não achei o item *${invalid.join('*, *')}* na lista (vai de 1 a ${products.length}).`
      : ''
    if (added.length > 0) {
      conv.state = 'catalog'
      const doubt = ambiguous.length ? `\n\nSó não entendi qual destes você quer: ${this.listOptions(ambiguous[0], products)}` : ''
      return `${this.pick(PHRASES.added)} ${added.join(', ')}.${notFound ? `\n${notFound}` : ''}${doubt}\n\n${this.cartText(conv)}`
    }
    if (notFound) return `Hmm, ${notFound.charAt(0).toLowerCase()}${notFound.slice(1)} Pode conferir o número? 😊`
    if (ambiguous.length > 0) {
      conv.state = 'catalog'
      return `Temos algumas opções: ${this.listOptions(ambiguous[0], products)}\n\nQual delas você prefere?`
    }
    return undefined
  }

  private listOptions (options: Product[], all: Product[]): string {
    return '\n' + options.map(p => `*${all.indexOf(p) + 1}* - ${p.name} — ${formatPrice(p.price)}`).join('\n')
  }

  private cartText (conv: Conversation): string {
    if (conv.cart.length === 0) return 'Seu pedido ainda está vazio.'
    const lines = conv.cart.map(i => `• ${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`)
    return ['🛒 *Seu pedido até agora:*', ...lines, `*Total: ${formatPrice(cartTotal(conv))}*`, '',
      this.pick(PHRASES.cartFooter)].join('\n')
  }

  private orderSummary (conv: Conversation): string {
    const lines = conv.cart.map(i => `• ${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`)
    return ['📝 *Resumo do pedido*', ...lines, `*Total: ${formatPrice(cartTotal(conv))}*`, '',
      `Nome: ${conv.checkout.name}`, `Entrega: ${conv.checkout.address}`].join('\n')
  }

  private confirmOrder (tenant: TenantConfig, conv: Conversation): string {
    const at = this.now().toISOString()
    const order = this.deps.store.addOrder(tenant.id, {
      chatId: conv.chatId,
      channel: conv.channel,
      customerName: conv.checkout.name ?? conv.name,
      address: conv.checkout.address ?? '',
      items: conv.cart,
      total: cartTotal(conv),
      status: 'novo',
      createdAt: at,
      updatedAt: at,
    })
    const reply = fill(tenant.messages.orderConfirmed, tenant, conv, this.now()).replaceAll('{pedido}', `#${order.number}`)
    conv.cart = []
    conv.checkout = {}
    conv.state = 'menu'
    this.deps.onOrder?.(tenant.id, order.id)
    return reply
  }
}

const QTY_WORD = '\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez'
const ORDER_FILLER_RE = /\b(quero|queria|vou querer|gostaria de|gostaria|me ve|me manda|manda|pode ser|me traz|traz|coloca|adiciona|anota|tambem|numero|num|item|opcao|por favor|pfv|pf|isso)\b/g
const ARTICLE_RE = /(^|\s)(a|o|as|os|n|no|nº)(?=\s|$)/g

/**
 * Item pelo número do catálogo: "1", "quero a 4", "2x3" (item 2, 3 unidades), "duas da 1".
 * Retorna undefined se o trecho tiver outras palavras (aí é tratado como nome de produto).
 */
function numberedItem (chunk: string): { index: number; qty: number } | undefined {
  const c = chunk.replace(ORDER_FILLER_RE, ' ').replace(ARTICLE_RE, ' ').replace(/\s+/g, ' ').trim()
  let m = /^(\d{1,2})\s*[x*]\s*(\d{1,2})$/.exec(c)
  if (m) return { index: Number(m[1]), qty: clampQty(Number(m[2])) }
  m = new RegExp(`^(${QTY_WORD})\\s*(?:x\\s*)?(?:da|do|de)\\s+(\\d{1,2})$`).exec(c)
  if (m) return { index: Number(m[2]), qty: clampQty(parseQuantity(m[1])) }
  m = /^(\d{1,2})$/.exec(c)
  if (m) return { index: Number(m[1]), qty: 1 }
  return undefined
}

const clampQty = (q: number) => Math.max(1, Math.min(99, q || 1))

/** Separa os itens e também números soltos por espaço: "1 2 e 4" -> ["1", "2", "4"]. */
function orderChunks (n: string): string[] {
  return splitItems(n.replace(/[!.?]+$/, '')).flatMap(c => {
    const nums = c.replace(ORDER_FILLER_RE, ' ').replace(ARTICLE_RE, ' ').trim()
    return /^(\d{1,2}\s+)+\d{1,2}$/.test(nums) ? nums.split(/\s+/) : [c]
  })
}

/** Produtos do grupo principal (a primeira palavra mais comum, ex.: "Pizza ..."); sem grupo, todos. */
function mainGroup (products: Product[]): Product[] {
  const count = new Map<string, number>()
  for (const p of products) {
    const w = normalize(p.name).split(' ')[0]
    count.set(w, (count.get(w) ?? 0) + 1)
  }
  const [word, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  return n >= 2 ? products.filter(p => normalize(p.name).split(' ')[0] === word) : products
}

/** A última mensagem do bot foi o catálogo? (evita mandar a lista de novo) */
function lastBotWasCatalog (conv: Conversation): boolean {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m.from === 'bot') return m.text.startsWith('🛍️')
  }
  return false
}

function style (tenant: TenantConfig): 'human' | 'menu' {
  return tenant.style ?? 'human'
}

function cartTotal (conv: Conversation): number {
  return Math.round(conv.cart.reduce((sum, i) => sum + i.qty * i.price, 0) * 100) / 100
}

function firstName (conv: Conversation): string {
  return (conv.checkout.name ?? conv.name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** Nome curto para exemplos: "Pizza Quatro Queijos" -> "quatro queijos" (sem as palavras comuns a outros produtos). */
function shortName (product: Product, all: Product[]): string {
  const others = all.filter(p => p !== product).map(p => p.name.toLowerCase().split(/\s+/))
  const words = product.name.toLowerCase().split(/\s+/).filter(w => !others.some(o => o.includes(w)))
  return words.join(' ') || product.name.toLowerCase()
}

/**
 * Responde a saudação no mesmo tom: "boa noite, tudo bem?" -> "Boa noite, Joana! Tudo ótimo por aqui 😊".
 * Sem período na mensagem, usa o horário atual ("oi" às 20h -> "Boa noite").
 */
function greetBack (n: string, name: string, now: Date): string {
  const period = /boa noite/.test(n) ? 'Boa noite' : /boa tarde/.test(n) ? 'Boa tarde' : /bom dia/.test(n) ? 'Bom dia'
    : /^(oi|opa|eai|e ai|hey|salve)\b/.test(n) ? 'Oi' : periodGreeting(now)
  const howAreYou = HOW_ARE_YOU_RE.test(n) ? ' Tudo ótimo por aqui, e com você?' : ''
  return `${period}${name ? `, ${name}` : ''}! 😊${howAreYou}`
}

/** Substitui {nome}, {empresa} e {saudacao} nos textos configurados pelo cliente. */
function fill (template: string, tenant: TenantConfig, conv: Conversation, now: Date): string {
  const name = firstName(conv)
  const withName = name ? template.replaceAll('{nome}', name) : template.replace(/,?\s*\{nome\}/g, '')
  return withName.replaceAll('{empresa}', tenant.name).replaceAll('{saudacao}', periodGreeting(now)).trim()
}
