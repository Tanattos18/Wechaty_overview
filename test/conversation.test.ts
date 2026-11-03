import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Engine } from '../src/engine/engine.js'
import { findProduct, splitGreeting } from '../src/engine/nlu.js'
import { Store } from '../src/store.js'
import { newTenant } from '../src/tenant-template.js'

/** Conversas naturais sem IA, com dados parecidos com os da Pizzaria Demo. */
function setup () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-conv-'))
  const store = new Store(dir)
  const tenant = newTenant('pizza', 'Pizzaria Teste')
  tenant.ai.enabled = false
  tenant.business = {
    description: 'Pizzaria artesanal. Aceitamos Pix, cartão de crédito e débito.',
    hours: 'Terça a domingo, 18h às 23h',
    address: 'Rua Exemplo, 123 - Centro',
    phone: '(81) 99999-0000',
    extraInfo: 'Entrega em até 45 minutos no Centro. Taxa de entrega: R$ 5,00.\nTemos opção sem glúten (massa especial, +R$ 8,00).',
  }
  tenant.products = [
    { id: 'm', name: 'Pizza Margherita', price: 49.9, active: true },
    { id: 'c', name: 'Pizza Calabresa', price: 52.9, active: true },
    { id: 'q', name: 'Pizza Quatro Queijos', price: 58.9, active: true },
    { id: 'r', name: 'Refrigerante 2L', price: 12, active: true },
  ]
  store.saveTenant(tenant)
  const engine = new Engine({ store, random: () => 0, now: () => new Date('2026-11-02T20:00:00Z') }) // 17h em Brasília
  const say = async (text: string) =>
    (await engine.handle({ tenantId: 'pizza', chatId: 'c1', name: 'Maria Silva', text, channel: 'simulator' })).join('\n---\n')
  return { store, say, conv: () => store.findConversation('pizza', 'c1')! }
}

describe('Conversa natural (sem IA)', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => { t = setup() })

  it('responde "oi" a qualquer momento, não só no primeiro contato', async () => {
    await t.say('oi')
    await t.say('2') // abre uma opção do menu
    const reply = await t.say('Oi!')
    assert.match(reply, /^Oi, Maria!/)
    assert.match(reply, /Como posso te ajudar/)
    assert.doesNotMatch(reply, /não entendi/)
    for (const g of ['bom dia', 'Boa noite!!', 'olá, tudo bem?', 'oiee']) {
      assert.doesNotMatch(await t.say(g), /não entendi/, g)
    }
  })

  it('saudação repetida responde no mesmo tom, sem repetir as boas-vindas', async () => {
    await t.say('oi')
    await t.say('que horas abre?')
    const reply = await t.say('boa noite, tudo bem?')
    assert.match(reply, /^Boa noite, Maria! 😊 Tudo ótimo por aqui, e com você\?/)
    assert.doesNotMatch(reply, /Aqui é da/)
  })

  it('pergunta sem resposta cadastrada oferece o atendente', async () => {
    await t.say('oi')
    const reply = await t.say('vocês tem estacionamento?')
    assert.match(reply, /não tenho aqui agora/)
    assert.match(reply, /\*atendente\*/)
  })

  it('oferece o produto perguntado e um "sim" já anota no pedido', async () => {
    await t.say('oi')
    assert.match(await t.say('quanto custa a quatro queijos?'), /Quer que eu já anote uma pra você\?/)
    assert.match(await t.say('pode sim'), /Anotado! ✅ 1x Pizza Quatro Queijos/)
    assert.equal(t.conv().cart[0]?.qty, 1)
  })

  it('recusar a oferta não anota nada', async () => {
    await t.say('oi')
    await t.say('quanto é a calabresa?')
    assert.match(await t.say('não, obrigada'), /Tudo bem!/)
    assert.equal(t.conv().cart.length, 0)
  })

  it('exemplo do catálogo usa o nome que diferencia o produto', async () => {
    await t.say('oi')
    assert.match(await t.say('quais os preços?'), /\*2 margherita\*/)
  })

  it('responde saudação + pergunta na mesma mensagem', async () => {
    const reply = await t.say('Oi, que horas vocês abrem?')
    assert.match(reply, /^Oi, Maria! 😊/)
    assert.match(reply, /Terça a domingo, 18h às 23h/)
  })

  it('responde perguntas básicas com os dados do negócio', async () => {
    await t.say('oi')
    assert.match(await t.say('onde fica a pizzaria?'), /Rua Exemplo, 123/)
    assert.match(await t.say('vcs aceitam pix?'), /Aceitamos Pix/)
    assert.match(await t.say('qual a taxa de entrega?'), /Taxa de entrega: R\$ 5,00/)
    const gluten = await t.say('tem pizza sem glúten?')
    assert.match(gluten, /sem glúten/)
    assert.doesNotMatch(gluten, /artesanal/) // "pizza" não puxa frases sem relação
    assert.match(await t.say('qual o telefone de vocês'), /99999-0000/)
  })

  it('agradecimento e despedida', async () => {
    await t.say('oi')
    assert.match(await t.say('obrigada!'), /Por nada, Maria/)
    assert.match(await t.say('tchau'), /Até mais/)
  })

  it('informa o preço de um produto citado pelo nome, mesmo com erro de digitação', async () => {
    await t.say('oi')
    const reply = await t.say('quanto custa a calabreza?')
    assert.match(reply, /Pizza Calabresa\* sai por \*R\$\s?52,90/)
  })

  it('pergunta de preço genérica mostra o catálogo', async () => {
    await t.say('oi')
    const reply = await t.say('quais os preços?')
    assert.match(reply, /Catálogo/)
    assert.equal(t.conv().state, 'catalog')
  })

  it('faz pedido escrito com vários itens', async () => {
    await t.say('oi')
    const reply = await t.say('quero 2 calabresas e um refri')
    assert.match(reply, /Anotado! ✅ 2x Pizza Calabresa, 1x Refrigerante 2L/)
    assert.deepEqual(t.conv().cart.map(i => [i.name, i.qty]), [['Pizza Calabresa', 2], ['Refrigerante 2L', 1]])
    assert.equal(t.conv().state, 'catalog')
  })

  it('no catálogo, aceita o nome do produto e pergunta quando é ambíguo', async () => {
    await t.say('oi'); await t.say('1')
    assert.match(await t.say('margherita'), /1x Pizza Margherita/)
    const reply = await t.say('quero uma pizza')
    assert.match(reply, /Temos algumas opções/)
    assert.match(reply, /Quatro Queijos/)
    assert.equal(t.conv().cart.length, 1)
  })

  it('pergunta sobre um produto não adiciona ao carrinho', async () => {
    await t.say('oi'); await t.say('1')
    await t.say('a calabresa é apimentada?')
    assert.equal(t.conv().cart.length, 0)
  })

  it('"so isso" finaliza o pedido', async () => {
    await t.say('quero 1 margherita')
    assert.match(await t.say('só isso'), /qual é o seu nome/)
  })

  it('pede atendente em linguagem natural', async () => {
    await t.say('oi')
    assert.match(await t.say('quero falar com alguém por favor'), /alguém da equipe/)
    assert.equal(t.conv().state, 'human')
  })
})

describe('nlu', () => {
  it('separa saudação do resto', () => {
    assert.deepEqual(splitGreeting('oi, bom dia! tem pizza?'), { greeting: true, rest: 'tem pizza?' })
    assert.deepEqual(splitGreeting('oiii'), { greeting: true, rest: '' })
    assert.deepEqual(splitGreeting('oito pizzas'), { greeting: false, rest: 'oito pizzas' })
  })

  it('palavras únicas pesam mais que palavras comuns', () => {
    const products = [
      { id: '1', name: 'Pizza Calabresa', price: 1, active: true },
      { id: '2', name: 'Pizza Frango e Catupiry', price: 1, active: true },
    ]
    const m = findProduct(products, 'uma pizza de frango')
    assert.equal(m.kind === 'one' && m.product.id, '2')
    assert.equal(findProduct(products, 'pizza').kind, 'many')
    assert.equal(findProduct(products, 'estacionamento').kind, 'none')
  })
})
