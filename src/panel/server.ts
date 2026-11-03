import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'
import QRCode from 'qrcode'
import type { BotManager } from '../channels/whatsapp.js'
import type { Engine } from '../engine/engine.js'
import { BUILTIN_VARIABLES, tenantKnowledge, type KnowledgeBase } from '../knowledge/kb.js'
import { exportConversations, qualityStats, runQa, runSavedTests } from '../quality/quality.js'
import { replay } from '../quality/replay.js'
import { isValidTenantId, type SavedTest, type Store } from '../store.js'
import { newTenant, sanitizeTenant } from '../tenant-template.js'
import {
  ADJUSTMENT_STATUSES, DEFAULT_PLAN, ORDER_STATUSES,
  type ClientPermissions, type Conversation, type OrderStatus, type TenantConfig,
} from '../types.js'
import { Auth, hashPassword, safeEqual, verifyPassword, type Session } from './auth.js'

export interface PanelDeps {
  store: Store
  engine: Engine
  bots: BotManager
  knowledge: KnowledgeBase
  adminPassword: string
  sessionSecret: string
}

const here = path.dirname(fileURLToPath(import.meta.url))
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }) // AAAA-MM-DD
const ADMIN_LOGIN = 'admin'

/** Remove o hash da senha antes de mandar ao navegador. */
function publicTenant (t: TenantConfig) {
  const { panelPasswordHash, ...rest } = t
  return { ...rest, hasPassword: Boolean(panelPasswordHash) }
}

function conversationSummary (c: Conversation) {
  const last = c.messages.at(-1)
  return {
    chatId: c.chatId,
    name: c.name,
    channel: c.channel,
    state: c.state,
    needsAgent: c.needsAgent,
    unread: c.unread,
    updatedAt: c.updatedAt,
    lastMessage: last ? { from: last.from, text: last.text.slice(0, 120) } : null,
  }
}

export function createPanel (deps: PanelDeps) {
  const { store, engine, bots } = deps
  const auth = new Auth(deps.sessionSecret, id => Boolean(store.getTenant(id)?.suspended))
  const app = express()
  app.disable('x-powered-by')
  // Atrás do Nginx (VPS): usa o IP real do visitante no limite de tentativas de login
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)
  app.use(express.json({ limit: '5mb' })) // pacotes de conhecimento importados podem ser grandes
  app.use(express.static(path.join(here, 'public')))

  const tenantOr404 = (req: Request, res: Response): TenantConfig | undefined => {
    const tenant = store.getTenant(String(req.params.tenantId))
    if (!tenant) res.status(404).json({ error: 'Cliente não encontrado.' })
    return tenant
  }

  // ---------- marca (pública: usada na tela de login) ----------

  const brand = {
    name: (process.env.BRAND_NAME ?? '').trim().slice(0, 40) || 'Akylla Bot',
    color: /^#[0-9a-f]{6}$/i.test(process.env.BRAND_COLOR ?? '') ? process.env.BRAND_COLOR! : '#0f9d7a',
  }
  app.get('/api/brand', (_req, res) => { res.json(brand) })

  // ---------- login ----------

  const failures = new Map<string, { count: number; until: number }>()
  app.post('/api/login', (req, res) => {
    const ip = req.ip ?? 'local'
    const f = failures.get(ip)
    if (f && f.count >= 5 && f.until > Date.now()) {
      res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' })
      return
    }
    const tenantId = String(req.body?.tenantId ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')

    // Administrador: ID em branco ou "admin"
    const asAdmin = !tenantId || tenantId === ADMIN_LOGIN
    let session: Omit<Session, 'exp'> | undefined
    if (asAdmin && deps.adminPassword && safeEqual(password, deps.adminPassword)) {
      session = { role: 'admin' }
    } else if (!asAdmin && verifyPassword(password, store.getTenant(tenantId)?.panelPasswordHash)) {
      session = { role: 'tenant', tenantId }
    }
    if (!session) {
      const prev = f && f.until > Date.now() ? f.count : 0
      failures.set(ip, { count: prev + 1, until: Date.now() + 60_000 })
      res.status(401).json({ error: 'Usuário ou senha inválidos.' })
      return
    }
    failures.delete(ip)
    if (session.role === 'tenant' && store.getTenant(tenantId)?.suspended) {
      res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o suporte.' })
      return
    }
    auth.issue(res, session)
    res.json({ ok: true })
  })

  app.post('/api/logout', (_req, res) => { auth.clear(res); res.json({ ok: true }) })

  app.get('/api/me', auth.required, (_req, res) => {
    const session = res.locals.session as Session
    if (session.role === 'admin') { res.json(session); return }
    const tenant = store.getTenant(session.tenantId ?? '')
    res.json({
      ...session,
      tenantName: tenant?.name,
      clientCan: permissions(tenant),
      plan: tenant?.plan ?? DEFAULT_PLAN,
      usage: tenant ? adjustmentsThisMonth(tenant.id) : 0,
    })
  })

  // ---------- clientes ----------

  const permissions = (t?: TenantConfig): ClientPermissions => ({ info: false, products: false, ...t?.clientCan })

  /** Ajustes pedidos no mês corrente (os recusados não contam no pacote). */
  const adjustmentsThisMonth = (tenantId: string) => {
    const month = new Date().toISOString().slice(0, 7)
    return store.listRequests(tenantId).filter(r => r.createdAt.startsWith(month) && r.status !== 'recusado').length
  }

  app.get('/api/tenants', auth.required, (_req, res) => {
    const session = res.locals.session as Session
    const list = store.listTenants()
      .filter(t => session.role === 'admin' || t.id === session.tenantId)
      .map(t => ({
        id: t.id,
        name: t.name,
        active: t.active,
        bot: bots.info(t.id).status,
        ...(session.role === 'admin' ? {
          suspended: Boolean(t.suspended),
          clientCan: permissions(t),
          plan: t.plan ?? DEFAULT_PLAN,
          usage: adjustmentsThisMonth(t.id),
          openRequests: store.listRequests(t.id).filter(r => r.status === 'aberto' || r.status === 'andamento').length,
          hasPassword: Boolean(t.panelPasswordHash),
          conversations: store.listConversations(t.id).length,
        } : {}),
      }))
    res.json(list)
  })

  /** Super Admin: suspender/reativar, permissões do cliente e plano. */
  app.patch('/api/tenants/:tenantId/admin', auth.required, auth.adminOnly, async (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const b = req.body ?? {}
    const updated: TenantConfig = { ...tenant }
    if (typeof b.suspended === 'boolean') updated.suspended = b.suspended
    if (b.clientCan && typeof b.clientCan === 'object') {
      updated.clientCan = { info: b.clientCan.info === true, products: b.clientCan.products === true }
    }
    if (b.plan && typeof b.plan === 'object') {
      updated.plan = {
        name: String(b.plan.name ?? DEFAULT_PLAN.name).trim().slice(0, 40) || DEFAULT_PLAN.name,
        adjustmentsPerMonth: Math.max(0, Math.min(999, Math.round(Number(b.plan.adjustmentsPerMonth) || 0))),
      }
    }
    store.saveTenant(updated)
    if (updated.suspended && !tenant.suspended) await bots.stop(tenant.id) // suspenso: desliga o WhatsApp
    res.json(publicTenant(updated))
  })

  /** Super Admin entra no painel como o cliente, para dar suporte. */
  app.post('/api/tenants/:tenantId/impersonate', auth.required, auth.adminOnly, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    auth.issue(res, { role: 'tenant', tenantId: tenant.id, impersonating: true })
    res.json({ ok: true })
  })

  app.post('/api/impersonate/stop', auth.required, (_req, res) => {
    const session = res.locals.session as Session
    if (!session.impersonating) { res.status(400).json({ error: 'Você não está vendo como cliente.' }); return }
    auth.issue(res, { role: 'admin' })
    res.json({ ok: true })
  })

  app.post('/api/tenants', auth.required, auth.adminOnly, (req, res) => {
    const id = String(req.body?.id ?? '').trim().toLowerCase()
    const name = String(req.body?.name ?? '').trim()
    if (!isValidTenantId(id)) { res.status(400).json({ error: 'ID inválido: use letras minúsculas, números e hífen.' }); return }
    if (id === ADMIN_LOGIN) { res.status(400).json({ error: '"admin" é reservado para o administrador.' }); return }
    if (!name) { res.status(400).json({ error: 'Informe o nome do negócio.' }); return }
    if (store.getTenant(id)) { res.status(409).json({ error: 'Já existe um cliente com esse ID.' }); return }
    const segment = String(req.body?.segment ?? '')
    const tenant = newTenant(id, name, deps.knowledge.getPack(segment) ? segment : undefined)
    const password = String(req.body?.password ?? '')
    if (password) tenant.panelPasswordHash = hashPassword(password)
    store.saveTenant(tenant)
    res.status(201).json(publicTenant(tenant))
  })

  app.get('/api/tenants/:tenantId/config', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(publicTenant(tenant))
  })

  app.put('/api/tenants/:tenantId/config', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const session = res.locals.session as Session
    const sanitized = sanitizeTenant(req.body, tenant)
    let updated = sanitized
    if (session.role === 'tenant') {
      // O cliente só altera o que o Super Admin liberou; o resto continua como está
      const can = permissions(tenant)
      updated = { ...tenant }
      if (can.info) {
        updated.business = sanitized.business
        updated.knowledge = { ...(tenant.knowledge ?? sanitized.knowledge!), variables: sanitized.knowledge!.variables }
      }
      if (can.products) {
        updated.products = sanitized.products
        updated.halfHalf = sanitized.halfHalf
        updated.synonyms = sanitized.synonyms
      }
    }
    const newPassword = String(req.body?.newPassword ?? '')
    if (newPassword) {
      if (newPassword.length < 8) { res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }); return }
      updated.panelPasswordHash = hashPassword(newPassword)
    }
    store.saveTenant(updated)
    res.json(publicTenant(updated))
  })

  // ---------- conexão WhatsApp ----------

  app.get('/api/tenants/:tenantId/bot', auth.required, async (req, res) => {
    const info = bots.info(String(req.params.tenantId))
    const qrImage = info.qr ? await QRCode.toDataURL(info.qr, { margin: 1, width: 280 }) : undefined
    res.json({ status: info.status, user: info.user, error: info.error, qrImage })
  })

  app.post('/api/tenants/:tenantId/bot/start', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    if (tenant.suspended) { res.status(403).json({ error: 'Cliente suspenso: reative para conectar o WhatsApp.' }); return }
    bots.start(tenant.id).catch(err => console.error(`[bot] ${tenant.id} não iniciou:`, err?.message ?? err))
    res.json({ ok: true })
  })

  app.post('/api/tenants/:tenantId/bot/stop', auth.required, async (req, res) => {
    await bots.stop(String(req.params.tenantId))
    res.json({ ok: true })
  })

  // ---------- conversas ----------

  app.get('/api/tenants/:tenantId/conversations', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(store.listConversations(tenant.id).map(conversationSummary))
  })

  const findConv = (req: Request, res: Response) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return undefined
    const conv = store.findConversation(tenant.id, String(req.params.chatId))
    if (!conv) { res.status(404).json({ error: 'Conversa não encontrada.' }); return undefined }
    return { tenant, conv }
  }

  app.get('/api/tenants/:tenantId/conversations/:chatId', auth.required, (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    found.conv.unread = 0
    store.saveConversations(found.tenant.id)
    res.json({ ...conversationSummary(found.conv), messages: found.conv.messages, cart: found.conv.cart })
  })

  const sendToCustomer = async (tenant: TenantConfig, conv: Conversation, text: string, from: 'agent' | 'bot') => {
    if (conv.channel === 'whatsapp') await bots.send(tenant.id, conv.chatId, text)
    store.appendMessage(conv, from, text)
    store.saveConversations(tenant.id)
  }

  app.post('/api/tenants/:tenantId/conversations/:chatId/reply', auth.required, async (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    const text = String(req.body?.text ?? '').trim().slice(0, 4000)
    if (!text) { res.status(400).json({ error: 'Mensagem vazia.' }); return }
    try {
      engine.takeOver(found.conv) // responder pelo painel já assume a conversa
      await sendToCustomer(found.tenant, found.conv, text, 'agent')
      res.json({ ok: true })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Falha ao enviar.' })
    }
  })

  app.post('/api/tenants/:tenantId/conversations/:chatId/takeover', auth.required, (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    engine.takeOver(found.conv)
    store.saveConversations(found.tenant.id)
    res.json({ ok: true })
  })

  app.post('/api/tenants/:tenantId/conversations/:chatId/release', auth.required, async (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    try {
      await sendToCustomer(found.tenant, found.conv, engine.release(found.tenant, found.conv), 'bot')
      res.json({ ok: true })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Falha ao enviar.' })
    }
  })

  // ---------- pedidos ----------

  app.get('/api/tenants/:tenantId/orders', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(store.listOrders(tenant.id))
  })

  app.patch('/api/tenants/:tenantId/orders/:orderId', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const order = store.findOrder(tenant.id, String(req.params.orderId))
    if (!order) { res.status(404).json({ error: 'Pedido não encontrado.' }); return }
    const status = req.body?.status as OrderStatus
    if (!ORDER_STATUSES.includes(status)) { res.status(400).json({ error: 'Status inválido.' }); return }
    order.status = status
    order.updatedAt = new Date().toISOString()
    store.saveOrders(tenant.id)
    res.json(order)
  })

  // ---------- simulador ----------

  app.post('/api/tenants/:tenantId/simulate', auth.required, async (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const raw = String(req.body?.chatId ?? '')
    const chatId = /^sim:[a-z0-9]{4,32}$/.test(raw) ? raw : `sim:${crypto.randomBytes(4).toString('hex')}`
    const replies = await engine.handle({
      tenantId: tenant.id,
      chatId,
      name: String(req.body?.name ?? 'Cliente Teste').slice(0, 60),
      text: String(req.body?.text ?? '').slice(0, 4000),
      channel: 'simulator',
    })
    const kind = store.getConversation(tenant.id, chatId, '', 'simulator').lastKind
    res.json({ chatId, replies, kind })
  })

  // ---------- base de conhecimento ----------

  const { knowledge } = deps

  app.get('/api/knowledge/packs', auth.required, (_req, res) => {
    res.json({ packs: knowledge.listPacks(), builtinVariables: BUILTIN_VARIABLES })
  })

  app.get('/api/knowledge/packs/:packId', auth.required, (req, res) => {
    const pack = knowledge.getPack(String(req.params.packId))
    if (!pack) { res.status(404).json({ error: 'Pacote não encontrado.' }); return }
    res.json(pack)
  })

  /** Baixa o pacote como arquivo JSON, para importar em outra instalação. */
  app.get('/api/knowledge/packs/:packId/export', auth.required, auth.adminOnly, (req, res) => {
    const pack = knowledge.getPack(String(req.params.packId))
    if (!pack) { res.status(404).json({ error: 'Pacote não encontrado.' }); return }
    res.setHeader('Content-Disposition', `attachment; filename="conhecimento-${pack.id}-v${pack.version}.json"`)
    res.type('application/json').send(JSON.stringify(pack, null, 2))
  })

  app.post('/api/knowledge/packs', auth.required, auth.adminOnly, (req, res) => {
    try {
      const pack = knowledge.importPack(req.body)
      res.status(201).json({ id: pack.id, name: pack.name, topics: pack.topics.length })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Pacote inválido.' })
    }
  })

  app.delete('/api/knowledge/packs/:packId', auth.required, auth.adminOnly, (req, res) => {
    const packId = String(req.params.packId)
    if (packId === 'comum') { res.status(400).json({ error: 'O pacote comum não pode ser removido.' }); return }
    res.json({ ok: knowledge.deletePack(packId) })
  })

  /** Testa como o bot responderia uma pergunta, mostrando o assunto encontrado e a nota. */
  app.post('/api/tenants/:tenantId/knowledge/test', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const text = String(req.body?.text ?? '').slice(0, 500)
    const result = knowledge.match(tenant, text, 0.3)
    res.json({ result: result ?? null, threshold: 0.55, packs: tenantKnowledge(tenant).packs })
  })

  app.get('/api/tenants/:tenantId/knowledge/unanswered', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(knowledge.listUnanswered(tenant.id))
  })

  app.delete('/api/tenants/:tenantId/knowledge/unanswered/:id', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    knowledge.deleteUnanswered(tenant.id, Number(req.params.id))
    res.json({ ok: true })
  })

  // ---------- painel inicial ----------

  /** Números do dia e dos últimos 7 dias (horário de Brasília). */
  const stats = (tenant: TenantConfig) => {
    const day = (d: Date | string) => DAY_FMT.format(new Date(d))
    const today = day(new Date())
    const last7 = Array.from({ length: 7 }, (_, i) => day(new Date(Date.now() - (6 - i) * 86_400_000)))
    const conversations = store.listConversations(tenant.id).filter(c => c.channel === 'whatsapp' || c.channel === 'simulator')
    const orders = store.listOrders(tenant.id).filter(o => o.status !== 'cancelado')
    const messagesByDay = Object.fromEntries(last7.map(d => [d, 0]))
    const ordersByDay = Object.fromEntries(last7.map(d => [d, 0]))
    let conversationsToday = 0
    for (const c of conversations) {
      let talkedToday = false
      for (const m of c.messages) {
        if (m.from !== 'customer') continue
        const d = day(m.at)
        if (d in messagesByDay) messagesByDay[d]++
        if (d === today) talkedToday = true
      }
      if (talkedToday) conversationsToday++
    }
    for (const o of orders) {
      const d = day(o.createdAt)
      if (d in ordersByDay) ordersByDay[d]++
    }
    const todayOrders = orders.filter(o => day(o.createdAt) === today)
    return {
      conversationsToday,
      messagesToday: messagesByDay[today] ?? 0,
      ordersToday: todayOrders.length,
      revenueToday: Math.round(todayOrders.reduce((s, o) => s + o.total, 0) * 100) / 100,
      waitingAgent: conversations.filter(c => c.needsAgent).length,
      newOrders: store.listOrders(tenant.id).filter(o => o.status === 'novo').length,
      unanswered: deps.knowledge.listUnanswered(tenant.id).length,
      bot: bots.info(tenant.id).status,
      days: last7.map(d => ({ day: d, messages: messagesByDay[d], orders: ordersByDay[d] })),
    }
  }

  app.get('/api/tenants/:tenantId/stats', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(stats(tenant))
  })

  /** Resumo de todos os clientes para o Super Admin. */
  app.get('/api/overview', auth.required, auth.adminOnly, (_req, res) => {
    const tenants = store.listTenants()
    const each = tenants.map(t => ({ id: t.id, name: t.name, suspended: Boolean(t.suspended), ...stats(t) }))
    res.json({
      clients: tenants.length,
      online: each.filter(t => t.bot === 'online').length,
      suspended: each.filter(t => t.suspended).length,
      pendingRequests: tenants.reduce((s, t) => s + store.listRequests(t.id).filter(r => r.status === 'aberto' || r.status === 'andamento').length, 0),
      conversationsToday: each.reduce((s, t) => s + t.conversationsToday, 0),
      ordersToday: each.reduce((s, t) => s + t.ordersToday, 0),
      revenueToday: Math.round(each.reduce((s, t) => s + t.revenueToday, 0) * 100) / 100,
      tenants: each,
    })
  })

  // ---------- respostas rápidas do atendente ----------

  app.put('/api/tenants/:tenantId/quick-replies', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const list = Array.isArray(req.body?.quickReplies) ? req.body.quickReplies : []
    const quickReplies = list.filter((q: unknown) => typeof q === 'string' && q.trim()).map((q: string) => q.trim().slice(0, 500)).slice(0, 20)
    store.saveTenant({ ...tenant, quickReplies })
    res.json({ quickReplies })
  })

  // ---------- treinar o bot ----------

  /** 👎 numa resposta do bot: marca como errada e manda a pergunta do cliente para a fila "Treinar". */
  app.post('/api/tenants/:tenantId/conversations/:chatId/feedback', auth.required, (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    const i = found.conv.messages.findIndex(m => m.from === 'bot' && m.at === req.body?.at)
    if (i < 0) { res.status(404).json({ error: 'Mensagem não encontrada.' }); return }
    const msg = found.conv.messages[i]
    const bad = msg.feedback !== 'bad'
    msg.feedback = bad ? 'bad' : undefined
    const asked = found.conv.messages.slice(0, i).reverse().find(m => m.from === 'customer')
    if (bad && asked) deps.knowledge.logUnanswered(found.tenant.id, asked.text, 'resposta-errada')
    store.saveConversations(found.tenant.id)
    res.json({ feedback: msg.feedback ?? null })
  })

  /**
   * Ensina uma forma de perguntar para um assunto: só para este cliente ou,
   * se o Super Admin marcar, para todos os clientes (grava no pacote).
   */
  app.post('/api/tenants/:tenantId/knowledge/train', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const session = res.locals.session as Session
    const text = String(req.body?.text ?? '').trim()
    const key = String(req.body?.key ?? '')
    if (text.length < 2) { res.status(400).json({ error: 'Frase vazia.' }); return }
    if (!deps.knowledge.answerFor(tenant, key)) { res.status(400).json({ error: 'Assunto não encontrado.' }); return }
    const global = req.body?.global === true && session.role === 'admin'
    if (global) deps.knowledge.addPackQuestion(key, text)
    else engine.learn(tenant, key, text)
    if (req.body?.unansweredId) deps.knowledge.deleteUnanswered(tenant.id, Number(req.body.unansweredId))
    res.json({ ok: true, global })
  })

  // ---------- qualidade, bateria de testes e exportação ----------

  app.get('/api/tenants/:tenantId/quality', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(qualityStats(store, deps.knowledge, tenant))
  })

  app.post('/api/tenants/:tenantId/qa', auth.required, async (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(await runQa(deps.knowledge, tenant))
  })

  app.get('/api/tenants/:tenantId/conversations-export', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const format = req.query.format === 'json' ? 'json' : 'txt'
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))
    const date = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Disposition', `attachment; filename="conversas-${tenant.id}-${date}.${format}"`)
    res.type(format === 'json' ? 'application/json' : 'text/plain; charset=utf-8')
      .send(exportConversations(store, tenant, format, days))
  })

  // ---------- conversas salvas como teste ----------

  app.get('/api/tenants/:tenantId/tests', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(store.listTests(tenant.id))
  })

  /** Guarda a conversa como teste: as mensagens do cliente e as respostas que o bot dá hoje. */
  app.post('/api/tenants/:tenantId/conversations/:chatId/save-test', auth.required, async (req, res) => {
    const found = findConv(req, res)
    if (!found) return
    const messages = found.conv.messages.filter(m => m.from === 'customer').map(m => m.text).slice(-40)
    if (!messages.length) { res.status(400).json({ error: 'A conversa não tem mensagens do cliente.' }); return }
    const expected = await replay(found.tenant, deps.knowledge, messages)
    const test: SavedTest = {
      id: crypto.randomBytes(5).toString('hex'),
      title: String(req.body?.title ?? '').trim().slice(0, 80) || `Conversa com ${found.conv.name || 'cliente'}`,
      messages,
      expected,
      createdAt: new Date().toISOString(),
    }
    store.saveTests(found.tenant.id, [...store.listTests(found.tenant.id), test])
    res.status(201).json(test)
  })

  app.post('/api/tenants/:tenantId/tests/run', auth.required, async (req, res) => {
    const tenant = tenantOr404(req, res)
    if (tenant) res.json(await runSavedTests(deps.knowledge, tenant, store.listTests(tenant.id)))
  })

  /** A resposta nova está certa (mudança de propósito): passa a ser a esperada. */
  app.post('/api/tenants/:tenantId/tests/:id/accept', auth.required, async (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const list = store.listTests(tenant.id)
    const test = list.find(t => t.id === req.params.id)
    if (!test) { res.status(404).json({ error: 'Teste não encontrado.' }); return }
    test.expected = await replay(tenant, deps.knowledge, test.messages)
    store.saveTests(tenant.id, list)
    res.json(test)
  })

  app.delete('/api/tenants/:tenantId/tests/:id', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    store.saveTests(tenant.id, store.listTests(tenant.id).filter(t => t.id !== req.params.id))
    res.json({ ok: true })
  })

  // ---------- pedidos de ajuste ----------

  app.get('/api/tenants/:tenantId/requests', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    res.json({ requests: store.listRequests(tenant.id), plan: tenant.plan ?? DEFAULT_PLAN, usage: adjustmentsThisMonth(tenant.id) })
  })

  app.post('/api/tenants/:tenantId/requests', auth.required, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const text = String(req.body?.text ?? '').trim().slice(0, 2000)
    if (text.length < 5) { res.status(400).json({ error: 'Descreva o ajuste que você precisa.' }); return }
    const request = store.addRequest(tenant.id, text)
    console.log(`[ajuste] ${tenant.id} #${request.number}: ${text.slice(0, 80)}`)
    res.status(201).json(request)
  })

  /** Todos os pedidos de todos os clientes, para o Super Admin. */
  app.get('/api/requests', auth.required, auth.adminOnly, (_req, res) => {
    const all = store.listTenants().flatMap(t => store.listRequests(t.id).map(r => ({ ...r, tenantId: t.id, tenantName: t.name })))
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    res.json(all)
  })

  app.patch('/api/tenants/:tenantId/requests/:id', auth.required, auth.adminOnly, (req, res) => {
    const tenant = tenantOr404(req, res)
    if (!tenant) return
    const request = store.findRequest(tenant.id, String(req.params.id))
    if (!request) { res.status(404).json({ error: 'Pedido não encontrado.' }); return }
    if (req.body?.status !== undefined) {
      if (!ADJUSTMENT_STATUSES.includes(req.body.status)) { res.status(400).json({ error: 'Status inválido.' }); return }
      request.status = req.body.status
    }
    if (typeof req.body?.note === 'string') request.note = req.body.note.slice(0, 1000)
    request.updatedAt = new Date().toISOString()
    store.saveRequests(tenant.id)
    res.json(request)
  })

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }) })

  return app
}
