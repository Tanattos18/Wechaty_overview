import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AdjustmentRequest, Channel, ChatMessage, Conversation, Order, TenantConfig } from './types.js'

const MAX_MESSAGES_PER_CHAT = 300
const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

export function isValidTenantId (id: string): boolean {
  return TENANT_ID_RE.test(id)
}

interface Runtime {
  conversations: Map<string, Conversation>
  orders: Order[]
  requests: AdjustmentRequest[]
}

/**
 * Armazenamento em arquivos JSON:
 *   data/clients/<id>.json          configuração do cliente
 *   data/runtime/<id>/conversations.json
 *   data/runtime/<id>/orders.json
 * Os dados ficam em memória e são gravados com atraso curto (debounce) e de forma atômica.
 */
export class Store {
  private tenants = new Map<string, TenantConfig>()
  private runtimes = new Map<string, Runtime>()
  private timers = new Map<string, NodeJS.Timeout>()
  private pending = new Map<string, () => string>()

  constructor (readonly dataDir: string) {
    fs.mkdirSync(this.clientsDir, { recursive: true })
    fs.mkdirSync(this.runtimeDir, { recursive: true })
    for (const file of fs.readdirSync(this.clientsDir)) {
      if (!file.endsWith('.json')) continue
      const tenant = JSON.parse(fs.readFileSync(path.join(this.clientsDir, file), 'utf8')) as TenantConfig
      this.tenants.set(tenant.id, tenant)
    }
  }

  get clientsDir () { return path.join(this.dataDir, 'clients') }
  get runtimeDir () { return path.join(this.dataDir, 'runtime') }

  // ---------- clientes ----------

  listTenants (): TenantConfig[] {
    return [...this.tenants.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  getTenant (id: string): TenantConfig | undefined {
    return this.tenants.get(id)
  }

  saveTenant (tenant: TenantConfig): void {
    if (!isValidTenantId(tenant.id)) throw new Error(`ID de cliente inválido: ${tenant.id}`)
    this.tenants.set(tenant.id, tenant)
    this.schedule(path.join(this.clientsDir, `${tenant.id}.json`), () => JSON.stringify(tenant, null, 2))
  }

  // ---------- conversas ----------

  private runtime (tenantId: string): Runtime {
    let rt = this.runtimes.get(tenantId)
    if (!rt) {
      const dir = path.join(this.runtimeDir, tenantId)
      const conversations = readJson<Conversation[]>(path.join(dir, 'conversations.json'), [])
      const orders = readJson<Order[]>(path.join(dir, 'orders.json'), [])
      const requests = readJson<AdjustmentRequest[]>(path.join(dir, 'requests.json'), [])
      rt = { conversations: new Map(conversations.map(c => [c.chatId, c])), orders, requests }
      this.runtimes.set(tenantId, rt)
    }
    return rt
  }

  listConversations (tenantId: string): Conversation[] {
    return [...this.runtime(tenantId).conversations.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  findConversation (tenantId: string, chatId: string): Conversation | undefined {
    return this.runtime(tenantId).conversations.get(chatId)
  }

  getConversation (tenantId: string, chatId: string, name: string, channel: Channel): Conversation {
    const rt = this.runtime(tenantId)
    let conv = rt.conversations.get(chatId)
    if (!conv) {
      conv = {
        chatId,
        name,
        channel,
        state: 'idle',
        cart: [],
        checkout: {},
        needsAgent: false,
        unread: 0,
        messages: [],
        updatedAt: new Date().toISOString(),
      }
      rt.conversations.set(chatId, conv)
    } else if (name && conv.name !== name) {
      conv.name = name
    }
    return conv
  }

  appendMessage (conv: Conversation, from: ChatMessage['from'], text: string, at = new Date()): void {
    conv.messages.push({ from, text, at: at.toISOString() })
    if (conv.messages.length > MAX_MESSAGES_PER_CHAT) {
      conv.messages.splice(0, conv.messages.length - MAX_MESSAGES_PER_CHAT)
    }
    conv.updatedAt = at.toISOString()
  }

  saveConversations (tenantId: string): void {
    const rt = this.runtime(tenantId)
    this.schedule(path.join(this.runtimeDir, tenantId, 'conversations.json'),
      () => JSON.stringify([...rt.conversations.values()]))
  }

  // ---------- pedidos ----------

  listOrders (tenantId: string): Order[] {
    return [...this.runtime(tenantId).orders].sort((a, b) => b.number - a.number)
  }

  addOrder (tenantId: string, order: Omit<Order, 'id' | 'number'>): Order {
    const rt = this.runtime(tenantId)
    const number = rt.orders.reduce((max, o) => Math.max(max, o.number), 0) + 1
    const full: Order = { ...order, id: `${tenantId}-${number}`, number }
    rt.orders.push(full)
    this.saveOrders(tenantId)
    return full
  }

  findOrder (tenantId: string, orderId: string): Order | undefined {
    return this.runtime(tenantId).orders.find(o => o.id === orderId)
  }

  saveOrders (tenantId: string): void {
    const rt = this.runtime(tenantId)
    this.schedule(path.join(this.runtimeDir, tenantId, 'orders.json'), () => JSON.stringify(rt.orders, null, 2))
  }

  // ---------- pedidos de ajuste ----------

  listRequests (tenantId: string): AdjustmentRequest[] {
    return [...this.runtime(tenantId).requests].sort((a, b) => b.number - a.number)
  }

  addRequest (tenantId: string, text: string): AdjustmentRequest {
    const rt = this.runtime(tenantId)
    const number = rt.requests.reduce((max, r) => Math.max(max, r.number), 0) + 1
    const now = new Date().toISOString()
    const request: AdjustmentRequest = {
      id: `${tenantId}-a${number}`, number, text, status: 'aberto', note: '', createdAt: now, updatedAt: now,
    }
    rt.requests.push(request)
    this.saveRequests(tenantId)
    return request
  }

  findRequest (tenantId: string, id: string): AdjustmentRequest | undefined {
    return this.runtime(tenantId).requests.find(r => r.id === id)
  }

  saveRequests (tenantId: string): void {
    const rt = this.runtime(tenantId)
    this.schedule(path.join(this.runtimeDir, tenantId, 'requests.json'), () => JSON.stringify(rt.requests, null, 2))
  }

  // ---------- gravação ----------

  private schedule (file: string, serialize: () => string): void {
    this.pending.set(file, serialize)
    clearTimeout(this.timers.get(file))
    this.timers.set(file, setTimeout(() => { void this.write(file) }, 300))
  }

  private async write (file: string): Promise<void> {
    const serialize = this.pending.get(file)
    if (!serialize) return
    this.pending.delete(file)
    this.timers.delete(file)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fsp.writeFile(tmp, serialize(), 'utf8')
    await fsp.rename(tmp, file)
  }

  /** Grava tudo o que está pendente (usado ao encerrar o processo). */
  async flush (): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    await Promise.all([...this.pending.keys()].map(f => this.write(f)))
  }
}

function readJson<T> (file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
