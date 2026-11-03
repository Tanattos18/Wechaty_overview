import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { agentPrompt } from '../src/engine/agent.js'
import { Engine } from '../src/engine/engine.js'
import { catalogToTenant, hoursText } from '../src/import/catalog.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { Store } from '../src/store.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-catalog-'))
const kb = new KnowledgeBase(path.join(dir, 'knowledge.db'))
kb.syncFromDir(path.resolve('knowledge/packs'))
after(() => kb.close())

const data = JSON.parse(fs.readFileSync('test/fixtures/catalogo-lorrany.json', 'utf8'))

function setup () {
  const tenant = catalogToTenant(data, 'lorrany')
  tenant.ai.enabled = false
  const store = new Store(fs.mkdtempSync(path.join(dir, 's-')))
  store.saveTenant(tenant)
  // Terça, 03/11/2026, 10h em Brasília
  const engine = new Engine({ store, knowledge: kb, random: () => 0, now: () => new Date('2026-11-03T13:00:00Z') })
  const say = async (text: string) => (await engine.handle({ tenantId: 'lorrany', chatId: 'c', name: 'Carla', text, channel: 'simulator' })).join('\n---\n')
  return { store, say, tenant }
}

describe('Importar o Catálogo Digital (Doçuras da Lorrany)', () => {
  it('cadastra empresa, horários, cardápio, entrega, pagamento e encomendas', () => {
    const t = catalogToTenant(data, 'lorrany')
    assert.equal(t.name, 'Doçuras da Lorrany')
    assert.equal(t.business.hours, 'Segunda a sexta, 8h às 19h; sábado, 8h às 14h; domingo fechado')
    assert.equal(t.business.phone, '(62) 99175-1262')
    assert.match(t.business.address, /Aruanã III — Goiânia\/GO/)
    assert.deepEqual(t.scheduling, { enabled: true, minDays: 2 })
    assert.deepEqual(t.knowledge?.packs, ['comum', 'confeitaria'])
    const v = t.knowledge!.variables
    assert.equal(v.taxa_entrega, 'R$ 25,00')
    assert.equal(v.formas_pagamento, 'Pix, cartão de crédito, débito e dinheiro')
    assert.match(v.precos_bolos, /R\$\s?80,00, R\$\s?85,00 ou R\$\s?90,00 o kg/)
    assert.ok(!v.promocoes, 'o aviso "Encomendas" do site não é promoção')
    assert.equal(t.ai.mode, 'agent')
    assert.equal(t.panelPasswordHash, undefined) // a senha é definida depois pelo Super Admin

    const bolo = t.products.find(p => p.name === 'Bolo Ninho com brigadeiro')!
    assert.equal(bolo.category, 'Bolos confeitados')
    assert.deepEqual(bolo.sizes!.slice(0, 3), [{ name: '1 kg', price: 80 }, { name: '1,5 kg', price: 120 }, { name: '2 kg', price: 160 }])
    assert.deepEqual(bolo.extras, [{ name: 'Massa de chocolate', price: 5 }])
    const doces = t.products.find(p => p.name === 'Docinhos tradicionais')!
    assert.deepEqual(doces.sizes, [{ name: 'Cento – 100 un.', price: 140 }, { name: 'Meio cento – 50 un.', price: 70 }])
    assert.match(doces.description!, /Sabores: Brigadeiro, Beijinho, Brigadeiro branco \(até 2/)
    assert.equal(t.products.filter(p => !p.active).length, 2) // kits festa ocultos no site
  })

  it('atualizar mantém o que é do bot (senha, IA, respostas próprias) e troca o cardápio', () => {
    const first = catalogToTenant(data, 'lorrany')
    first.panelPasswordHash = 'hash'
    first.ai.instructions = 'Minhas instruções'
    first.knowledge!.variables.conservacao = 'Guarde na geladeira.'
    const changed = structuredClone(data)
    changed.categorias[5].itens[0].preco = 27
    const updated = catalogToTenant(changed, 'lorrany', first)
    assert.equal(updated.panelPasswordHash, 'hash')
    assert.equal(updated.ai.instructions, 'Minhas instruções')
    assert.equal(updated.knowledge!.variables.conservacao, 'Guarde na geladeira.')
    assert.equal(updated.products.find(p => p.name === 'Bolo de fubá')!.price, 27)
  })

  it('a IA recebe o cardápio por seção, as encomendas e as regras da confeitaria', () => {
    const t = catalogToTenant(data, 'lorrany')
    const prompt = agentPrompt(t, { name: 'Carla', cart: [] } as any, kb.faq(t), new Date('2026-11-03T13:00:00Z'))
    assert.match(prompt, /Bolo Ninho com Kit Kat: R\$\s?80,00.*tamanhos: 1 kg R\$\s?80,00/)
    assert.match(prompt, /mínimo de 2 dias de antecedência/)
    assert.match(prompt, /nome ou frase no bolo/)
    assert.match(prompt, /Cada kg serve cerca de 10 fatias/)
  })

  it('horários agrupam dias iguais', () => {
    assert.equal(hoursText([null, { abre: '09:00', fecha: '18:00' }, { abre: '09:00', fecha: '18:00' }, null, null, null, null]),
      'Segunda a terça, 9h às 18h; quarta a domingo fechado')
  })

  it('conversa completa: bolo por peso, massa, docinhos e fechamento com data da encomenda', async () => {
    const t = setup()
    assert.match(await t.say('oi'), /Doçuras da Lorrany/)
    const menu = await t.say('qual o cardápio?')
    assert.match(menu, /\*Bolos confeitados\*\n\*1\* - Bolo Ninho com Sonho de Valsa — R\$\s?80,00 o kg/)
    assert.match(menu, /\*Docinhos\*/)
    assert.match(await t.say('quantos kg pra 25 pessoas?'), /10 fatias/)
    assert.match(await t.say('quero um bolo ninho com brigadeiro'), /De quantos quilos o \*Bolo Ninho com brigadeiro\*/)
    assert.match(await t.say('2,5 kg'), /1x Bolo Ninho com brigadeiro \(2,5 kg\)/)
    assert.match(await t.say('quero um bolo ninho com abacaxi e coco de 2kg massa de chocolate'),
      /1x Bolo Ninho com abacaxi e coco \(2 kg\) \+ Massa de chocolate — R\$\s?175,00/)
    assert.match(await t.say('e meio cento de docinho de ninho'), /1x Docinhos de leite Ninho \(Meio cento – 50 un\.\) — R\$\s?90,00/)
    await t.say('finalizar')
    await t.say('sim')
    assert.match(await t.say('Rua 10, qd 5 lt 3, Aruanã III'), /dia e horário é a entrega\?.*a partir de \*quinta-feira, 05\/11\*/s)
    assert.match(await t.say('amanhã'), /não consigo/)
    assert.match(await t.say('sábado às 15h'), /Como vai ser o pagamento/)
    const summary = await t.say('pix')
    assert.match(summary, /Subtotal: R\$\s?465,00\nTaxa de entrega: R\$\s?25,00\n\*Total: R\$\s?490,00\*/)
    assert.match(summary, /Para: sábado, 07\/11, às 15h/)
    assert.match(await t.say('sim'), /Encomenda \*#1\* anotada/)
    const [order] = t.store.listOrders('lorrany')
    assert.equal(order.scheduledFor, 'sábado, 07/11, às 15h')
    assert.equal(order.total, 490)
  })
})
