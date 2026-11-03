import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { BotManager } from '../src/channels/whatsapp.js'
import { Engine } from '../src/engine/engine.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { createPanel } from '../src/panel/server.js'
import { Store } from '../src/store.js'

const ADMIN_PASSWORD = 'senha-admin-teste'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-panel-'))
const store = new Store(dir)
const knowledge = new KnowledgeBase(path.join(dir, 'knowledge.db'))
knowledge.syncFromDir(path.resolve('knowledge/packs'))
const engine = new Engine({ store, knowledge, random: () => 0 })

// WhatsApp falso: registra o que o painel pediu, sem abrir navegador
const stopped: string[] = []
const bots = {
  info: () => ({ status: 'stopped' }),
  start: async () => {},
  stop: async (id: string) => { stopped.push(id) },
  send: async () => {},
} as unknown as BotManager

let base = ''
let server: ReturnType<ReturnType<typeof createPanel>['listen']>

/** Cliente HTTP com cookie próprio (cada "navegador" tem a sua sessão). */
function browser () {
  let cookie = ''
  return async (method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, data: await res.json().catch(() => ({})) as any }
  }
}

const admin = browser()
const clientA = browser()

before(async () => {
  const app = createPanel({ store, engine, bots, knowledge, adminPassword: ADMIN_PASSWORD, sessionSecret: 'x'.repeat(40) })
  server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  assert.equal((await admin('POST', '/api/login', { tenantId: 'admin', password: ADMIN_PASSWORD })).status, 200)
  for (const [id, name] of [['cliente-a', 'Cliente A'], ['cliente-b', 'Cliente B']]) {
    const r = await admin('POST', '/api/tenants', { id, name, password: 'senha-do-cliente', segment: 'restaurante' })
    assert.equal(r.status, 201)
  }
  assert.equal((await clientA('POST', '/api/login', { tenantId: 'cliente-a', password: 'senha-do-cliente' })).status, 200)
})

after(async () => {
  server.close()
  await store.flush()
  knowledge.close()
})

describe('Painel: Super Admin x cliente', () => {
  it('cliente sem permissão não altera nada da configuração (só a própria senha)', async () => {
    const before = (await clientA('GET', '/api/tenants/cliente-a/config')).data
    const r = await clientA('PUT', '/api/tenants/cliente-a/config', {
      ...before,
      menu: [{ key: '9', label: 'Hackeado', type: 'text', text: 'x' }],
      products: [{ name: 'Produto pirata', price: 1, active: true }],
      business: { ...before.business, hours: '24h' },
      ai: { enabled: false, instructions: 'x' },
      newPassword: 'nova-senha-123',
    })
    assert.equal(r.status, 200)
    const t = store.getTenant('cliente-a')!
    assert.equal(t.menu[0].label, before.menu[0].label)
    assert.equal(t.products.length, 0)
    assert.notEqual(t.business.hours, '24h')
    assert.equal(t.ai.enabled, before.ai.enabled)
    // a senha nova vale
    assert.equal((await browser()('POST', '/api/login', { tenantId: 'cliente-a', password: 'nova-senha-123' })).status, 200)
  })

  it('com permissão de produtos, o cliente edita só os produtos', async () => {
    assert.equal((await admin('PATCH', '/api/tenants/cliente-a/admin', { clientCan: { info: false, products: true } })).status, 200)
    const cfg = (await clientA('GET', '/api/tenants/cliente-a/config')).data
    await clientA('PUT', '/api/tenants/cliente-a/config', {
      ...cfg,
      products: [{ name: 'Pizza Nova', price: 45, active: true }],
      business: { ...cfg.business, hours: '24h' },
    })
    const t = store.getTenant('cliente-a')!
    assert.deepEqual(t.products.map(p => [p.name, p.price]), [['Pizza Nova', 45]])
    assert.notEqual(t.business.hours, '24h')
  })

  it('com permissão de informações, o cliente edita horário e variáveis da base de conhecimento', async () => {
    await admin('PATCH', '/api/tenants/cliente-a/admin', { clientCan: { info: true, products: false } })
    const cfg = (await clientA('GET', '/api/tenants/cliente-a/config')).data
    await clientA('PUT', '/api/tenants/cliente-a/config', {
      ...cfg,
      business: { ...cfg.business, hours: '18h às 23h' },
      knowledge: { packs: ['comum'], variables: { chave_pix: 'pix@cliente-a.com' }, overrides: { 'comum/pix': { enabled: false } } },
    })
    const t = store.getTenant('cliente-a')!
    assert.equal(t.business.hours, '18h às 23h')
    assert.equal(t.knowledge?.variables.chave_pix, 'pix@cliente-a.com')
    assert.deepEqual(t.knowledge?.packs, ['comum', 'restaurante']) // pacotes continuam com o Super Admin
    assert.deepEqual(t.knowledge?.overrides, {})
  })

  it('cliente não acessa outro cliente nem as funções do Super Admin', async () => {
    assert.equal((await clientA('GET', '/api/tenants/cliente-b/config')).status, 403)
    assert.equal((await clientA('PATCH', '/api/tenants/cliente-a/admin', { suspended: false, clientCan: { info: true, products: true } })).status, 403)
    assert.equal((await clientA('GET', '/api/requests')).status, 403)
    assert.equal((await clientA('GET', '/api/knowledge/packs/comum/export')).status, 403)
    assert.equal((await clientA('POST', '/api/tenants/cliente-b/impersonate')).status, 403)
    assert.equal((await clientA('POST', '/api/tenants', { id: 'novo', name: 'Novo' })).status, 403)
    const me = (await clientA('GET', '/api/me')).data
    assert.deepEqual(me.clientCan, { info: true, products: false })
  })

  it('pedido de ajuste: cliente pede, Super Admin vê de todos, responde e o uso do mês é contado', async () => {
    const r = await clientA('POST', '/api/tenants/cliente-a/requests', { text: 'Mudar o preço da calabresa para R$ 55' })
    assert.equal(r.status, 201)
    assert.equal((await clientA('POST', '/api/tenants/cliente-a/requests', { text: 'oi' })).status, 400)

    const all = (await admin('GET', '/api/requests')).data
    const mine = all.find((x: any) => x.id === r.data.id)
    assert.equal(mine.tenantName, 'Cliente A')
    assert.equal(mine.status, 'aberto')

    assert.equal((await clientA('PATCH', `/api/tenants/cliente-a/requests/${r.data.id}`, { status: 'feito' })).status, 403)
    await admin('PATCH', `/api/tenants/cliente-a/requests/${r.data.id}`, { status: 'feito', note: 'Feito! Já está no ar.' })

    const view = (await clientA('GET', '/api/tenants/cliente-a/requests')).data
    assert.equal(view.requests[0].status, 'feito')
    assert.equal(view.requests[0].note, 'Feito! Já está no ar.')
    assert.equal(view.usage, 1)
    assert.equal(view.plan.adjustmentsPerMonth, 5)
  })

  it('suspender: desliga o WhatsApp, bloqueia o painel e o bot do cliente; reativar devolve tudo', async () => {
    await admin('PATCH', '/api/tenants/cliente-a/admin', { suspended: true })
    assert.ok(stopped.includes('cliente-a'))

    const blocked = await clientA('GET', '/api/tenants/cliente-a/conversations')
    assert.equal(blocked.status, 403)
    assert.equal(blocked.data.suspended, true)
    assert.equal((await browser()('POST', '/api/login', { tenantId: 'cliente-a', password: 'nova-senha-123' })).status, 403)
    assert.equal((await admin('POST', '/api/tenants/cliente-a/bot/start')).status, 403)
    const sim = await admin('POST', '/api/tenants/cliente-a/simulate', { text: 'oi' })
    assert.deepEqual(sim.data.replies, []) // bot não responde

    // o outro cliente continua normal
    assert.equal((await admin('POST', '/api/tenants/cliente-b/simulate', { text: 'oi' })).data.replies.length, 1)

    await admin('PATCH', '/api/tenants/cliente-a/admin', { suspended: false })
    assert.equal((await clientA('GET', '/api/tenants/cliente-a/conversations')).status, 200)
  })

  it('ver como cliente: Super Admin entra no painel do cliente e volta', async () => {
    const support = browser()
    await support('POST', '/api/login', { tenantId: 'admin', password: ADMIN_PASSWORD })
    assert.equal((await support('POST', '/api/tenants/cliente-b/impersonate')).status, 200)
    const me = (await support('GET', '/api/me')).data
    assert.equal(me.role, 'tenant')
    assert.equal(me.tenantId, 'cliente-b')
    assert.equal(me.impersonating, true)
    assert.equal((await support('GET', '/api/tenants/cliente-a/config')).status, 403) // enxerga só aquele cliente

    assert.equal((await support('POST', '/api/impersonate/stop')).status, 200)
    assert.equal((await support('GET', '/api/me')).data.role, 'admin')
    assert.equal((await clientA('POST', '/api/impersonate/stop')).status, 400) // cliente comum não vira admin
  })
})
