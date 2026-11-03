import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Engine } from '../src/engine/engine.js'
import { KnowledgeBase } from '../src/knowledge/kb.js'
import { Store } from '../src/store.js'
import { newTenant } from '../src/tenant-template.js'
import type { TenantConfig } from '../src/types.js'
import { CASES } from './knowledge-cases.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-kb-'))
const kb = new KnowledgeBase(path.join(dir, 'knowledge.db'))
const SEGMENTS = ['restaurante', 'petshop', 'salao', 'loja']
after(() => kb.close())

/** Cliente com todas as informações preenchidas com os exemplos dos pacotes. */
function tenantWith (packs: string[]): TenantConfig {
  const t = newTenant('t', 'Loja Teste')
  Object.assign(t.business, { hours: '9h às 18h', address: 'Rua A, 1', phone: '(81) 1234-5678' })
  const variables: Record<string, string> = {}
  for (const p of kb.listPacks()) for (const v of p.variables) variables[v.key] = v.example ?? 'x'
  t.knowledge = { packs, variables, overrides: {} }
  return t
}

describe('Base de conhecimento', () => {
  before(() => { kb.syncFromDir(path.resolve('knowledge/packs')) })


  it('carrega os 6 pacotes com pelo menos 20 variações por assunto', () => {
    const packs = kb.listPacks()
    assert.deepEqual(packs.map(p => p.id).sort(), ['comum', 'confeitaria', 'loja', 'petshop', 'restaurante', 'salao'])
    for (const p of packs) {
      const pack = kb.getPack(p.id)!
      for (const topic of pack.topics) assert.ok(topic.questions.length >= 20, `${p.id}/${topic.key} tem ${topic.questions.length}`)
    }
    assert.ok(packs.reduce((s, p) => s + p.questions, 0) > 1500)
  })

  it('não recarrega um pacote que já está na mesma versão', () => {
    assert.deepEqual(kb.syncFromDir(path.resolve('knowledge/packs')), [])
  })

  it(`acerta frases que não estão escritas nos pacotes (${CASES.length} casos × ramos)`, () => {
    const fails: string[] = []
    let total = 0
    for (const [text, expected] of CASES) {
      const segs = expected && !expected.startsWith('comum/') ? [expected.split('/')[0]] : SEGMENTS
      for (const seg of segs) {
        total++
        const r = kb.match(tenantWith(['comum', seg]), text)
        const got = r ? `${r.packId}/${r.topic}` : null
        if (got !== expected) fails.push(`[${seg}] "${text}" → ${got} (esperado ${expected})`)
      }
    }
    // Exige pelo menos 95% de acerto
    assert.ok(fails.length <= total * 0.05, `${fails.length}/${total} erros:\n${fails.join('\n')}`)
  })

  it('substitui as variáveis pelas informações do cliente', () => {
    const r = kb.match(tenantWith(['comum']), 'qual a chave pix?')
    assert.equal(r?.status, 'answer')
    assert.match(r!.status === 'answer' ? r!.answer : '', /CNPJ 12\.345\.678/)
    const h = kb.match(tenantWith(['comum']), 'que horas vocês abrem?')
    assert.match(h!.status === 'answer' ? h!.answer : '', /9h às 18h/)
  })

  it('assunto reconhecido sem informação preenchida volta como "missing"', () => {
    const t = tenantWith(['comum'])
    delete t.knowledge!.variables.estacionamento
    const r = kb.match(t, 'tem estacionamento?')
    assert.equal(r?.status, 'missing')
    assert.deepEqual(r!.status === 'missing' ? r!.missing : [], ['estacionamento'])
  })

  it('resposta personalizada e assunto desativado pelo cliente', () => {
    const t = tenantWith(['comum'])
    t.knowledge!.overrides['comum/pix'] = { answer: 'Pix: {chave_pix} 💚 (minha resposta)' }
    const r = kb.match(t, 'aceita pix?')
    assert.match(r!.status === 'answer' ? r!.answer : '', /minha resposta/)
    t.knowledge!.overrides['comum/pix'] = { enabled: false }
    assert.equal(kb.match(t, 'aceita pix?')?.status, 'missing')
  })

  it('só usa os pacotes ativos do cliente', () => {
    assert.equal(kb.match(tenantWith(['comum']), 'quanto custa o banho do meu cachorro?'), undefined)
    assert.equal(kb.match(tenantWith(['comum', 'petshop']), 'quanto custa o banho do meu cachorro?')?.topic, 'preco_banho')
  })

  it('exporta e importa o mesmo pacote (para levar a outros clientes)', () => {
    const exported = kb.getPack('salao')!
    const other = new KnowledgeBase(path.join(dir, 'outro.db'))
    other.importPack(JSON.parse(JSON.stringify(exported)))
    assert.deepEqual(other.getPack('salao'), exported)
    other.close()
  })

  it('recusa pacote inválido com mensagem clara', () => {
    assert.throws(() => kb.importPack({ id: 'x', name: 'X', topics: [{ key: 'a', answer: 'oi', questions: [] }] }),
      /precisa de pelo menos uma pergunta/)
    assert.throws(() => kb.importPack({ name: 'sem id', topics: [] }), /"id"/)
  })

  it('registra perguntas sem resposta, agrupando repetidas', () => {
    kb.logUnanswered('t', 'Vocês têm wifi?')
    kb.logUnanswered('t', 'voces tem wifi')
    kb.logUnanswered('t', 'tem estacionamento?', 'comum/estacionamento')
    const rows = kb.listUnanswered('t')
    assert.equal(rows.find(r => /wifi/i.test(r.text))?.count, 2)
    assert.equal(rows.find(r => r.topic)?.topic, 'comum/estacionamento')
  })
})

describe('Bot usando a base de conhecimento', () => {
  it('responde pelo banco, executa ações e registra o que não sabe', async () => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-kbe-')))
    const kb2 = new KnowledgeBase(path.join(dir, 'engine.db'))
    kb2.syncFromDir(path.resolve('knowledge/packs'))
    const tenant = tenantWith(['comum', 'petshop'])
    tenant.id = 'pet'
    tenant.ai.enabled = false
    store.saveTenant(tenant)
    const engine = new Engine({ store, knowledge: kb2 })
    const say = async (text: string) =>
      (await engine.handle({ tenantId: 'pet', chatId: 'c', name: 'Ana', text, channel: 'simulator' })).join('\n')

    await say('oi')
    assert.match(await say('vocês buscam o cachorro em casa?'), /leva e traz/)
    assert.match(await say('quero agendar um banho pro meu cachorro'), /Agendamos por aqui/) // não abre o catálogo
    assert.match(await say('meu cachorro foi atropelado'), /urgente/)
    assert.equal(store.findConversation('pet', 'c')?.state, 'human') // emergência chama atendente

    // assunto sem informação preenchida é registrado com o assunto reconhecido
    store.findConversation('pet', 'c')!.state = 'menu'
    delete tenant.knowledge!.variables.estacionamento
    await say('tem estacionamento?')
    assert.equal(kb2.listUnanswered('pet').find(r => r.topic === 'comum/estacionamento')?.count, 1)
    kb2.close()
  })
})
