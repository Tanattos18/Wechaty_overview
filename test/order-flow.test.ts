import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { Engine } from '../src/engine/engine.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { Store } from '../src/store.js'
import type { TenantConfig } from '../src/types.js'

/**
 * Pedidos como clientes de verdade escrevem, com a configuração real da Pizzaria Demo
 * e a base de conhecimento. Começou com uma simulação em que não dava para pedir.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-orders-'))
const kb = new KnowledgeBase(path.join(dir, 'knowledge.db'))
kb.syncFromDir(path.resolve('knowledge/packs'))
after(() => kb.close())

function setup () {
  const store = new Store(fs.mkdtempSync(path.join(dir, 'store-')))
  const demo = JSON.parse(fs.readFileSync('examples/clients/demo.json', 'utf8')) as TenantConfig
  demo.ai.enabled = false
  store.saveTenant(demo)
  const engine = new Engine({ store, knowledge: kb, random: () => 0 })
  const say = async (text: string) =>
    (await engine.handle({ tenantId: 'demo', chatId: 'c1', name: 'Maria', text, channel: 'simulator' })).join('\n---\n')
  const cart = () => store.findConversation('demo', 'c1')!.cart.map(i => [i.name, i.qty])
  return { say, cart }
}

describe('Pedidos como o cliente escreve', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => { t = setup() })

  it('reproduz a simulação que falhava: sabores → uma de cada → 1 e 4 → quero a 1 → ?', async () => {
    await t.say('oi')
    assert.match(await t.say('quais os sabores que tem'), /Catálogo/)

    const each = await t.say('quero uma de cada')
    assert.match(each, /1x Pizza Margherita, 1x Pizza Calabresa, 1x Pizza Quatro Queijos/)
    assert.doesNotMatch(each, /Refrigerante/) // "de cada" = as pizzas, não o refrigerante

    assert.match(await t.say('quero 1 e 4'), /1x Pizza Margherita, 1x Refrigerante 2L/)
    const one = await t.say('quero a 1')
    assert.match(one, /1x Pizza Margherita/)
    assert.doesNotMatch(one, /feriado/i)

    const help = await t.say('?')
    assert.match(help, /Ficou alguma dúvida\?[\s\S]*Seu pedido até agora/)
    assert.doesNotMatch(help, /Bom dia/)

    assert.deepEqual(t.cart(), [
      ['Pizza Margherita', 3], ['Pizza Calabresa', 1], ['Pizza Quatro Queijos', 1], ['Refrigerante 2L', 1],
    ])
  })

  it('números com quantidade: "duas da 1 e uma da 4", "2x3", "1, 2 e 3"', async () => {
    await t.say('oi'); await t.say('1') // abre o catálogo pelo menu
    assert.match(await t.say('duas da 1 e uma da 4'), /2x Pizza Margherita, 1x Refrigerante 2L/)
    assert.match(await t.say('2x3'), /3x Pizza Calabresa/)
    assert.match(await t.say('1, 2 e 3'), /1x Pizza Margherita, 1x Pizza Calabresa, 1x Pizza Quatro Queijos/)
    assert.deepEqual(t.cart(), [['Pizza Margherita', 3], ['Refrigerante 2L', 1], ['Pizza Calabresa', 4], ['Pizza Quatro Queijos', 1]])
  })

  it('mistura número e nome: "1 e 2 calabresa"', async () => {
    await t.say('cardapio')
    assert.match(await t.say('quero 1 e 2 calabresa'), /1x Pizza Margherita, 2x Pizza Calabresa/)
  })

  it('número fora da lista avisa sem quebrar', async () => {
    await t.say('cardapio')
    assert.match(await t.say('quero a 9'), /não achei o item \*9\*/i)
    assert.match(await t.say('1 e 9'), /1x Pizza Margherita[\s\S]*Não achei o item \*9\*/)
  })

  it('"?" com o catálogo aberto e o pedido vazio explica como pedir', async () => {
    await t.say('cardapio')
    assert.match(await t.say('?'), /número.*nome/)
  })

  it('não repete o catálogo quando não entende o pedido: explica como pedir', async () => {
    await t.say('cardapio')
    const r = await t.say('quero aquela lá')
    assert.doesNotMatch(r, /Catálogo/)
    assert.match(r, /número.*nome/)
  })

  it('pergunta sobre um produto com o catálogo aberto não anota nada', async () => {
    await t.say('cardapio')
    await t.say('a calabresa é apimentada?')
    assert.deepEqual(t.cart(), [])
  })

  it('pedido completo até a confirmação usando só números', async () => {
    await t.say('oi')
    await t.say('quais os sabores?')
    await t.say('2 e 4')
    assert.match(await t.say('só isso'), /nome/)
    await t.say('Maria Souza')
    await t.say('Rua A, 10')
    await t.say('pix')
    assert.match(await t.say('sim'), /Pedido \*#1\* confirmado/)
  })

  it('"como faço pra pedir?" mostra o catálogo com as instruções', async () => {
    await t.say('oi')
    const r = await t.say('como faço pra pedir?')
    assert.match(r, /uma de cada/)
    assert.match(r, /Catálogo/)
  })

  // Frases das conversas reais pelo WhatsApp (Joas, Lisah e akylla shop)
  it('"tem outro sabor?" lista as opções (antes respondia o telefone)', async () => {
    await t.say('oi')
    const r = await t.say('Tem outro sabor?')
    assert.match(r, /No momento temos estas opções/)
    assert.doesNotMatch(r, /telefone/i)
    assert.match(await t.say('2'), /1x Pizza Calabresa/) // e dá para pedir pelo número em seguida
  })

  it('"boa" depois de anotar entende como confirmação', async () => {
    await t.say('cardapio'); await t.say('1')
    assert.match(await t.say('Boa'), /posso \*finalizar\*/)
  })

  it('"tem coxinha?" avisa que não está no cardápio; "tem estacionamento?" não vira produto', async () => {
    await t.say('oi')
    assert.match(await t.say('Tem coxinha?'), /Não encontrei \*coxinha\* no nosso cardápio/)
    assert.doesNotMatch(await t.say('vocês tem estacionamento?'), /cardápio/)
  })

  it('"quero azeitona" sugere a pizza que leva azeitona e "sim" anota', async () => {
    await t.say('oi')
    assert.match(await t.say('Quero azeitona'), /Pizza Calabresa\* vem com azeitona/)
    assert.match(await t.say('sim'), /1x Pizza Calabresa/)
  })

  it('"quanto deu tudo?" e "quanto devo pagar" mostram o total do pedido', async () => {
    await t.say('cardapio'); await t.say('3'); await t.say('4')
    assert.match(await t.say('Quanto deu tudo?'), /deu \*R\$\s?70,90\*/)
    assert.match(await t.say('Quanto devo pagar'), /deu \*R\$\s?70,90\*/)
  })

  it('"quanto é a pizza meio a meio grande" explica o meio a meio', async () => {
    await t.say('oi')
    assert.match(await t.say('Está quanto o valor da pizza meio a meio grande'), /meio a meio/i)
  })

  it('no fechamento confirma o nome do WhatsApp com "sim" ou aceita outro nome', async () => {
    await t.say('cardapio'); await t.say('1')
    assert.match(await t.say('finalizar'), /no nome de \*Maria\*/)
    assert.match(await t.say('sim'), /Prazer, Maria/)
  })

  it('"quero repetir meu último pedido" chama o atendente', async () => {
    await t.say('oi')
    assert.match(await t.say('quero repetir meu último pedido'), /alguém da equipe/)
  })
})
