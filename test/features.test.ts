import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { Engine } from '../src/engine/engine.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { exportConversations, qualityStats, runQa, runSavedTests } from '../src/quality/quality.js'
import { parseReply, systemPrompt } from '../src/engine/ai.js'
import { replay } from '../src/quality/replay.js'
import { Store } from '../src/store.js'
import type { TenantConfig } from '../src/types.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-features-'))
const kb = new KnowledgeBase(path.join(dir, 'knowledge.db'))
kb.syncFromDir(path.resolve('knowledge/packs'))
after(() => kb.close())

const demo = () => {
  const t = JSON.parse(fs.readFileSync('data/clients/demo.json', 'utf8')) as TenantConfig
  t.ai.enabled = false
  return t
}

function setup (tenant: TenantConfig = demo()) {
  const store = new Store(fs.mkdtempSync(path.join(dir, 's-')))
  store.saveTenant(tenant)
  const engine = new Engine({ store, knowledge: kb, random: () => 0 })
  let chat = 0
  const newChat = () => {
    const chatId = `c${++chat}`
    return async (text: string) =>
      (await engine.handle({ tenantId: tenant.id, chatId, name: 'Maria', text, channel: 'simulator' })).join('\n---\n')
  }
  return { store, engine, newChat, say: newChat(), tenant: () => store.getTenant(tenant.id)! }
}

/** Pizzaria com tamanhos e adicionais, para testar o cardápio com opções. */
function pizzeriaWithSizes (halfHalf: TenantConfig['halfHalf'] = 'max'): TenantConfig {
  const t = demo()
  t.halfHalf = halfHalf
  t.products = [
    { id: 'm', name: 'Pizza Margherita', price: 49.9, active: true, sizes: [{ name: 'Média', price: 49.9 }, { name: 'Grande', price: 59.9 }] },
    { id: 'c', name: 'Pizza Calabresa', price: 52.9, active: true, sizes: [{ name: 'Média', price: 52.9 }, { name: 'Grande', price: 64.9 }], extras: [{ name: 'Borda de catupiry', price: 9 }] },
    { id: 'r', name: 'Refrigerante 2L', price: 12, active: true },
  ]
  return t
}

describe('1. Treinar o bot', () => {
  it('frase ensinada ao cliente passa a ser reconhecida (e só por ele)', async () => {
    const t = setup()
    const before = kb.match(t.tenant(), 'tem lugar pra galera sentar')
    assert.notEqual(before?.topic, 'reservas')
    t.engine.learn(t.tenant(), 'restaurante/reservas', 'tem lugar pra galera sentar')
    assert.equal(kb.match(t.tenant(), 'tem lugar pra galera sentar')?.topic, 'reservas')
    assert.notEqual(kb.match(demo(), 'tem lugar pra galera sentar')?.topic, 'reservas') // outro cliente não aprendeu
  })

  it('"para todos os clientes" grava a frase no pacote', () => {
    assert.ok(kb.addPackQuestion('comum/estacionamento', 'onde deixo a moto'))
    assert.equal(kb.match(demo(), 'onde deixo a moto')?.topic, 'estacionamento')
  })
})

describe('2. Perguntar quando não tiver certeza', () => {
  it('oferece opções, responde a escolhida e aprende a frase', async () => {
    const t = setup()
    await t.say('oi')
    const ask = await t.say('tem lugar pra sentar')
    assert.match(ask, /Você quis dizer/)
    assert.match(ask, /\*2\* - Reservas/)
    assert.match(await t.say('2'), /ordem de chegada/)
    // aprendeu: na próxima vez responde direto
    const next = t.newChat()
    await next('oi')
    assert.match(await next('tem lugar pra sentar'), /ordem de chegada/)
  })

  it('"não" depois das opções pede para explicar de outro jeito', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('tem lugar pra sentar')
    assert.match(await t.say('não'), /explicar de outro jeito/)
  })
})

describe('3. Memória curta da conversa', () => {
  it('"quanto custa ela?" e "mais uma" se referem ao último produto', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('me ve uma calabresa')
    assert.match(await t.say('quanto custa ela?'), /Pizza Calabresa\* sai por/)
    assert.match(await t.say('mais uma'), /1x Pizza Calabresa/)
  })

  it('promoção apresentada vira item: "quero essa" anota o combo', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('qual a promoção de hoje?')
    assert.match(await t.say('quero essa'), /1x Combo Promoção de Terça/)
  })
})

describe('4. Cardápio com tamanhos, adicionais e meio a meio', () => {
  it('pergunta o tamanho quando o cliente não diz, e aceita o número', async () => {
    const t = setup(pizzeriaWithSizes())
    await t.say('oi')
    const q = await t.say('quero uma calabresa')
    assert.match(q, /Qual tamanho da \*Pizza Calabresa\*/)
    assert.match(q, /\*2\* - Grande — R\$\s?64,90/)
    assert.match(await t.say('2'), /1x Pizza Calabresa \(Grande\)/)
  })

  it('tamanho e adicional na mesma frase somam no preço', async () => {
    const t = setup(pizzeriaWithSizes())
    await t.say('oi')
    const r = await t.say('quero 1 calabresa grande com borda de catupiry')
    assert.match(r, /1x Pizza Calabresa \(Grande\) \+ Borda de catupiry/)
    assert.match(r, /R\$\s?73,90/) // 64,90 + 9,00
  })

  it('meio a meio cobra o sabor mais caro (ou a média, conforme a regra)', async () => {
    const max = setup(pizzeriaWithSizes('max'))
    await max.say('oi')
    assert.match(await max.say('meio calabresa meio margherita grande'), /Meio a meio: calabresa \/ margherita \(Grande\) — R\$\s?64,90/)
    const avg = setup(pizzeriaWithSizes('avg'))
    await avg.say('oi')
    assert.match(await avg.say('meio calabresa meio margherita grande'), /R\$\s?62,40/) // (64,90 + 59,90) / 2
    const off = setup(pizzeriaWithSizes('off'))
    await off.say('oi')
    assert.match(await off.say('meio calabresa meio margherita'), /Não fazemos pizza meio a meio/)
  })

  it('meio a meio sem tamanho pergunta o tamanho com o preço já calculado', async () => {
    const t = setup(pizzeriaWithSizes('max'))
    await t.say('oi')
    const q = await t.say('quero meia calabresa e meia margherita')
    assert.match(q, /Qual tamanho da \*meio a meio calabresa \/ margherita\*/)
    assert.match(q, /Grande — R\$\s?64,90/)
    assert.match(await t.say('grande'), /1x Meio a meio/)
  })
})

describe('5. Sinônimos do cliente', () => {
  it('"coca" vira refrigerante e "4 queijos" vira quatro queijos', async () => {
    const t = setup()
    await t.say('oi')
    assert.match(await t.say('quero uma coca e uma 4 queijos'), /1x Refrigerante 2L, 1x Pizza Quatro Queijos/)
  })
})

describe('6. Várias perguntas numa mensagem', () => {
  it('responde horário e Pix juntos', async () => {
    const t = setup()
    await t.say('oi')
    const r = await t.say('qual o horário e aceita pix?')
    assert.match(r, /18h às 23h/)
    assert.match(r, /pix@pizzariademo/)
  })
})

describe('7. Bateria de testes por cliente', () => {
  it('dá uma nota, lista os fluxos e os assuntos sem informação', async () => {
    const r = await runQa(kb, demo())
    assert.ok(r.total > 20)
    assert.ok(r.score >= 90, `nota ${r.score}`)
    assert.ok(r.flows.every(f => f.ok), JSON.stringify(r.flows))
    assert.ok(r.missingTopics.some(m => m.key === 'comum/site')) // a demo não tem site cadastrado
  })
})

describe('8. Painel de qualidade', () => {
  it('conta as respostas entendidas e as não entendidas', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('aceita pix?')
    await t.say('blablabla xyz')
    const q = qualityStats(t.store, kb, t.tenant())
    assert.equal(q.answered, 3)
    assert.equal(q.notUnderstood, 1)
    assert.equal(q.understoodPct, 67)
  })
})

describe('9. Exportar conversas', () => {
  it('gera o texto com as conversas', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('aceita pix?')
    const txt = exportConversations(t.store, t.tenant(), 'txt', 30)
    assert.match(txt, /Conversas de Pizzaria Demo/)
    assert.match(txt, /Cliente: aceita pix\?/)
    assert.match(txt, /Bot: .*Pix/)
    assert.equal(JSON.parse(exportConversations(t.store, t.tenant(), 'json', 30)).length, 1)
  })
})

describe('10. Conversa salva como teste', () => {
  it('passa enquanto nada muda e mostra a diferença quando a resposta muda', async () => {
    const tenant = demo()
    const messages = ['oi', 'aceita pix?']
    const test = { id: 't1', title: 'Pix', messages, expected: await replay(tenant, kb, messages), createdAt: '' }
    assert.deepEqual((await runSavedTests(kb, tenant, [test]))[0].ok, true)
    tenant.knowledge!.variables.chave_pix = 'nova-chave@pix.com'
    const [r] = await runSavedTests(kb, tenant, [test])
    assert.equal(r.ok, false)
    assert.match(r.diffs[0].got, /nova-chave@pix\.com/)
  })
})

describe('IA (OpenRouter)', () => {
  it('a marca [ATENDENTE] chama atendente e some do texto', () => {
    assert.deepEqual(parseReply('Vou confirmar com a equipe. [ATENDENTE]'), { text: 'Vou confirmar com a equipe.', handoff: true })
    assert.deepEqual(parseReply('<think>hmm</think>Temos sim!'), { text: 'Temos sim!', handoff: false })
  })

  it('"opção pra ela" fala de uma pessoa, não do último produto', async () => {
    const t = setup()
    await t.say('oi')
    await t.say('quero 1 calabresa')
    assert.doesNotMatch(await t.say('minha filha é alérgica a lactose, alguma opção pra ela?'), /Calabresa\* sai por/)
    assert.match(await t.say('quanto custa ela?'), /Pizza Calabresa\* sai por/)
  })

  it('o prompt leva produtos, variáveis e as regras de pedido', () => {
    const p = systemPrompt(demo())
    assert.match(p, /Pizza Calabresa: R\$\s?52,90/)
    assert.match(p, /pix@pizzariademo/)
    assert.match(p, /\[ATENDENTE\]/)
  })
})
