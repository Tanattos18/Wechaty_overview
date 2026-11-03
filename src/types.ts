export type MenuOptionType = 'text' | 'catalog' | 'human' | 'ai'

export interface MenuOption {
  key: string
  label: string
  type: MenuOptionType
  /** Resposta fixa (usada quando type = 'text') */
  text?: string
}

export interface Product {
  id: string
  name: string
  price: number
  description?: string
  active: boolean
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
  /** Plano contratado: quantos ajustes por mês estão incluídos na mensalidade. */
  plan?: { name: string; adjustmentsPerMonth: number }
  /** Base de conhecimento: pacotes ativos, informações do negócio e respostas personalizadas. */
  knowledge?: {
    packs: string[]
    variables: Record<string, string>
    /** Chave "pacote/assunto" -> resposta própria ou assunto desativado */
    overrides: Record<string, { answer?: string; enabled?: boolean }>
  }
}

export type ChatState =
  | 'idle'
  | 'menu'
  | 'catalog'
  | 'checkout_name'
  | 'checkout_address'
  | 'checkout_confirm'
  | 'human'

export interface CartItem {
  productId: string
  name: string
  price: number
  qty: number
}

export interface ChatMessage {
  from: 'customer' | 'bot' | 'agent'
  text: string
  at: string
}

export type Channel = 'whatsapp' | 'simulator'

export interface Conversation {
  chatId: string
  name: string
  channel: Channel
  state: ChatState
  cart: CartItem[]
  checkout: { name?: string; address?: string }
  humanSince?: string
  needsAgent: boolean
  /** Mensagens seguidas que o bot não entendeu. */
  misses?: number
  /** Produto oferecido na última resposta ("Quer que eu anote uma?"): um "sim" já adiciona. */
  offer?: string
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
  items: CartItem[]
  total: number
  status: OrderStatus
  createdAt: string
  updatedAt: string
}

export interface AiResult {
  text: string
  handoff: boolean
}

/** Gera a resposta livre da IA para a última mensagem da conversa. */
export type AiResponder = (tenant: TenantConfig, conversation: Conversation) => Promise<AiResult>
