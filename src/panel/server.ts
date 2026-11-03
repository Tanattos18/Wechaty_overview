import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'
import QRCode from 'qrcode'
import type { BotManager } from '../channels/whatsapp.js'
import type { Engine } from '../engine/engine.js'
import { BUILTIN_VARIABLES, tenantKnowledge, type KnowledgeBase } from '../knowledge/kb.js'
import { isValidTenantId, type Store } from '../store.js'
import { newTenant, sanitizeTenant } from '../tenant-template.js'
import { ORDER_STATUSES, type Conversation, type OrderStatus, type TenantConfig } from '../types.js'
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
  const auth = new Auth(deps.sessionSecret)
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
    auth.issue(res, session)
    res.json({ ok: true })
  })

  app.post('/api/logout', (_req, res) => { auth.clear(res); res.json({ ok: true }) })

  app.get('/api/me', auth.required, (_req, res) => {
    res.json(res.locals.session)
  })

  // ---------- clientes ----------

  app.get('/api/tenants', auth.required, (_req, res) => {
    const session = res.locals.session as Session
    const list = store.listTenants()
      .filter(t => session.role === 'admin' || t.id === session.tenantId)
      .map(t => ({ id: t.id, name: t.name, active: t.active, bot: bots.info(t.id).status }))
    res.json(list)
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
    const updated = sanitizeTenant(req.body, tenant)
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
    res.json({ chatId, replies })
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
  app.get('/api/knowledge/packs/:packId/export', auth.required, (req, res) => {
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

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }) })

  return app
}
