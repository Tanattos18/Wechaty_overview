import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { agentHistory, agentPrompt, type AgentRequest, type AgentRunner } from '../src/engine/agent.js'
import { Engine } from '../src/engine/engine.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { Store } from '../src/store.js'
import type { TenantConfig } from '../src/types.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-agent-'))
const kb = new KnowledgeBase(path.join(dir, 'knowledge.db'))
kb.syncFromDir(path.resolve('knowledge/packs'))
after(() => kb.close())

const demo = (): TenantConfig => {
  const t = JSON.parse(fs.readFileSync('examples/clients/demo.json', 'utf8')) as TenantConfig
  t.ai.enabled = true
  t.ai.mode = 'agent'
  return t
}

/**
 * IA de mentira: para cada mensagem do cliente, roda uma lista de ferramentas e responde um texto.
 * Guarda o que recebeu (prompt e histórico) para os testes conferirem.
 */
function scripted (turns: { tools?: [string, Record<string, unknown>][]; reply: string }[]) {
  const seen: { req: AgentRequest; results: string[] }[] = []
  let i = 0
  const runner: AgentRunner = async req => {
    const turn = turns[i++] ?? { reply: '' }
    const results: string[] = []
    for (const [name, args] of turn.tools ?? []) results.push(await req.run(name, args))
    seen.push({ req, results })
    return turn.reply
  }
  return { runner, seen }
}

function setup (agent: AgentRunner, tenant = demo()) {
  const store = new Store(fs.mkdtempSync(path.join(dir, 's-')))
  store.saveTenant(tenant)
  const engine = new Engine({ store, knowledge: kb, agent, random: () => 0 })
  const say = async (text: string) => (await engine.handle({ tenantId: tenant.id, chatId: 'c1', name: 'Maria', text, channel: 'simulator' })).join('\n---\n')
  return { store, say, conv: () => store.getConversation(tenant.id, 'c1', '', 'simulator') }
}

describe('IA funcionária', () => {
  it('recebe todos os dados do cliente: empresa, cardápio numerado, respostas do Conhecimento e instruções', () => {
    const t = demo()
    t.ai.agentName = 'Ana'
    t.ai.instructions = 'Nunca dê desconto.'
    const prompt = agentPrompt(t, { name: 'Maria', cart: [] } as any, kb.faq(t), new Date('2026-11-03T22:00:00Z'))
    assert.match(prompt, /Você é Ana, atendente da empresa "Pizzaria Demo"/)
    assert.match(prompt, /1 - Pizza Margherita: R\$\s?49,90/)
    assert.match(prompt, /pix@pizzariademo/) // variável do Conhecimento
    assert.match(prompt, /Meio a meio: cobra o sabor mais caro/)
    assert.match(prompt, /Nunca dê desconto/)
    assert.match(prompt, /terça-feira/) // data e hora de agora
    assert.ok(kb.faq(t).length > 20)
  })

  it('anota pelo número e pelo nome; o total vem do sistema', async () => {
    const { runner, seen } = scripted([{ tools: [['adicionar_item', { produto: '1' }], ['adicionar_item', { produto: 'coca', quantidade: 2 }]], reply: 'Anotado!' }])
    const t = setup(runner)
    assert.equal(await t.say('quero a 1 e duas coca'), 'Anotado!')
    assert.deepEqual(t.conv().cart.map(i => `${i.qty}x ${i.name}`), ['1x Pizza Margherita', '2x Refrigerante 2L'])
    assert.match(seen[0].results[1], /Total: R\$\s?73,90/)
    assert.equal(t.conv().lastKind, 'order')
  })

  it('produto com tamanhos: sem tamanho, a ferramenta manda perguntar', async () => {
    const tenant = demo()
    tenant.products[1].sizes = [{ name: 'Média', price: 52.9 }, { name: 'Grande', price: 64.9 }]
    const { runner, seen } = scripted([
      { tools: [['adicionar_item', { produto: 'calabresa' }]], reply: 'Qual tamanho?' },
      { tools: [['adicionar_item', { produto: 'calabresa', tamanho: 'grande' }]], reply: 'Anotei a grande!' },
    ])
    const t = setup(runner, tenant)
    await t.say('quero uma calabresa')
    assert.match(seen[0].results[0], /FALTA TAMANHO.*Grande R\$\s?64,90/)
    assert.equal(t.conv().cart.length, 0)
    await t.say('grande')
    assert.deepEqual(t.conv().cart.map(i => [i.name, i.price]), [['Pizza Calabresa (Grande)', 64.9]])
  })

  it('fecha o pedido com nome, endereço e pagamento', async () => {
    const { runner, seen } = scripted([
      { tools: [['adicionar_item', { produto: 'calabresa', quantidade: 2 }]], reply: 'Anotei!' },
      { tools: [['confirmar_pedido', {}]], reply: 'Falta o endereço' },
      { tools: [['dados_entrega', { endereco: 'Rua A, 10', pagamento: 'Pix' }], ['confirmar_pedido', {}]], reply: 'Pedido confirmado!' },
    ])
    const t = setup(runner)
    await t.say('2 calabresa')
    await t.say('pode fechar')
    assert.match(seen[1].results[0], /ERRO: falta o endereço/)
    await t.say('rua A, 10, pago no pix')
    const [order] = t.store.listOrders('demo')
    assert.equal(order.customerName, 'Maria')
    assert.equal(order.address, 'Rua A, 10')
    assert.equal(order.payment, 'Pix')
    assert.equal(order.total, 110.8) // 105,80 + taxa de entrega de R$ 5,00
    assert.equal(order.deliveryFee, 5)
    assert.match(seen[2].results[1], /pedido #1 registrado/)
    assert.equal(t.conv().cart.length, 0)
  })

  it('remove item, meio a meio pela regra do cliente e cancela', async () => {
    const { runner, seen } = scripted([
      { tools: [['adicionar_item', { produto: 'calabresa' }], ['adicionar_item', { produto: 'refrigerante' }], ['remover_item', { item: 'refrigerante' }]], reply: 'ok' },
      { tools: [['adicionar_item', { produto: 'margherita', meio_a_meio_com: 'quatro queijos' }]], reply: 'ok' },
      { tools: [['cancelar_pedido', {}]], reply: 'Cancelado' },
    ])
    const t = setup(runner)
    await t.say('x')
    assert.deepEqual(t.conv().cart.map(i => i.name), ['Pizza Calabresa'])
    await t.say('y')
    assert.match(seen[1].results[0], /Meio a meio: margherita \/ quatro queijos/)
    assert.equal(t.conv().cart[1].price, 58.9) // o sabor mais caro
    await t.say('z')
    assert.equal(t.conv().cart.length, 0)
  })

  it('chamar atendente: o bot para de responder; pergunta sem resposta vai para o Treinar', async () => {
    const { runner } = scripted([
      { tools: [['informacao_nao_cadastrada', { pergunta: 'fazem festa de aniversário?' }]], reply: 'Não tenho essa informação agora.' },
      { tools: [['chamar_atendente', { motivo: 'alergia' }]], reply: 'Vou chamar alguém da equipe!' },
    ])
    const t = setup(runner)
    await t.say('vcs fazem festa de aniversário?')
    assert.ok(kb.listUnanswered('demo').some(u => /festa/.test(u.text)))
    assert.equal(await t.say('minha filha tem alergia'), 'Vou chamar alguém da equipe!')
    assert.equal(t.conv().state, 'human')
    assert.equal(await t.say('oi?'), '') // atendente cuidando: bot em silêncio
  })

  it('se a IA falhar, o bot responde pelas regras', async () => {
    const t = setup(async () => { throw new Error('fora do ar') })
    assert.match(await t.say('aceita pix?'), /pix@pizzariademo/)
  })

  it('modo "só perguntas abertas" não usa a funcionária', async () => {
    const tenant = demo()
    tenant.ai.mode = 'assist'
    let called = false
    const t = setup(async () => { called = true; return 'x' }, tenant)
    await t.say('quero 1 calabresa')
    assert.equal(called, false)
    assert.deepEqual(t.conv().cart.map(i => i.name), ['Pizza Calabresa'])
  })

  it('histórico junta mensagens seguidas do mesmo lado', () => {
    const conv = { messages: [
      { from: 'bot', text: 'a' }, { from: 'customer', text: 'oi' }, { from: 'bot', text: 'b' }, { from: 'bot', text: 'c' },
    ] } as any
    assert.deepEqual(agentHistory(conv), [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'b\n\nc' }])
  })
})
