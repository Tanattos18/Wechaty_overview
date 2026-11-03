export type MenuOptionType = 'text' | 'catalog' | 'human' | 'ai'

export interface MenuOption {
  key: string
  label: string
  type: MenuOptionType
  /** Resposta fixa (usada quando type = 'text') */
  text?: string
}

/** Tamanho ou adicional de um produto, com o próprio preço. */
export interface ProductOption {
  name: string
  price: number
}

export interface Product {
  id: string
  name: string
  /** Preço base (usado quando o produto não tem tamanhos). */
  price: number
  description?: string
  active: boolean
  /** Tamanhos com preço próprio (ex.: Média R$ 49,90, Grande R$ 59,90). O bot pergunta se o cliente não disser. */
  sizes?: ProductOption[]
  /** Adicionais cobrados à parte (ex.: borda de catupiry +R$ 9,00). */
  extras?: ProductOption[]
}

export interface ClientPermissions {
  /** Horário, endereço, telefone, descrição e as informações da base de conhecimento (Pix, taxa, promoções...). */
  info: boolean
  /** Produtos do catálogo: nomes, preços e disponibilidade. */
  products: boolean
}

export const DEFAULT_PLAN = { name: 'Básico', adjustmentsPerMonth: 5 }

export type AdjustmentStatus = 'aberto' | 'andamento' | 'feito' | 'recusado'

export const ADJUSTMENT_STATUSES: AdjustmentStatus[] = ['aberto', 'andamento', 'feito', 'recusado']

/** Pedido de ajuste feito pelo cliente no painel (entra no pacote da mensalidade). */
export interface AdjustmentRequest {
  id: string
  number: number
  text: string
  status: AdjustmentStatus
  /** Resposta do Super Admin para o cliente. */
  note: string
  createdAt: string
  updatedAt: string
}

/** Configuração de um cliente do SaaS (um negócio = um número de WhatsApp). */
export interface TenantConfig {
  id: string
  name: string
  active: boolean
  /** Hash scrypt da senha do painel do cliente. Nunca é enviado ao navegador. */
  panelPasswordHash?: string
  business: {
    description: string
    hours: string
    address: string
    phone: string
    extraInfo: string
  }
  messages: {
    welcome: string
    fallback: string
    humanHandoff: string
    humanBack: string
    orderConfirmed: string
    nonText: string
  }
  menu: MenuOption[]
  products: Product[]
  ai: {
    enabled: boolean
    instructions: string
    /** 'agent' (padrão): a IA atende a conversa toda, como funcionária. 'assist': só perguntas abertas. */
    mode?: 'agent' | 'assist'
    /** Nome da atendente virtual (ex.: "Ana"). */
    agentName?: string
  }
  /** Depois de quantos minutos sem resposta do atendente o bot volta a responder. */
  humanTimeoutMin: number
  /**
   * "human": conversa natural, como um atendente (padrão).
   * "menu": mostra o menu numerado nas boas-vindas e quando não entende.
   */
  style?: 'human' | 'menu'
  /** Mensalidade atrasada ou contrato encerrado: bot desligado e painel do cliente bloqueado. */
  suspended?: boolean
  /** O que o próprio cliente pode editar no painel (o resto fica com o Super Admin). */
  clientCan?: ClientPermissions
  /** Frases prontas para o atendente responder com um clique. */
  quickReplies?: string[]
  /** Como cobrar pizza meio a meio: pelo sabor mais caro, pela média, ou não aceita. Sem valor: o bot não monta meio a meio. */
  halfHalf?: 'max' | 'avg' | 'off'
  /** Palavras do cliente -> termo do cardápio (ex.: "coca" -> "refrigerante", "4 queijos" -> "quatro queijos"). */
  synonyms?: Record<string, string>
  /** Plano contratado: quantos ajustes por mês estão incluídos na mensalidade. */
  plan?: { name: string; adjustmentsPerMonth: number }
  /** Base de conhecimento: pacotes ativos, informações do negócio e respostas personalizadas. */
  knowledge?: {
    packs: string[]
    variables: Record<string, string>
    /** Chave "pacote/assunto" -> resposta própria ou assunto desativado */
    overrides: Record<string, { answer?: string; enabled?: boolean }>
    /** Formas de perguntar ensinadas a este cliente (tela "Treinar"): "pacote/assunto" -> frases */
    extraQuestions?: Record<string, string[]>
  }
}

export type ChatState =
  | 'idle'
  | 'menu'
  | 'catalog'
  | 'checkout_name'
  | 'checkout_address'
  | 'checkout_payment'
  | 'checkout_confirm'
  | 'human'

export interface CartItem {
  productId: string
  name: string
  price: number
  qty: number
}

/** Que tipo de resposta o bot deu (alimenta o painel de qualidade). */
export type ReplyKind = 'kb' | 'order' | 'catalog' | 'handoff' | 'clarify' | 'fallback' | 'ai' | 'other'

export interface ChatMessage {
  from: 'customer' | 'bot' | 'agent'
  text: string
  at: string
  kind?: ReplyKind
  /** Marcada no painel como resposta errada (👎). */
  feedback?: 'bad'
}

export type Channel = 'whatsapp' | 'simulator'

export interface Conversation {
  chatId: string
  name: string
  channel: Channel
  state: ChatState
  cart: CartItem[]
  checkout: { name?: string; address?: string; payment?: string; addressTries?: number; paymentTries?: number; askChange?: boolean }
  humanSince?: string
  needsAgent: boolean
  /** Mensagens seguidas que o bot não entendeu. */
  misses?: number
  /** Produto oferecido na última resposta ("Quer que eu anote uma?"): um "sim" já adiciona. */
  offer?: string
  /** Último produto citado, para entender "quanto custa ela?", "quero mais uma". */
  lastProduct?: string
  /** Assunto da base de conhecimento respondido por último e em que mensagem ("só tem essa promoção?"). */
  lastTopic?: { key: string; at: number }
  /** "Você quis dizer…?": opções oferecidas e a frase original (aprendida quando o cliente escolhe). */
  choice?: { text: string; options: { key: string; title: string }[] }
  /** Itens esperando o cliente escolher o tamanho. */
  pendingSize?: { productId: string; qty: number; extras: string[] }[]
  /** Tipo da última resposta (usado para marcar as mensagens do bot). */
  lastKind?: ReplyKind
  unread: number
  messages: ChatMessage[]
  updatedAt: string
}

export type OrderStatus = 'novo' | 'confirmado' | 'preparando' | 'enviado' | 'concluido' | 'cancelado'

export const ORDER_STATUSES: OrderStatus[] = ['novo', 'confirmado', 'preparando', 'enviado', 'concluido', 'cancelado']

export interface Order {
  id: string
  number: number
  chatId: string
  channel: Channel
  customerName: string
  address: string
  /** Forma de pagamento informada na conversa. */
  payment?: string
  /** Taxa de entrega somada ao total (quando cadastrada como valor). */
  deliveryFee?: number
  items: CartItem[]
  total: number
  status: OrderStatus
  createdAt: string
  updatedAt: string
}

export interface AiResult {
  text: string
  handoff: boolean
  /** A IA não tinha a informação: a pergunta vai para a fila de treino do cliente. */
  missing?: boolean
}

/** Gera a resposta livre da IA para a última mensagem da conversa. */
export type AiResponder = (tenant: TenantConfig, conversation: Conversation) => Promise<AiResult>
