/**
 * Cadastra (ou atualiza) um cliente a partir do dados.json do Catálogo Digital, sem conectar o WhatsApp.
 *
 *   npm run client:import -- <arquivo-ou-url do dados.json> <id-do-cliente> [--update]
 *
 * Depois reinicie o bot (pm2 restart chatbot) para carregar o cliente.
 */
import fs from 'node:fs'
import path from 'node:path'
import { catalogToTenant } from '../src/import/catalog.js'
import type { TenantConfig } from '../src/types.js'

try { process.loadEnvFile('.env') } catch { /* .env é opcional */ }

const [source, id] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const update = process.argv.includes('--update')
if (!source || !id || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
  console.error('Uso: npm run client:import -- <arquivo-ou-url do dados.json> <id-do-cliente> [--update]')
  process.exit(1)
}

const raw = /^https?:\/\//.test(source)
  ? await fetch(source).then(r => { if (!r.ok) throw new Error(`não consegui baixar (${r.status})`); return r.text() })
  : fs.readFileSync(source, 'utf8')
const data = JSON.parse(raw)

const file = path.join(path.resolve(process.env.DATA_DIR ?? 'data'), 'clients', `${id}.json`)
const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as TenantConfig : undefined
if (current && !update) {
  console.error(`O cliente "${id}" já existe. Use --update para atualizar o cardápio e as informações (o resto é mantido).`)
  process.exit(1)
}

const tenant = catalogToTenant(data, id, current)
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(tenant, null, 2))
const active = tenant.products.filter(p => p.active).length
console.log(`${current ? 'Atualizado' : 'Cadastrado'}: ${tenant.name} (${id}) — ${active} produtos ativos, ${tenant.products.length - active} ocultos.`)
console.log(`Arquivo: ${file}`)
console.log('Reinicie o bot para carregar (pm2 restart chatbot). O WhatsApp não é conectado.')
if (!current) console.log('Defina a senha do painel do cliente em Configuração (Super Admin).')
