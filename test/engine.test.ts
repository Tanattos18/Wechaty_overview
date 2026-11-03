import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Engine } from '../src/engine/engine.js'
import { Store } from '../src/store.js'
import { newTenant } from '../src/tenant-template.js'
import type { AiResponder, TenantConfig } from '../src/types.js'

/** 12:00 UTC = 9h em Brasília ("Bom dia"). Sorteio fixo: sempre a primeira variação de cada frase. */
function setup (ai?: AiResponder, now = () => new Date('2026-11-02T12:00:00Z'), style: TenantConfig['style'] = 'human') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-test-'))
  const store = new Store(dir)
  const tenant = newTenant('loja', 'Loja Teste')
  tenant.style = style
  tenant.products = [
    { id: 'a', name: 'Pizza', price: 50, active: true },
    { id: 'b', name: 'Inativo', price: 1, active: false },
    { id: 'c', name: 'Refri', price: 10.5, active: true },
  ]
  tenant.ai.enabled = Boolean(ai)
  store.saveTenant(tenant)
  const orders: string[] = []
  const engine = new Engine({ store, ai, now, random: () => 0, onOrder: (_t, id) => orders.push(id) })
  const say = (text: string, chatId = 'c1') =>
    engine.handle({ tenantId: 'loja', chatId, name: 'Maria Silva', text, channel: 'simulator' })
  return { store, engine, say, orders }
}

describe('Engine', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => { t = setup() })

  it('cumprimenta pelo horário e pelo nome, sem menu numerado no estilo humano', async () => {
    const [reply] = await t.say('Olá!')
    assert.equal(reply, 'Bom dia, Maria! 😊 Aqui é da *Loja Teste*. Como posso te ajudar?')
    assert.equal(t.store.findConversation('loja', 'c1')?.state, 'menu')
  })

  it('no estilo "menu" mostra as opções numeradas nas boas-vindas', async () => {
    t = setup(undefined, undefined, 'menu')
    const [reply] = await t.say('oi')
    assert.match(reply, /\*1\* - Ver catálogo/)
  })

  it('"menu" mostra as opções em qualquer estilo', async () => {
    await t.say('oi')
    assert.match((await t.say('menu'))[0], /\*4\* - Falar com atendente/)
  })

  it('faz um pedido completo pelo catálogo', async () => {
    await t.say('oi')
    const [catalog] = await t.say('1')
    assert.match(catalog, /\*1\* - Pizza/)
    assert.match(catalog, /\*2\* - Refri/) // produto inativo não aparece
    assert.doesNotMatch(catalog, /Inativo/)

    const [added] = await t.say('1 x2')
    assert.match(added, /Anotado! ✅ 2x Pizza/)
    await t.say('2')
    assert.match((await t.say('finalizar'))[0], /no nome de \*Maria\*/)
    assert.match((await t.say('Joana'))[0], /Prazer, Joana!.*endereço/s)
    const [summary] = await t.say('Rua A, 10')
    assert.match(summary, /Total: R\$\s?110,50/)
    assert.match(summary, /Posso confirmar\?/)
    const [done] = await t.say('sim')
    assert.match(done, /Pedido \*#1\* confirmado! Obrigado, Joana/)

    const [order] = t.store.listOrders('loja')
    assert.equal(order.total, 110.5)
    assert.equal(order.address, 'Rua A, 10')
    assert.deepEqual(order.items.map(i => [i.name, i.qty]), [['Pizza', 2], ['Refri', 1]])
    assert.deepEqual(t.orders, [order.id])
    assert.equal(t.store.findConversation('loja', 'c1')?.cart.length, 0)
  })

  it('"retirar" no endereço vira retirada no local', async () => {
    await t.say('oi'); await t.say('1'); await t.say('1'); await t.say('finalizar'); await t.say('Ana')
    await t.say('vou buscar ai')
    await t.say('sim')
    assert.equal(t.store.listOrders('loja')[0].address, 'Retirada no local')
  })

  it('não finaliza com carrinho vazio e aceita cancelar', async () => {
    await t.say('oi'); await t.say('1')
    assert.match((await t.say('finalizar'))[0], /vazio/)
    await t.say('1')
    assert.match((await t.say('cancelar'))[0], /cancelei o pedido/)
    assert.equal(t.store.findConversation('loja', 'c1')?.cart.length, 0)
  })

  it('transfere para atendente, fica em silêncio e volta após o tempo limite', async () => {
    let now = new Date('2026-11-02T12:00:00Z')
    t = setup(undefined, () => now)
    await t.say('oi')
    const [handoff] = await t.say('4')
    assert.match(handoff, /alguém da equipe/)
    const conv = t.store.findConversation('loja', 'c1')!
    assert.equal(conv.needsAgent, true)
    assert.deepEqual(await t.say('alô?'), [])

    now = new Date('2026-11-02T12:31:00Z') // humanTimeoutMin = 30
    assert.match((await t.say('menu'))[0], /\*1\*/)
    assert.equal(conv.state, 'menu')
  })

  it('release do painel devolve a conversa ao bot', async () => {
    await t.say('oi'); await t.say('atendente')
    const conv = t.store.findConversation('loja', 'c1')!
    const msg = t.engine.release(t.store.getTenant('loja')!, conv)
    assert.match(msg, /Voltei por aqui! 😊 Como posso te ajudar\?/)
    assert.equal(conv.state, 'menu')
    assert.equal(conv.needsAgent, false)
  })

  it('sem entender, pede para explicar de outro jeito e na segunda vez oferece o atendente', async () => {
    await t.say('oi')
    const [reply] = await t.say('blablabla xyz')
    assert.match(reply, /não entendi direito.*outro jeito/s)
    assert.match(reply, /Por aqui eu consigo te ajudar a ver catálogo/)
    assert.doesNotMatch(reply, /\*1\*/) // sem menu numerado
    const [again] = await t.say('qwerty asdf')
    assert.match(again, /digite \*atendente\*/)
  })

  it('com IA, texto livre usa a IA e respeita a transferência', async () => {
    const calls: string[] = []
    const ai: AiResponder = async (_tenant, conv) => {
      const last = conv.messages.at(-1)!.text
      calls.push(last)
      return last.includes('errado')
        ? { text: 'Sinto muito!', handoff: true }
        : { text: 'Abrimos sim, das 18h às 23h.', handoff: false }
    }
    t = setup(ai)
    const [first] = await t.say('vocês abrem feriado?')
    assert.match(first, /^Bom dia, Maria! 😊 Abrimos sim/)
    const replies = await t.say('meu pedido de ontem veio errado')
    assert.equal(replies[0], 'Sinto muito!')
    assert.match(replies[1], /alguém da equipe/)
    assert.equal(t.store.findConversation('loja', 'c1')?.state, 'human')
    assert.equal(calls.length, 2)
  })

  it('se a IA falhar, cai no fallback sem quebrar', async () => {
    t = setup(async () => { throw new Error('rede') })
    await t.say('oi')
    assert.match((await t.say('pergunta qualquer'))[0], /não entendi/)
  })

  it('mensagem que não é texto recebe aviso', async () => {
    assert.match((await t.say(''))[0], /só consigo ler mensagens de texto/)
  })

  it('separa as conversas por contato', async () => {
    await t.say('oi', 'a'); await t.say('1', 'a')
    await t.say('oi', 'b')
    assert.equal(t.store.findConversation('loja', 'a')?.state, 'catalog')
    assert.equal(t.store.findConversation('loja', 'b')?.state, 'menu')
  })
})
