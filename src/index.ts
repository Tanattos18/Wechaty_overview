import path from 'node:path'
import { BotManager } from './channels/whatsapp.js'
import { createClaudeResponder, createOpenRouterResponder } from './engine/ai.js'
import { Engine } from './engine/engine.js'
import { KnowledgeBase } from './knowledge/kb.js'
import { createPanel } from './panel/server.js'
import { Store } from './store.js'

try { process.loadEnvFile('.env') } catch { /* .env é opcional */ }

const env = process.env
const dataDir = path.resolve(env.DATA_DIR ?? 'data')
const port = Number(env.PORT ?? 3000)
const sessionSecret = env.SESSION_SECRET ?? ''
const adminPassword = env.ADMIN_PASSWORD ?? ''

if (sessionSecret.length < 32 || adminPassword.length < 8) {
  console.error('Configure SESSION_SECRET (32+ caracteres) e ADMIN_PASSWORD (8+) no arquivo .env — veja .env.example.')
  process.exit(1)
}

const store = new Store(dataDir)

// Base de conhecimento: SQLite em data/knowledge.db, alimentado pelos pacotes de knowledge/packs
const knowledge = new KnowledgeBase(path.join(dataDir, 'knowledge.db'))
const updatedPacks = knowledge.syncFromDir(path.resolve('knowledge/packs'))
if (updatedPacks.length) console.log(`[conhecimento] pacotes carregados: ${updatedPacks.join(', ')}`)

// A IA só é usada com chave configurada; sem ela o bot responde pela base de conhecimento.
// OpenRouter tem prioridade (modelos gratuitos); Claude fica para o plano premium.
const DEFAULT_OPENROUTER_MODELS = 'nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free'
const aiOn = env.AI_ENABLED !== 'false'
const ai = !aiOn
  ? undefined
  : env.OPENROUTER_API_KEY
    ? createOpenRouterResponder(env.OPENROUTER_API_KEY, (env.OPENROUTER_MODELS || DEFAULT_OPENROUTER_MODELS).split(',').map(m => m.trim()).filter(Boolean))
    : env.ANTHROPIC_API_KEY
      ? createClaudeResponder(env.CLAUDE_MODEL ?? 'claude-opus-5-5')
      : undefined
if (ai) console.log(`[ia] ligada via ${env.OPENROUTER_API_KEY ? 'OpenRouter' : 'Claude'}`)
const engine = new Engine({
  store,
  knowledge,
  ai,
  onOrder: (tenantId, orderId) => console.log(`[pedido] ${tenantId}: novo pedido ${orderId}`),
})
const bots = new BotManager(engine, store, {
  browserPath: env.BROWSER_PATH || undefined,
  sessionsDir: path.join(dataDir, 'sessions'),
  humanTyping: env.HUMAN_TYPING !== 'false',
})

const app = createPanel({ store, engine, bots, knowledge, adminPassword, sessionSecret })
const server = app.listen(port, () => console.log(`Painel em http://localhost:${port}`))

if (env.AUTO_START_BOTS === 'true') {
  for (const tenant of store.listTenants().filter(t => t.active && !t.suspended)) {
    bots.start(tenant.id).catch(err => console.error(`[bot] ${tenant.id} não iniciou:`, err?.message ?? err))
  }
}

let closing = false
async function shutdown () {
  if (closing) return
  closing = true
  console.log('Encerrando...')
  server.close()
  await bots.stopAll()
  await store.flush()
  knowledge.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
