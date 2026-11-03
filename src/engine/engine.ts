import type { KbResult } from '../knowledge/kb.js'
import type { Store } from '../store.js'
import { AGENT_TOOLS, agentHistory, agentPrompt, type AgentRunner } from './agent.js'
import type { AiResponder, Channel, Conversation, MenuOption, Product, ProductOption, TenantConfig } from '../types.js'
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
  /** Assuntos "quase lá", para perguntar "Você quis dizer…?" */
  candidates? (tenant: TenantConfig, text: string): { key: string; title: string; score: number }[]
  /** Resposta de um assunto pela chave "pacote/assunto". */
  answerFor? (tenant: TenantConfig, key: string): KbResult | undefined
  /** Todas as respostas preenchidas do cliente (contexto da IA funcionária). */
  faq? (tenant: TenantConfig): { title: string; answer: string }[]
}

export interface EngineDeps {
  store: Store
  ai?: AiResponder
  /** IA funcionária: atende tudo e usa ferramentas para o pedido. Sem ela (ou se falhar), valem as regras. */
  agent?: AgentRunner
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
const FINISH_RE = /^(finalizar|fechar|fechar pedido|pode fechar|pode finalizar|so isso|e so isso|so isso mesmo|isso|e isso|isso ai|isso mesmo|so|pronto|concluir|nada mais|mais nada|nao so isso|e so|acabou)$/
const PICKUP_RE = /\b(retirar|retiro|retirada|buscar|busco|vou buscar|pego ai|pegar ai)\b/
const HOW_ARE_YOU_RE = /tudo (bem|bom|certo|joia)|td bem|como vai|blz|beleza/
const TOTAL_RE = /\b(quanto (deu|ficou|vai dar|vai ficar)|quanto (e|ta|esta|fica) (tudo|o total|meu pedido|o pedido)|quanto (eu )?(devo|vou) pagar|quanto devo|valor total|total do (meu )?pedido|qual (e )?o total|quanto custa tudo|deu quanto|ficou (em )?quanto)\b/
/** Palavras de serviço/informação: "tem X?" com elas não é pergunta de produto. */
const NOT_PRODUCT_RE = /^(estacionamento|vaga|wifi|wi|internet|banheiro|cadeira|mesa|reserva|entrega|delivery|frete|taxa|pix|cartao|credito|debito|dinheiro|troco|desconto|promoc|cupom|parcel|emprego|horario|atendimento|atendente|acessibilidade|rampa|ar|climatiza|espaco|kids|brinquedo|musica|show|tele|telefone|whatsapp|site|instagram|endereco|loja|unidade|filial|nota|fiscal|garantia|troca|devoluc|agenda|horar)/

const ACK_WORDS = new Set(['boa', 'show', 'top', 'massa', 'otimo', 'legal', 'joia', 'combinado', 'fechou', 'tranquilo', 'entendi', 'ta bom', 'ta', 'tabom', 'perfeito', 'beleza', 'blz', 'certo', 'ok', 'okay', 'oks', 'show de bola', 'maravilha'])
const OTHER_OPTIONS_RE = /\b((tem|teria) (outro|outra|outros|outras|mais) (sabor|sabores|opcao|opcoes|tipo|tipos|pizza|pizzas)|(tem|teria) (outros|outras)\b|(outro|outros|mais) (sabor|sabores|opcoes)|so tem (esse|esses|essa|essas|isso)|tem mais (alguma coisa|opcao|opcoes|sabor|sabores))\b/
/** "já pedi", "olha aí", "já falei" — o cliente acha que o bot ignorou o pedido. */
const ALREADY_ORDERED_RE = /\b(ja pedi|eu ja pedi|ja falei|ja escolhi|ja mandei|olha ai|ja disse|eu pedi ja)\b/
/** Referência ao último produto citado: "ela", "essa", "esse aí". */
const REF_RE = /\b(ela|ele|essa|esse|dessa|desse|nessa|nesse|dela|dele|essa ai|esse ai|mesma|mesmo)\b/
/** Pedido do item citado: "quero essa", "manda ela", "pode ser essa", "quero ela tbm". */
const REF_ORDER_RE = /\b(quero|queria|vou querer|manda|pode ser|me ve|anota|coloca|adiciona)\s+(a |o )?(essa|esse|ela|ele|essa ai|esse ai|dessa|desse|promocao|promo|combo)\b/
/** "mais uma", "mais 2", "outra dessa". */
const MORE_RE = /\b(?:mais|\+)\s*(\d{1,2}|uma|um|duas|dois|tres)\b(?!\s+(?:de|do|da)\b)|\b(?:outra|outro) (?:dessa|desse|igual)\b/
/** "só tem essa?", "mais alguma promoção?" — depois de mostrar a promoção. */
const ONLY_THIS_RE = /\b(so|somente|apenas) (tem )?(essa|esse|essas|esses|ela|uma|isso)\b|\b(mais|outra|outras) (alguma )?promoc/
/** Parece endereço: número ou palavra de logradouro. */
const ADDRESS_RE = /\d|\b(rua|r|av|avenida|travessa|tv|alameda|estrada|rodovia|praca|quadra|qd|lote|lt|bairro|condominio|cond|apto|apartamento|ap|casa|bloco|km|setor|vila|jardim|centro|perto|proximo|esquina|residencial|loteamento|chacara|sitio|fazenda)\b/
/** Pergunta mesmo sem "?" nem palavra interrogativa no começo. */
const QUESTION_CUE_RE = /\b(perguntei|pergunta|pergunto|sera que|se ja|se tem|se vem|incluso|inclusa|incluido|inclui|vem com|acompanha|serve quantas|quantas pessoas|quantos pedacos|quantas fatias)\b/
/** Item do cardápio pelo número numa pergunta: "a 1 tem…", "o numero 2 vem com…". */
const NUMBER_REF_RE = /(?:^|\b(?:a|o|na|no|da|do|numero|num|n|item|opcao)\s+)(\d{1,2})\b(?!\s*(?:x|reais|real|pessoas|fatias|pedacos|min|minutos|horas|h)\b)/
const PROMO_RE = /\b(promocao|promocoes|promo|combo|oferta)\b/
const HALF_RE = /\b(meio a meio|metade|meia|meio)\b/
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

    conv.lastKind = 'other'
    const replies = (await this.route(tenant, conv, msg.text.trim())).filter(Boolean)
    replies.forEach((reply, i) => {
      store.appendMessage(conv, 'bot', reply, this.now())
      // O tipo da resposta vai na primeira mensagem (alimenta o painel de qualidade)
      if (i === 0) conv.messages[conv.messages.length - 1].kind = conv.lastKind
    })
    store.saveConversations(tenant.id)
    return replies
  }

  /** Ensina ao cliente uma forma de perguntar (escolha no "Você quis dizer…?" ou tela Treinar). */
  learn (tenant: TenantConfig, key: string, text: string): void {
    const phrase = text.trim().slice(0, 300)
    if (phrase.length < 3) return
    const current = this.deps.store.getTenant(tenant.id) ?? tenant
    const knowledge = current.knowledge ?? { packs: ['comum'], variables: {}, overrides: {} }
    const extra = { ...(knowledge.extraQuestions ?? {}) }
    const list = extra[key] ?? []
    if (!list.some(q => normalize(q) === normalize(phrase))) extra[key] = [...list, phrase].slice(-100)
    this.deps.store.saveTenant({ ...current, knowledge: { ...knowledge, extraQuestions: extra } })
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
    // Sinônimos do cliente: "coca" -> "refrigerante", "4 queijos" -> "quatro queijos"
    const n = applySynonyms(tenant, normalize(text))

    if (conv.state === 'human') {
      const since = conv.humanSince ? new Date(conv.humanSince).getTime() : 0
      const expired = this.now().getTime() - since > tenant.humanTimeoutMin * 60_000
      if (!expired) return [] // um atendente está cuidando dessa conversa
      conv.state = 'menu'
      conv.humanSince = undefined
    }

    if (!text) return [fill(tenant.messages.nonText, tenant, conv, this.now())]

    // IA funcionária: atende a conversa toda; se estiver desligada ou falhar, seguem as regras abaixo
    const byAgent = await this.agentTurn(tenant, conv)
    if (byAgent) return byAgent

    const bare = n.replace(/[!.?,]+/g, '').trim()

    // Resposta a "Quer que eu anote uma pra você?"
    if (conv.offer) {
      const product = this.activeProducts(tenant).find(p => p.id === conv.offer)
      conv.offer = undefined
      const qty = /^\d{1,2}$/.test(bare) ? Number(bare) : YES.has(bare) ? 1 : 0
      if (product && qty > 0) {
        conv.state = 'catalog'
        const label = this.addProduct(conv, product, qty, n)
        return [label ? this.addedText(conv, [label]) : this.sizeQuestion(tenant, conv)]
      }
      if (product && NO.has(bare)) return [this.pick(PHRASES.offerDecline)]
    }

    // Resposta ao "Você quis dizer…?": responde o assunto escolhido e aprende a frase original
    if (conv.choice) {
      const choice = conv.choice
      conv.choice = undefined
      const index = /^\d$/.test(bare) ? Number(bare) - 1 : choice.options.findIndex(o => normalize(o.title) === bare)
      const option = choice.options[index]
      if (option && this.deps.knowledge?.answerFor) {
        this.learn(tenant, option.key, choice.text)
        const kb = this.deps.knowledge.answerFor(tenant, option.key)
        if (kb?.status === 'answer') return this.knowledgeReply(tenant, conv, kb).replies ?? []
        conv.lastKind = 'fallback'
        return [`${this.pick(PHRASES.noInfo)} ${this.pick(PHRASES.offerHuman)}`]
      }
      if (NO.has(bare) || /^(nenhum|nenhuma|outra coisa|nada disso)$/.test(bare)) {
        conv.lastKind = 'fallback'
        return ['Tudo bem! Pode me explicar de outro jeito? Se preferir, digite *atendente* que alguém da equipe te ajuda. 😊']
      }
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

    // Esperando o tamanho ("Qual tamanho da Calabresa?"): aceita o número ou o nome do tamanho
    if (conv.pendingSize?.length) {
      const reply = this.resolvePendingSize(tenant, conv, bare)
      if (reply) return [reply]
    }

    // Só pontuação ou emoji ("?", "👍"): responde conforme o momento da conversa
    if (!/[a-z0-9]/.test(bare)) {
      if (/👍|👌|🙏|❤|😊|🙂|😉/u.test(text)) return ['😊 Qualquer coisa, é só chamar!']
      if (conv.state === 'checkout_name') return ['Pra finalizar, me diz o seu nome? 😊']
      if (conv.state === 'checkout_address') return ['Qual o endereço de entrega? Se preferir retirar aqui, é só dizer *retirar*.']
      if (conv.state === 'checkout_payment') return [this.nextCheckoutStep(tenant, conv)]
      if (conv.state === 'checkout_confirm') return ['É só me responder *sim* pra confirmar ou *cancelar* se quiser desistir. 😊']
      if (conv.state === 'catalog' && conv.cart.length > 0) return [`Ficou alguma dúvida? 😊\n\n${this.cartText(conv)}`]
      if (conv.state === 'catalog') return [this.orderHelp(tenant)]
      return [`Pode me dizer como posso te ajudar? 😊\n\n${this.capabilities(tenant)}`]
    }

    switch (conv.state) {
      case 'checkout_name': {
        // "sim" / "sim, pode ser" confirma o nome do WhatsApp; "não" pergunta o nome; o resto é o nome a usar
        const confirms = YES.has(bare) || (/^(sim|pode|isso|ok|claro|certo|correto|ta certo|esta certo|beleza|perfeito)\b/.test(bare) &&
          !/\bnao\b/.test(bare) && bare.split(' ').length <= 5)
        if (NO.has(bare)) return ['Tudo bem! Qual nome eu coloco no pedido? 😊']
        // Mandou o endereço direto ("rua das flores 120"): fica o nome do WhatsApp e segue
        if (/\d/.test(bare) && ADDRESS_RE.test(bare) && conv.name) {
          conv.checkout.name = conv.name.slice(0, 80)
          conv.checkout.address = text.slice(0, 300)
          return [this.nextCheckoutStep(tenant, conv, 'Anotado! ')]
        }
        conv.checkout.name = confirms && conv.name
          ? conv.name.slice(0, 80)
          : text.replace(/^(meu nome (e|é)|me chamo|sou o|sou a|e|é|nao,?|não,?)\s+/i, '').slice(0, 80)
        const first = firstName(conv)
        return [this.nextCheckoutStep(tenant, conv, `Prazer${first ? `, ${first}` : ''}! 😊 `)]
      }

      case 'checkout_address':
        // Corrigindo o nome ("não é esse nome", "meu nome é Ana")
        if (/\bnome\b/.test(bare)) {
          const name = /\b(?:meu nome (?:e|é)|me chamo|nome (?:e|é))\s+(.+)$/i.exec(text)?.[1]?.trim()
          if (!name) {
            conv.state = 'checkout_name'
            return ['Desculpa a confusão! 😅 Qual nome eu coloco no pedido?']
          }
          conv.checkout.name = name.slice(0, 80)
          return [`Anotado, ${firstName(conv)}! 😊 E qual o endereço de entrega? Se preferir retirar aqui, é só dizer *retirar*.`]
        }
        if (PICKUP_RE.test(bare) && bare.split(' ').length <= 4) {
          conv.checkout.address = 'Retirada no local'
        } else {
          // Não parece endereço ("sim", "ok", uma frase solta): pede de novo (aceita na 3ª tentativa)
          const tries = conv.checkout.addressTries ?? 0
          if (!ADDRESS_RE.test(bare) && tries < 2) {
            conv.checkout.addressTries = tries + 1
            return ['Não consegui entender o endereço 😅 Me manda a *rua, número e bairro* — ou *retirar*, se preferir buscar aqui.']
          }
          conv.checkout.address = text.slice(0, 300)
        }
        return [this.nextCheckoutStep(tenant, conv, 'Anotado! ')]

      case 'checkout_payment': {
        const ask = this.readPayment(tenant, conv, bare, text)
        return [ask ?? this.nextCheckoutStep(tenant, conv)]
      }

      case 'checkout_confirm':
        if (YES.has(bare)) return [this.confirmOrder(tenant, conv)]
        // Trocou a forma de pagamento na hora de confirmar ("na verdade vou pagar no cartão")
        if (paymentMethod(bare)) {
          conv.checkout.payment = undefined
          const ask = this.readPayment(tenant, conv, bare, text)
          return [ask ?? this.nextCheckoutStep(tenant, conv, 'Trocado! ')]
        }
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
    conv.lastKind = 'fallback'

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
    const isQuestion = QUESTION_RE.test(n) || QUESTION_CUE_RE.test(n)
    const name = firstName(conv)

    if (has('human')) return { replies: [this.handoff(tenant, conv)] }
    if (has('thanks') && short) return { replies: [this.pick(PHRASES.thanks).replace('{nome}', name ? `, ${name}` : '')] }
    if (has('bye') && short) return { replies: [this.pick(PHRASES.bye)] }

    // "já pedi, olha aí": desculpa e mostra o pedido
    if (ALREADY_ORDERED_RE.test(n)) {
      return { replies: [conv.cart.length ? `Desculpa a confusão! 😅 Seu pedido está assim:\n\n${this.cartText(conv)}` : this.totalText(tenant, conv)] }
    }
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
    const products = this.activeProducts(tenant)
    const match = findProduct(products, n)
    const wantsOthers = OTHER_OPTIONS_RE.test(n)

    if (/\b(cardapio|catalogo)\b/.test(n) && n.split(' ').length <= 6 && !has('order') && match.kind === 'none' && !wantsOthers) {
      conv.state = 'catalog'
      return { replies: [this.pick(PHRASES.catalogIntro), this.catalogText(tenant, conv)] }
    }

    // Logo depois de mostrar a promoção: "teria outras?", "só tem essa?" falam da promoção, não do cardápio
    if (this.recentTopic(conv) === 'promocoes' && !REF_ORDER_RE.test(n) && (wantsOthers || ONLY_THIS_RE.test(n) || (PROMO_RE.test(n) && !has('order')))) {
      return { replies: [this.onlyThisPromo(tenant, conv)] }
    }

    // Pergunta sobre um item ("a 1 tem refri incluso?", "a calabresa é apimentada?"): nunca vira pedido.
    // A IA responde com o cardápio e o pedido em mãos; sem IA, a descrição do produto.
    const catalogShown = conv.state === 'catalog' || lastBotWasCatalog(conv) || conv.cart.length > 0
    const numberRef = isQuestion && catalogShown ? NUMBER_REF_RE.exec(n) : null
    const asked = numberRef ? products[Number(numberRef[1]) - 1] : undefined
    if (isQuestion && !REF_ORDER_RE.test(n) && (asked || (match.kind === 'one' && !asksInfo && !has('price')))) {
      const target = asked ?? (match.kind === 'one' ? match.product : undefined)!
      if (!has('price')) {
        const ai = await this.tryAi(tenant, conv)
        if (ai) return ai
      }
      const other = match.kind === 'one' && match.product.id !== target.id ? match.product : undefined
      return { replies: [other ? this.includesReply(target, other, conv) : this.describeProduct(target, conv, n)] }
    }

    // Memória curta: "quero essa", "quero ela também", "mais uma", "quanto custa ela?"
    // (o último produto citado — inclusive a promoção que acabou de ser apresentada)
    const promo = promoProduct(products)
    const refTarget = match.kind === 'one' && REF_ORDER_RE.test(n)
      ? match.product // "e a promoção? quero ela"
      : match.kind === 'none'
        ? (PROMO_RE.test(n) && promo) || (conv.lastProduct ? products.find(p => p.id === conv.lastProduct) : undefined)
        : undefined
    if (refTarget) {
      const more = MORE_RE.exec(n)
      const wantsIt = REF_ORDER_RE.test(n) || (PROMO_RE.test(n) && has('order'))
      if (wantsIt || more) {
        const qty = more?.[1] ? clampQty(parseQuantity(more[1])) : 1
        const label = this.addProduct(conv, refTarget, qty, n)
        conv.state = 'catalog'
        const replies = [label ? this.addedText(conv, [label]) : this.sizeQuestion(tenant, conv)]
        if (wantsOthers) replies.push(this.optionsSummary(tenant, conv))
        return { replies }
      }
      // "pra ela" / frase longa sem preço fala de uma pessoa, não do produto ("opção pra ela?")
      const aboutProduct = has('price') || (isQuestion && n.split(' ').length <= 5 && !/\b(pra|para) (ela|ele)\b/.test(n))
      if (REF_RE.test(n) && aboutProduct) return { replies: [this.describeProduct(refTarget, conv, n)] }
    }
    // "tem outro sabor?", "só tem esses?", "teria outras": lista curta do que existe
    if (wantsOthers) return { replies: [this.optionsSummary(tenant, conv)] }

    // "meio calabresa meio margherita" já é um pedido (quando o cliente monta meio a meio)
    if (tenant.halfHalf && HALF_RE.test(n) && !isQuestion) {
      const half = this.tryHalfHalf(tenant, conv, n)
      if (half) return { replies: [half] }
    }

    // Produtos: pedir pelo nome ("quero 2 calabresa") ou perguntar de um produto específico
    const wantsToOrder = has('order') && !isQuestion
    const catalogOnScreen = conv.state === 'catalog' || lastBotWasCatalog(conv)
    if (wantsToOrder || (conv.state === 'catalog' && match.kind === 'one' && !isQuestion && !asksInfo)) {
      const reply = this.addItemsByName(tenant, conv, n, catalogOnScreen)
      if (reply) return { replies: [reply] }
    }
    if (match.kind === 'one' && !asksInfo && !wantsToOrder) return { replies: [this.describeProduct(match.product, conv, n)] }

    // Várias perguntas numa mensagem: "qual o horário e aceita pix?" responde as duas
    const several = this.severalAnswers(tenant, n)
    if (several) {
      conv.lastKind = 'kb'
      return { replies: [several], informative: true }
    }

    // Base de conhecimento: a pergunta cadastrada mais parecida
    const kb = this.deps.knowledge?.match(tenant, n)
    if (kb?.status === 'answer') return this.knowledgeReply(tenant, conv, kb)
    const missingTopic = kb?.status === 'missing' ? `${kb.packId}/${kb.topic}` : undefined

    // Ingrediente citado ("quero azeitona", "tem com cebola?"): sugere o produto que leva
    const withIngredient = this.ingredientReply(products, conv, n)
    if (withIngredient) return { replies: [withIngredient] }
    // "tem coxinha?": item que não está no catálogo (só quando a base não tem nem um assunto parecido)
    if (!kb && match.kind === 'none' && !this.deps.knowledge?.candidates?.(tenant, n).length) {
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
    const ai = await this.tryAi(tenant, conv)
    if (ai) return ai

    // Sem IA: responde com os dados cadastrados do negócio
    const info = this.infoAnswer(tenant, n, intents)
    if (info) return { replies: [info], informative: true }

    // Quase entendeu: pergunta em vez de chutar ("Você quis dizer…?")
    const options = missingTopic ? [] : this.deps.knowledge?.candidates?.(tenant, n) ?? []
    if (options.length) {
      conv.choice = { text: n, options: options.map(o => ({ key: o.key, title: o.title })) }
      conv.lastKind = 'clarify'
      const list = options.map((o, i) => `*${i + 1}* - ${o.title}`).join('\n')
      return { replies: [`Não tenho certeza se entendi 🤔 Você quis dizer:\n\n${list}\n\nÉ só responder com o número (ou *não*, se for outra coisa).`] }
    }
    return { missingTopic }
  }

  private agentAvailable (tenant: TenantConfig): boolean {
    return tenant.ai.enabled && tenant.ai.mode !== 'assist' && Boolean(this.deps.agent)
  }

  /** Uma vez da IA funcionária: lê a conversa, usa as ferramentas e responde. Undefined = usar as regras. */
  private async agentTurn (tenant: TenantConfig, conv: Conversation): Promise<string[] | undefined> {
    if (!this.agentAvailable(tenant)) return undefined
    const cartBefore = JSON.stringify(conv.cart)
    const effects = { handoff: '', ordered: false }
    try {
      const text = await this.deps.agent!({
        system: agentPrompt(tenant, conv, this.deps.knowledge?.faq?.(tenant) ?? [], this.now()),
        messages: agentHistory(conv),
        tools: AGENT_TOOLS,
        run: (name, args) => this.agentTool(tenant, conv, name, args, effects),
      })
      const replies = [text]
      // A IA já avisou que vai chamar a equipe: a mensagem padrão só entra se ela não disse nada
      if (effects.handoff && !text.trim()) replies.push(effects.handoff)
      conv.lastKind = effects.handoff ? 'handoff' : effects.ordered || JSON.stringify(conv.cart) !== cartBefore ? 'order' : 'ai'
      if (!effects.handoff) conv.state = conv.cart.length ? 'catalog' : 'menu'
      const out = replies.filter(r => r.trim())
      return out.length ? out : undefined
    } catch (err) {
      console.error(`[ia] ${tenant.id}: ${err instanceof Error ? err.message : err}`)
      return undefined
    }
  }

  /** Executa uma ferramenta pedida pela IA. O texto devolvido volta para ela. */
  private agentTool (tenant: TenantConfig, conv: Conversation, name: string, args: Record<string, unknown>, effects: { handoff: string; ordered: boolean }): string {
    const products = this.activeProducts(tenant)
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
    const findOne = (ref: string): Product | string => {
      const n = applySynonyms(tenant, normalize(ref))
      const byNumber = /^(?:n(?:umero)?\s*)?(\d{1,2})$/.exec(n)
      if (byNumber) return products[Number(byNumber[1]) - 1] ?? `ERRO: não existe o item ${byNumber[1]} no cardápio.`
      const exact = products.find(p => normalize(p.name) === n)
      if (exact) return exact
      const m = findProduct(products, n)
      if (m.kind === 'one') return m.product
      if (m.kind === 'many') return `ERRO: "${ref}" pode ser: ${m.products.map(p => p.name).join(', ')}. Pergunte ao cliente qual.`
      return `ERRO: "${ref}" não está no cardápio.`
    }
    const cartState = () => conv.cart.length
      ? `Pedido agora: ${conv.cart.map((i, k) => `${k + 1}) ${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`).join('; ')}. Total: ${formatPrice(cartTotal(conv))}.`
      : 'Pedido vazio.'

    switch (name) {
      case 'adicionar_item': {
        const product = findOne(str(args.produto))
        if (typeof product === 'string') return product
        const qty = clampQty(Number(args.quantidade) || 1)
        const extrasText = Array.isArray(args.adicionais) ? args.adicionais.map(str).join(' ') : str(args.adicionais)
        const extras = extrasText ? matchExtras(product, normalize(extrasText)) : []
        const sizeText = normalize(str(args.tamanho))
        const second = str(args.meio_a_meio_com)
        if (second) {
          if (tenant.halfHalf === 'off') return 'ERRO: a empresa não faz meio a meio.'
          const other = findOne(second)
          if (typeof other === 'string') return other
          const size = product.sizes?.length ? matchSize(product, sizeText) : undefined
          if (product.sizes?.length && !size) {
            return `FALTA TAMANHO: pergunte o tamanho. Opções: ${product.sizes.map(s => `${s.name} ${formatPrice(halfPrice(tenant, product, other, s.name))}`).join(', ')}.`
          }
          const label = this.addHalf(tenant, conv, `half:${product.id}:${other.id}`, qty, size?.name)
          return `OK, anotado: ${label}. ${cartState()}`
        }
        let size: ProductOption | undefined
        if (product.sizes?.length) {
          size = matchSize(product, sizeText)
          if (!size) return `FALTA TAMANHO: pergunte qual tamanho da ${product.name}. Opções: ${product.sizes.map(s => `${s.name} ${formatPrice(s.price)}`).join(', ')}.`
        }
        const label = this.addToCart(conv, product, qty, size, extras)
        return `OK, anotado: ${label}. ${cartState()}`
      }
      case 'remover_item': {
        const ref = normalize(str(args.item))
        const index = /^\d{1,2}$/.test(ref) ? Number(ref) - 1
          : conv.cart.findIndex(i => normalize(i.name).includes(ref) || keywords(ref).some(w => w.length >= 4 && normalize(i.name).includes(w)))
        const item = conv.cart[index]
        if (!item) return `ERRO: esse item não está no pedido. ${cartState()}`
        const qty = Number(args.quantidade) || item.qty
        item.qty -= qty
        if (item.qty <= 0) conv.cart.splice(index, 1)
        return `OK, removido. ${cartState()}`
      }
      case 'ver_pedido': {
        const { fee, feeNote, total } = this.checkoutTotals(tenant, conv)
        const totals = fee ? ` Taxa de entrega: ${formatPrice(fee)}. Total com entrega: ${formatPrice(total)}.` : feeNote ? ` Taxa de entrega: ${feeNote}.` : ''
        return `${cartState()}${totals} Nome: ${conv.checkout.name ?? '(não informado)'}. Entrega: ${conv.checkout.address ?? '(não informado)'}. Pagamento: ${conv.checkout.payment ?? '(não informado)'}.`
      }
      case 'dados_entrega': {
        if (str(args.nome)) conv.checkout.name = str(args.nome).slice(0, 80)
        if (args.retirada === true) conv.checkout.address = 'Retirada no local'
        else if (str(args.endereco)) conv.checkout.address = str(args.endereco).slice(0, 300)
        if (str(args.pagamento)) conv.checkout.payment = str(args.pagamento).slice(0, 120)
        return `OK. Nome: ${conv.checkout.name ?? '(falta)'}. Entrega: ${conv.checkout.address ?? '(falta)'}. Pagamento: ${conv.checkout.payment ?? '(falta)'}.`
      }
      case 'confirmar_pedido': {
        if (!conv.cart.length) return 'ERRO: o pedido está vazio.'
        if (!conv.checkout.name && conv.name) conv.checkout.name = conv.name
        if (!conv.checkout.address) return 'ERRO: falta o endereço de entrega (ou confirmar que vai retirar). Pergunte ao cliente.'
        if (!conv.checkout.payment) return 'ERRO: falta a forma de pagamento. Pergunte ao cliente antes de confirmar.'
        const min = moneyVar(tenant, 'pedido_minimo')
        if (min && cartTotal(conv) < min) return `ERRO: o pedido mínimo é ${formatPrice(min)} e o pedido está em ${formatPrice(cartTotal(conv))}.`
        const total = formatPrice(this.checkoutTotals(tenant, conv).total)
        const message = this.confirmOrder(tenant, conv)
        effects.ordered = true
        const number = /#(\d+)/.exec(message)?.[1] ?? ''
        return `OK, pedido #${number} registrado (total ${total}). Mensagem padrão da empresa para usar: "${message}"`
      }
      case 'cancelar_pedido':
        conv.cart = []
        conv.checkout = {}
        return 'OK, pedido cancelado.'
      case 'chamar_atendente':
        if (!effects.handoff) effects.handoff = this.handoff(tenant, conv)
        return 'OK, a equipe foi avisada e vai assumir a conversa. Responda só uma frase curta e não chame outras ferramentas.'
      case 'informacao_nao_cadastrada': {
        const asked = str(args.pergunta) || [...conv.messages].reverse().find(m => m.from === 'customer')?.text || ''
        if (asked) this.deps.knowledge?.logUnanswered(tenant.id, normalize(asked))
        return 'OK, a empresa foi avisada.'
      }
      default:
        return `ERRO: ferramenta "${name}" não existe.`
    }
  }

  /** Resposta da IA (OpenRouter/Claude), ou undefined se ela estiver desligada ou falhar. */
  private async tryAi (tenant: TenantConfig, conv: Conversation): Promise<Understood | undefined> {
    if (!this.aiAvailable(tenant)) return undefined
    try {
      const result = await this.deps.ai!(tenant, conv)
      if (result.missing) {
        const asked = [...conv.messages].reverse().find(m => m.from === 'customer')?.text
        if (asked) this.deps.knowledge?.logUnanswered(tenant.id, normalize(asked))
      }
      if (result.handoff) return { replies: [result.text, this.handoff(tenant, conv)].filter(Boolean) }
      if (result.text) {
        conv.lastKind = 'ai'
        return { replies: [result.text] }
      }
    } catch (err) {
      console.error(`[ai] ${tenant.id}:`, err instanceof Error ? err.message : err)
    }
    return undefined
  }

  /** "A 1 tem refri incluso?": diz se o outro item vem junto (pela descrição) ou sai à parte. */
  private includesReply (target: Product, other: Product, conv: Conversation): string {
    const desc = normalize(target.description ?? '')
    const included = keywords(normalize(other.name)).some(w => w.length >= 4 && desc.includes(w))
    conv.lastProduct = target.id
    if (included) return `Sim! A *${target.name}* já vem com ${other.name.toLowerCase()} 😊 _(${target.description})_ — sai por *${priceLabel(target)}*.`
    const inCart = conv.cart.some(i => i.productId === other.id)
    if (!inCart) conv.offer = other.id
    return `Não, a *${target.name}* não vem com ${other.name.toLowerCase()}${target.description ? ` _(${target.description})_` : ''}.\n\n` +
      (inCart ? `O *${other.name}* sai à parte por *${priceLabel(other)}* — e já está no seu pedido 😉` : `O *${other.name}* sai à parte por *${priceLabel(other)}*. Quer que eu anote um?`)
  }

  /** Assunto respondido na mensagem anterior do cliente (undefined se a conversa já seguiu). */
  private recentTopic (conv: Conversation): string | undefined {
    const t = conv.lastTopic
    if (!t) return undefined
    const customerSince = conv.messages.slice(t.at).filter(m => m.from === 'customer').length
    return customerSince <= 1 ? t.key : undefined
  }

  private onlyThisPromo (tenant: TenantConfig, conv: Conversation): string {
    conv.lastTopic = { key: 'promocoes', at: conv.messages.length }
    conv.lastKind = 'kb'
    const promo = promoProduct(this.activeProducts(tenant))
    if (promo) {
      conv.lastProduct = promo.id
      conv.offer = promo.id
      return `No momento a promoção é só essa mesmo 😊 A *${promo.name}* sai por *${priceLabel(promo)}*.

Quer que eu já anote pra você?`
    }
    return 'No momento a promoção é só essa mesmo 😊 Se quiser aproveitar, é só me dizer o sabor da pizza que eu anoto!'
  }

  private knowledgeReply (tenant: TenantConfig, conv: Conversation, kb: Extract<KbResult, { status: 'answer' }>): Understood {
    conv.lastKind = 'kb'
    conv.lastTopic = { key: kb.topic, at: conv.messages.length }
    // Depois de apresentar a promoção, "quero essa" se refere ao combo cadastrado
    if (kb.topic === 'promocoes') {
      const promo = promoProduct(this.activeProducts(tenant))
      if (promo) {
        conv.lastProduct = promo.id
        conv.offer = promo.id
        return { replies: [`${kb.answer}\n\nQuer que eu já anote pra você? 😋`] }
      }
    }
    if (kb.action === 'catalog') {
      conv.state = 'catalog'
      return { replies: [kb.answer || this.pick(PHRASES.catalogIntro), this.catalogText(tenant, conv)] }
    }
    if (kb.action === 'human') return { replies: [kb.answer, this.handoff(tenant, conv)].filter(Boolean) }
    return { replies: [kb.answer], informative: true }
  }

  /** Divide a mensagem em perguntas e responde cada assunto diferente (só quando acha 2 ou mais). */
  private severalAnswers (tenant: TenantConfig, n: string): string | undefined {
    const kb = this.deps.knowledge
    if (!kb) return undefined
    const clauses = n.split(/\?|\s+e\s+(?=(?:qual|quais|como|onde|quando|quanto|que|tem|aceita|aceitam|faz|fazem|voces|vcs|entrega|entregam|abre|abrem|funciona)\b)|;/)
      .map(c => c.trim()).filter(c => keywords(c).length >= 1)
    if (clauses.length < 2) return undefined
    const seen = new Set<string>()
    const answers: string[] = []
    for (const c of clauses) {
      const r = kb.match(tenant, c)
      if (r?.status !== 'answer' || r.action || seen.has(r.topic)) continue
      seen.add(r.topic)
      answers.push(r.answer)
    }
    return answers.length >= 2 ? answers.join('\n\n') : undefined
  }

  /** Preço e descrição de um produto (com os tamanhos, se houver) e a oferta de anotar. */
  private describeProduct (p: Product, conv: Conversation, n: string): string {
    conv.offer = p.id
    conv.lastProduct = p.id
    if (promoProduct([p])) conv.lastTopic = { key: 'promocoes', at: conv.messages.length }
    const size = matchSize(p, n)
    const price = size
      ? `*${p.name}* (${size.name}) sai por *${formatPrice(size.price)}*`
      : p.sizes?.length
        ? `*${p.name}*: ${p.sizes.map(s => `${s.name} *${formatPrice(s.price)}*`).join(' · ')}`
        : `*${p.name}* sai por *${formatPrice(p.price)}*`
    const extras = p.extras?.length ? `\nAdicionais: ${p.extras.map(e => `${e.name} (+${formatPrice(e.price)})`).join(', ')}` : ''
    return `A ${price} 😋${p.description ? `\n_${p.description}_` : ''}${extras}\n\nQuer que eu já anote uma pra você?`
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
    conv.lastKind = 'handoff'
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
    if (conv.lastKind === 'other') conv.lastKind = 'catalog'
    const lines = products.map((p, i) =>
      `*${i + 1}* - ${p.name} — ${priceLabel(p)}${p.description ? `\n      _${p.description}_` : ''}` +
      (p.extras?.length ? `\n      Adicionais: ${p.extras.map(e => `${e.name} +${formatPrice(e.price)}`).join(', ')}` : ''))
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
    // "sim" depois de "Quer mais alguma coisa?": quer pedir mais
    if (YES.has(n) && conv.cart.length > 0 && !FINISH_RE.test(n)) return 'Claro! O que mais vai querer? 😊'
    if (FINISH_RE.test(n) || (NO.has(n) && conv.cart.length > 0)) {
      if (conv.cart.length === 0) return 'Seu pedido ainda está vazio. Me diga o que você quer que eu anoto! 😊'
      const min = moneyVar(tenant, 'pedido_minimo')
      if (min && cartTotal(conv) < min) {
        return `O pedido mínimo é *${formatPrice(min)}* e o seu está em *${formatPrice(cartTotal(conv))}* 😊 Quer adicionar mais alguma coisa?`
      }
      return this.nextCheckoutStep(tenant, conv, 'Ótimo! ')
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
    const list = products.map((p, i) => `*${i + 1}* - ${p.name} — ${priceLabel(p)}`).join('\n')
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

  /**
   * Coloca no carrinho já com o tamanho e os adicionais. Cada combinação é uma linha:
   * "Pizza Calabresa (Grande) + Borda de catupiry".
   */
  private addToCart (conv: Conversation, product: Product, qty: number, size?: ProductOption, extras: ProductOption[] = []): string {
    const key = [product.id, size?.name, ...extras.map(e => e.name)].filter(Boolean).join('|')
    const name = `${product.name}${size ? ` (${size.name})` : ''}${extras.map(e => ` + ${e.name}`).join('')}`
    const price = round2((size?.price ?? product.price) + extras.reduce((s, e) => s + e.price, 0))
    const item = conv.cart.find(i => i.productId === key)
    if (item) item.qty += qty
    else conv.cart.push({ productId: key, name, price, qty })
    conv.lastProduct = product.id
    conv.lastKind = 'order'
    return `${qty}x ${name}`
  }

  /**
   * Adiciona um produto lendo tamanho e adicionais no texto ("calabresa grande com borda de catupiry").
   * Se o produto tem tamanhos e o cliente não disse qual, guarda e retorna undefined (o bot pergunta).
   */
  private addProduct (conv: Conversation, product: Product, qty: number, text: string): string | undefined {
    const extras = matchExtras(product, text)
    if (product.sizes?.length) {
      const size = matchSize(product, text)
      if (!size) {
        conv.pendingSize = [...(conv.pendingSize ?? []), { productId: product.id, qty, extras: extras.map(e => e.name) }]
        conv.lastProduct = product.id
        return undefined
      }
      return this.addToCart(conv, product, qty, size, extras)
    }
    return this.addToCart(conv, product, qty, undefined, extras)
  }

  private addedText (conv: Conversation, labels: string[]): string {
    return `${this.pick(PHRASES.added)} ${labels.join(', ')}.\n\n${this.cartText(conv)}`
  }

  /** "Qual tamanho da Calabresa? 1 - Média … 2 - Grande …" (item ou meio a meio esperando o tamanho). */
  private sizeQuestion (tenant: TenantConfig, conv: Conversation, prefix = ''): string {
    const pending = conv.pendingSize?.[0]
    if (!pending) return this.cartText(conv)
    const { label, sizes } = this.pendingInfo(tenant, pending.productId)
    const list = sizes.map((s, i) => `*${i + 1}* - ${s.name} — ${formatPrice(s.price)}`).join('\n')
    return `${prefix}Qual tamanho ${pending.qty > 1 ? `das ${pending.qty} ` : 'da '}*${label}*?\n\n${list}`
  }

  /** Nome e tamanhos (com preço) de um item esperando tamanho — produto comum ou meio a meio. */
  private pendingInfo (tenant: TenantConfig, productId: string): { label: string; sizes: ProductOption[] } {
    const products = tenant.products
    if (productId.startsWith('half:')) {
      const [, a, b] = productId.split(':')
      const pa = products.find(p => p.id === a)!
      const pb = products.find(p => p.id === b)!
      const sizes = (pa.sizes ?? []).map(s => ({ name: s.name, price: halfPrice(tenant, pa, pb, s.name) }))
      return { label: `meio a meio ${shortName(pa, products)} / ${shortName(pb, products)}`, sizes }
    }
    const p = products.find(x => x.id === productId)!
    return { label: p.name, sizes: p.sizes ?? [] }
  }

  /** Resposta ao "Qual tamanho?": número ou nome do tamanho. Sem relação com a pergunta: deixa o fluxo seguir. */
  private resolvePendingSize (tenant: TenantConfig, conv: Conversation, bare: string): string | undefined {
    const pending = conv.pendingSize![0]
    const { sizes } = this.pendingInfo(tenant, pending.productId)
    const byNumber = /^\d$/.test(bare) ? sizes[Number(bare) - 1] : undefined
    const size = byNumber ?? matchSize({ sizes } as Product, bare)
    if (!size) {
      conv.pendingSize = undefined // mudou de assunto
      return undefined
    }
    conv.pendingSize!.shift()
    let label: string
    if (pending.productId.startsWith('half:')) {
      label = this.addHalf(tenant, conv, pending.productId, pending.qty, size.name)
    } else {
      const product = tenant.products.find(p => p.id === pending.productId)!
      const extras = (product.extras ?? []).filter(e => pending.extras.includes(e.name))
      label = this.addToCart(conv, product, pending.qty, (product.sizes ?? []).find(s => s.name === size.name), extras)
    }
    conv.state = 'catalog'
    if (conv.pendingSize?.length) return this.sizeQuestion(tenant, conv, `${this.pick(PHRASES.added)} ${label}.\n\n`)
    conv.pendingSize = undefined
    return this.addedText(conv, [label])
  }

  /** Pizza meio a meio no carrinho, com o preço pela regra do cliente (sabor mais caro ou média). */
  private addHalf (tenant: TenantConfig, conv: Conversation, halfId: string, qty: number, sizeName?: string): string {
    const [, a, b] = halfId.split(':')
    const pa = tenant.products.find(p => p.id === a)!
    const pb = tenant.products.find(p => p.id === b)!
    const name = `Meio a meio: ${shortName(pa, tenant.products)} / ${shortName(pb, tenant.products)}${sizeName ? ` (${sizeName})` : ''}`
    const key = `half|${a}|${b}|${sizeName ?? ''}`
    const price = halfPrice(tenant, pa, pb, sizeName)
    const item = conv.cart.find(i => i.productId === key)
    if (item) item.qty += qty
    else conv.cart.push({ productId: key, name, price, qty })
    conv.lastKind = 'order'
    return `${qty}x ${name}`
  }

  /** "meio calabresa meio margherita", "metade 4 queijos e metade calabresa". Undefined se não for meio a meio. */
  private tryHalfHalf (tenant: TenantConfig, conv: Conversation, n: string): string | undefined {
    if (!HALF_RE.test(n)) return undefined
    const products = this.activeProducts(tenant)
    const found: Product[] = []
    for (const seg of n.split(/\b(?:meio a meio|metade|meia|meio|com|e)\b|\//)) {
      const m = findProduct(products, seg)
      if (m.kind === 'one' && !found.includes(m.product)) found.push(m.product)
    }
    if (found.length !== 2) return undefined
    if (tenant.halfHalf === 'off') return 'Não fazemos pizza meio a meio 😕 Mas pode pedir as duas inteiras, se quiser!'
    const [pa, pb] = found
    const head = n.split(HALF_RE)[0]
    const qty = /\d|\b(uma|duas|tres)\b/.test(head) ? clampQty(parseQuantity(head)) : 1
    const halfId = `half:${pa.id}:${pb.id}`
    if (pa.sizes?.length) {
      const size = matchSize(pa, n)
      if (!size) {
        conv.pendingSize = [...(conv.pendingSize ?? []), { productId: halfId, qty, extras: [] }]
        conv.state = 'catalog'
        return this.sizeQuestion(tenant, conv)
      }
      conv.state = 'catalog'
      return this.addedText(conv, [this.addHalf(tenant, conv, halfId, qty, size.name)])
    }
    conv.state = 'catalog'
    return this.addedText(conv, [this.addHalf(tenant, conv, halfId, qty)])
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

    // Meio a meio ("meio calabresa meio margherita"); sem regra cadastrada, quem responde é a base de conhecimento
    if (HALF_RE.test(n)) {
      if (!tenant.halfHalf) return undefined
      const half = this.tryHalfHalf(tenant, conv, n)
      if (half) return half
    }

    // "uma de cada" / "duas de cada": todos os itens do grupo principal (ex.: as pizzas)
    const each = new RegExp(`\\b(${QTY_WORD})\\s+de\\s+cada\\b`).exec(n)
    if (each && products.length > 0) {
      const qty = parseQuantity(each[1])
      for (const p of mainGroup(products)) {
        const label = this.addProduct(conv, p, qty, n)
        if (label) added.push(label)
      }
      conv.state = 'catalog'
      return this.finishAdding(tenant, conv, added)
    }

    // Palavras de adicionais ("borda de catupiry") não podem atrapalhar a escolha do produto
    const extraWords = new Set(products.flatMap(p => (p.extras ?? []).flatMap(e => keywords(normalize(e.name)))))

    for (const chunk of byNumber ? orderChunks(n) : splitItems(n)) {
      const numbered = byNumber ? numberedItem(chunk) : undefined
      if (numbered) {
        const product = products[numbered.index - 1]
        if (!product) { invalid.push(String(numbered.index)); continue }
        const label = this.addProduct(conv, product, numbered.qty, chunk)
        if (label) added.push(label)
        last = product
        continue
      }
      const cleaned = keywords(chunk).filter(w => !extraWords.has(w)).join(' ')
      let match = findProduct(products, cleaned || chunk)
      if (match.kind === 'none') match = findProduct(products, chunk)
      // Número + tamanho/adicional com o catálogo na tela: "2 grande", "1 com borda"
      if (match.kind === 'none' && byNumber) {
        const m = /(?:^|\s)(\d{1,2})\s+(.+)$/.exec(chunk)
        const product = m ? products[Number(m[1]) - 1] : undefined
        if (product && (matchSize(product, m![2]) || matchExtras(product, m![2]).length)) {
          const label = this.addProduct(conv, product, 1, m![2])
          if (label) added.push(label)
          last = product
          continue
        }
      }
      if (match.kind === 'many') { ambiguous.push(match.products); continue }
      if (match.kind !== 'one') continue
      const explicitQty = /\d|\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.test(chunk)
      // "frango e catupiry" é um produto só: não adiciona de novo o mesmo item sem quantidade
      if (match.product === last && !explicitQty) continue
      const label = this.addProduct(conv, match.product, parseQuantity(chunk), chunk)
      if (label) added.push(label)
      last = match.product
    }

    const notFound = invalid.length
      ? `Não achei o item *${invalid.join('*, *')}* na lista (vai de 1 a ${products.length}).`
      : ''
    if (added.length > 0 || conv.pendingSize?.length) {
      conv.state = 'catalog'
      const doubt = ambiguous.length ? `\n\nSó não entendi qual destes você quer: ${this.listOptions(ambiguous[0], products)}` : ''
      return this.finishAdding(tenant, conv, added, `${notFound ? `\n${notFound}` : ''}${doubt}`)
    }
    if (notFound) return `Hmm, ${notFound.charAt(0).toLowerCase()}${notFound.slice(1)} Pode conferir o número? 😊`
    if (ambiguous.length > 0) {
      conv.state = 'catalog'
      return `Temos algumas opções: ${this.listOptions(ambiguous[0], products)}\n\nQual delas você prefere?`
    }
    return undefined
  }

  /** Resposta depois de adicionar: o que entrou e, se faltar tamanho de algum item, a pergunta do tamanho. */
  private finishAdding (tenant: TenantConfig, conv: Conversation, added: string[], note = ''): string {
    if (conv.pendingSize?.length) {
      const prefix = added.length ? `${this.pick(PHRASES.added)} ${added.join(', ')}.${note}\n\n` : note ? `${note.trim()}\n\n` : ''
      return this.sizeQuestion(tenant, conv, prefix)
    }
    return `${this.pick(PHRASES.added)} ${added.join(', ')}.${note}\n\n${this.cartText(conv)}`
  }

  private listOptions (options: Product[], all: Product[]): string {
    return '\n' + options.map(p => `*${all.indexOf(p) + 1}* - ${p.name} — ${priceLabel(p)}`).join('\n')
  }

  private cartText (conv: Conversation): string {
    if (conv.cart.length === 0) return 'Seu pedido ainda está vazio.'
    const lines = conv.cart.map(i => `• ${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`)
    return ['🛒 *Seu pedido até agora:*', ...lines, `*Total: ${formatPrice(cartTotal(conv))}*`, '',
      this.pick(PHRASES.cartFooter)].join('\n')
  }

  /**
   * Fechamento sempre na mesma ordem, um passo por mensagem:
   * 1. nome → 2. entrega (endereço) ou retirada → 3. forma de pagamento (e troco) → 4. resumo para confirmar.
   * Pergunta só o que ainda falta, então o cliente pode adiantar dados sem repetir.
   */
  private nextCheckoutStep (tenant: TenantConfig, conv: Conversation, prefix = ''): string {
    if (!conv.checkout.name) {
      conv.state = 'checkout_name'
      // Já sabemos o nome pelo WhatsApp: só confirma, em vez de perguntar de novo
      const known = firstName(conv)
      return known
        ? `${prefix}Posso colocar o pedido no nome de *${known}*? Responda *sim* ou me diga o nome certo. 😊`
        : `${prefix}${this.pick(PHRASES.askName)}`
    }
    if (!conv.checkout.address) {
      conv.state = 'checkout_address'
      return `${prefix}Qual o endereço de entrega (rua, número e bairro)? Se preferir retirar aqui, é só dizer *retirar*.`
    }
    if (!conv.checkout.payment) {
      conv.state = 'checkout_payment'
      const methods = tenantVar(tenant, 'formas_pagamento')
      return `${prefix}Como vai ser o pagamento?${methods ? ` Aceitamos *${methods}*.` : ' Pix, cartão ou dinheiro?'}`
    }
    conv.state = 'checkout_confirm'
    return `${prefix}Confere pra mim, por favor:\n\n${this.orderSummary(tenant, conv)}\n\nPosso confirmar? (responda *sim* ou *cancelar*)`
  }

  /** Lê a forma de pagamento. Retorna a próxima pergunta (troco, forma não aceita) ou undefined quando já anotou. */
  private readPayment (tenant: TenantConfig, conv: Conversation, bare: string, text: string): string | undefined {
    const methods = tenantVar(tenant, 'formas_pagamento')
    const money = (s: string) => /(\d+(?:[.,]\d{1,2})?)/.exec(s)?.[1]
    if (conv.checkout.askChange) {
      conv.checkout.askChange = false
      const value = money(bare)
      conv.checkout.payment = value ? `Dinheiro (troco para ${formatPrice(Number(value.replace(',', '.')))})` : 'Dinheiro (sem troco)'
      return undefined
    }
    const method = paymentMethod(bare)
    if (!method) {
      const tries = conv.checkout.paymentTries ?? 0
      if (tries < 2) {
        conv.checkout.paymentTries = tries + 1
        return `Não entendi a forma de pagamento 😅${methods ? ` Aceitamos *${methods}*.` : ''} Qual você prefere?`
      }
      conv.checkout.payment = text.slice(0, 120)
      return undefined
    }
    if (methods && !acceptsPayment(methods, method)) return `Infelizmente não aceitamos ${method.toLowerCase()} 😕 Aceitamos *${methods}*. Qual você prefere?`
    if (method === 'Dinheiro') {
      const value = /troco\s*(?:pra|para|de)?\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/.exec(bare)?.[1]
      if (value) conv.checkout.payment = `Dinheiro (troco para ${formatPrice(Number(value.replace(',', '.')))})`
      else if (/sem troco|nao (precisa|preciso) (de )?troco|troco nao/.test(bare)) conv.checkout.payment = 'Dinheiro (sem troco)'
      else {
        conv.checkout.askChange = true
        return 'Vai precisar de troco? Se sim, pra quanto? 😊'
      }
      return undefined
    }
    conv.checkout.payment = method
    return undefined
  }

  /** Subtotal dos itens, taxa de entrega (só quando cadastrada como valor e não é retirada) e total. */
  private checkoutTotals (tenant: TenantConfig, conv: Conversation): { subtotal: number; fee: number; feeNote: string; total: number } {
    const subtotal = cartTotal(conv)
    const delivery = Boolean(conv.checkout.address) && conv.checkout.address !== 'Retirada no local'
    const raw = tenantVar(tenant, 'taxa_entrega')
    const fee = delivery ? moneyVar(tenant, 'taxa_entrega') : 0
    // Taxa escrita como texto ("R$ 5 no centro, R$ 8 nos bairros"): mostra, mas não soma
    const feeNote = delivery && !fee && raw ? raw : ''
    return { subtotal, fee, feeNote, total: round2(subtotal + fee) }
  }

  private orderSummary (tenant: TenantConfig, conv: Conversation): string {
    const lines = conv.cart.map(i => `• ${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`)
    const { subtotal, fee, feeNote, total } = this.checkoutTotals(tenant, conv)
    const totals = fee
      ? [`Subtotal: ${formatPrice(subtotal)}`, `Taxa de entrega: ${formatPrice(fee)}`, `*Total: ${formatPrice(total)}*`]
      : [`*Total: ${formatPrice(total)}*`, ...(feeNote ? [`Taxa de entrega: ${feeNote}`] : [])]
    return ['📝 *Resumo do pedido*', ...lines, ...totals, '',
      `Nome: ${conv.checkout.name}`, `Entrega: ${conv.checkout.address}`, ...(conv.checkout.payment ? [`Pagamento: ${conv.checkout.payment}`] : [])].join('\n')
  }

  private confirmOrder (tenant: TenantConfig, conv: Conversation): string {
    const at = this.now().toISOString()
    const { fee, total } = this.checkoutTotals(tenant, conv)
    const payment = conv.checkout.payment ?? ''
    const order = this.deps.store.addOrder(tenant.id, {
      chatId: conv.chatId,
      channel: conv.channel,
      customerName: conv.checkout.name ?? conv.name,
      address: conv.checkout.address ?? '',
      ...(payment ? { payment } : {}),
      ...(fee ? { deliveryFee: fee } : {}),
      items: conv.cart,
      total,
      status: 'novo',
      createdAt: at,
      updatedAt: at,
    })
    let reply = fill(tenant.messages.orderConfirmed, tenant, conv, this.now()).replaceAll('{pedido}', `#${order.number}`)
    // Pagamento no Pix: já manda a chave
    const pix = tenantVar(tenant, 'chave_pix')
    if (/pix/i.test(payment) && pix) reply += `\n\nPra pagar no Pix, a chave é *${pix}* (total *${formatPrice(total)}*). Depois é só mandar o comprovante por aqui 😉`
    conv.cart = []
    conv.checkout = {}
    conv.state = 'menu'
    this.deps.onOrder?.(tenant.id, order.id)
    return reply
  }
}

const QTY_WORD = '\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez'
const ORDER_FILLER_RE = /\b(me da|me de|oxi|ta|ok|okay|beleza|blz|entao|certo|hmm|hum|tudo bem|bom|quero|queria|vou querer|gostaria de|gostaria|me ve|me manda|manda|pode ser|me traz|traz|coloca|adiciona|anota|tambem|numero|num|item|opcao|por favor|pfv|pf|isso)\b/g
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
  return splitItems(n.replace(/[!?]+|\.{2,}|\.\s/g, ' ').replace(/[.\s]+$/, '')).flatMap(c => {
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

const round2 = (v: number) => Math.round(v * 100) / 100

/** "R$ 49,90" ou, com tamanhos, "Média R$ 49,90 · Grande R$ 59,90". */
function priceLabel (p: Product): string {
  return p.sizes?.length ? p.sizes.map(s => `${s.name} ${formatPrice(s.price)}`).join(' · ') : formatPrice(p.price)
}

const SIZE_ALIASES: Record<string, string> = { g: 'grande', gde: 'grande', grd: 'grande', m: 'media', med: 'media', p: 'pequena', peq: 'pequena', fam: 'familia' }

/** Tamanho citado no texto ("grande", "a média", "G", "a maior"). */
function matchSize (p: Pick<Product, 'sizes'>, text: string): ProductOption | undefined {
  const sizes = p.sizes ?? []
  if (!sizes.length) return undefined
  const tokens = normalize(text).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).map(t => SIZE_ALIASES[t] ?? t)
  const found = sizes.find(s => normalize(s.name).split(/\s+/).some(w => tokens.some(t => t === w || (t.length >= 4 && similar(t, w)))))
  if (found) return found
  if (tokens.includes('maior')) return [...sizes].sort((a, b) => b.price - a.price)[0]
  if (tokens.includes('menor')) return [...sizes].sort((a, b) => a.price - b.price)[0]
  return undefined
}

/** Adicionais citados ("com borda de catupiry", "com bacon"): todas as palavras do adicional aparecem no texto. */
function matchExtras (p: Product, text: string): ProductOption[] {
  const words = keywords(normalize(text))
  return (p.extras ?? []).filter(e => {
    const need = keywords(normalize(e.name))
    return need.length > 0 && need.every(w => words.some(t => similar(t, w)))
  })
}

/** Preço do meio a meio pela regra do cliente: o sabor mais caro (padrão) ou a média dos dois. */
function halfPrice (tenant: TenantConfig, a: Product, b: Product, sizeName?: string): number {
  const price = (p: Product) => p.sizes?.find(s => s.name === sizeName)?.price ?? p.price
  return tenant.halfHalf === 'avg' ? round2((price(a) + price(b)) / 2) : Math.max(price(a), price(b))
}

/** Produto que representa a promoção (nome ou descrição com "promoção"/"combo"). */
function promoProduct (products: Product[]): Product | undefined {
  return products.find(p => PROMO_RE.test(normalize(`${p.name} ${p.description ?? ''}`)))
}

/** Variável do Conhecimento do cliente (ex.: formas_pagamento, chave_pix). */
function tenantVar (tenant: TenantConfig, key: string): string {
  return tenant.knowledge?.variables?.[key]?.trim() ?? ''
}

/** Variável que é só um valor em dinheiro ("R$ 5,00", "30") — texto livre não conta. */
function moneyVar (tenant: TenantConfig, key: string): number {
  const m = /^(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)$/i.exec(tenantVar(tenant, key))
  return m ? Number(m[1].replace(',', '.')) : 0
}

function paymentMethod (bare: string): string | undefined {
  if (/\bpix\b/.test(bare)) return 'Pix'
  if (/\bdebito\b/.test(bare)) return 'Cartão de débito'
  if (/\bcredito\b/.test(bare)) return 'Cartão de crédito'
  if (/\b(cartao|maquininha|maquina)\b/.test(bare)) return 'Cartão'
  if (/\b(dinheiro|especie|cash|troco)\b/.test(bare)) return 'Dinheiro'
  return undefined
}

function acceptsPayment (methods: string, method: string): boolean {
  const m = normalize(methods)
  if (method === 'Pix') return m.includes('pix')
  if (method === 'Cartão de débito') return m.includes('debito')
  if (method === 'Cartão de crédito') return m.includes('credito')
  if (method === 'Cartão') return /cartao|credito|debito/.test(m)
  return m.includes('dinheiro')
}

/** Troca as palavras do cliente pelos termos do cardápio ("coca" -> "refrigerante"). */
function applySynonyms (tenant: TenantConfig, n: string): string {
  let out = n
  for (const [from, to] of Object.entries(tenant.synonyms ?? {})) {
    const f = normalize(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (f) out = out.replace(new RegExp(`(^|[^a-z0-9])${f}(?=$|[^a-z0-9])`, 'g'), `$1${normalize(to)}`)
  }
  return out
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
