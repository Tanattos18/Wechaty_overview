/**
 * Teste de carga: vários clientes conversando ao mesmo tempo com o bot, pelo painel (rota do simulador).
 *
 *   npm run test:load -- [clientes=60] [url=http://localhost:3000]
 *
 * Usa a senha de ADMIN_PASSWORD do .env. Cada cliente virtual segue um roteiro diferente
 * (pedido completo, dúvidas, oferta de produto, atendente...) e confere as respostas.
 * No fim mostra os tempos de resposta e confere se as conversas e os pedidos não se misturaram.
 */
import crypto from 'node:crypto'

try { process.loadEnvFile('.env') } catch { /* sem .env */ }

const CUSTOMERS = Number(process.argv[2] ?? 60)
const BASE = (process.argv[3] ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '')
const TENANT = 'demo'
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iara', 'João', 'Lia', 'Marcos', 'Nina', 'Otávio', 'Paula']

type Step = [message: string, expected: RegExp]
interface Scenario { name: string; steps: Step[]; order?: { items: [string, number][]; total: number } }

const SCENARIOS: Scenario[] = [
  {
    name: 'pedido completo',
    steps: [
      ['oi', /Aqui é da/],
      ['quero 2 calabresa e 1 refrigerante', /2x Pizza Calabresa, 1x Refrigerante 2L/],
      ['só isso', /nome/],
      ['{nome}', /endereço/],
      ['Rua das Flores, {n}', /Posso confirmar/],
      ['sim', /Pedido \*#\d+\* confirmado/],
    ],
    order: { items: [['Pizza Calabresa', 2], ['Refrigerante 2L', 1]], total: 117.8 },
  },
  {
    name: 'dúvidas',
    steps: [
      ['boa noite, tudo bem?', /Tudo ótimo/],
      ['vcs entregam no centro?', /Centro/],
      ['qual a taxa de entrega?', /R\$ 5,00/],
      ['aceita pix?', /pix@pizzariademo/],
      ['tem opção vegetariana?', /vegetarianas/],
      ['obrigado!', /\{nome\}|Por nada|Imagina|Disponha|agradeço/],
    ],
  },
  {
    name: 'oferta de produto',
    steps: [
      ['olá', /Aqui é da/],
      ['quanto custa a margherita?', /Quer que eu já anote/],
      ['pode sim', /1x Pizza Margherita/],
      ['finalizar', /nome/],
      ['{nome}', /endereço/],
      ['retirar', /Retirada no local/],
      ['sim', /confirmado/],
    ],
    order: { items: [['Pizza Margherita', 1]], total: 49.9 },
  },
  {
    name: 'atendente',
    steps: [
      ['oi', /Aqui é da/],
      ['meu pedido veio errado', /Sinto muito|equipe/],
      ['alô? tem alguém?', /^$/], // atendente assumiu: o bot fica em silêncio
    ],
  },
  {
    name: 'cardápio e meio a meio',
    steps: [
      ['bom dia', /Aqui é da/],
      ['me manda o cardápio', /Catálogo/],
      ['pode ser meio a meio?', /meio a meio/],
      ['qual o tamanho da grande?', /fatias/],
      ['3 x2', /2x Pizza Quatro Queijos/],
      ['cancelar', /cancel/],
    ],
  },
]

let cookie = ''
async function api<T> (method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(data as any).error ?? ''}`)
  return data as T
}

const latencies: number[] = []
const failures: string[] = []

async function runCustomer (index: number) {
  const scenario = SCENARIOS[index % SCENARIOS.length]
  const name = `${NAMES[index % NAMES.length]} ${index}`
  const chatId = `sim:load${crypto.randomBytes(5).toString('hex')}`
  for (const [template, expected] of scenario.steps) {
    const text = template.replace('{nome}', name).replace('{n}', String(index))
    // pausa aleatória curta, como pessoas digitando em momentos diferentes
    await new Promise(r => setTimeout(r, Math.random() * 150))
    const started = performance.now()
    let replies: string[] = []
    try {
      replies = (await api<{ replies: string[] }>('POST', `/api/tenants/${TENANT}/simulate`, { chatId, name, text })).replies
    } catch (err) {
      failures.push(`[${name} · ${scenario.name}] "${text}": erro ${(err as Error).message}`)
      return { chatId, scenario, name }
    }
    latencies.push(performance.now() - started)
    const joined = replies.join('\n')
    if (!expected.test(joined)) failures.push(`[${name} · ${scenario.name}] "${text}" → ${JSON.stringify(joined.slice(0, 120))}`)
  }
  return { chatId, scenario, name }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

async function main () {
  const password = process.env.ADMIN_PASSWORD
  if (!password) throw new Error('Defina ADMIN_PASSWORD no .env')
  await api('POST', '/api/login', { tenantId: 'admin', password })

  const ordersBefore = await api<any[]>('GET', `/api/tenants/${TENANT}/orders`)
  const totalMessages = Array.from({ length: CUSTOMERS }, (_, i) => SCENARIOS[i % SCENARIOS.length].steps.length).reduce((a, b) => a + b, 0)
  console.log(`\n▶ ${CUSTOMERS} clientes conversando ao mesmo tempo com "${TENANT}" (${totalMessages} mensagens) em ${BASE}\n`)

  const started = performance.now()
  const results = await Promise.all(Array.from({ length: CUSTOMERS }, (_, i) => runCustomer(i)))
  const seconds = (performance.now() - started) / 1000

  // Confere isolamento: cada conversa tem só as próprias mensagens e cada pedido é do cliente certo
  const ordersAfter = await api<any[]>('GET', `/api/tenants/${TENANT}/orders`)
  const newOrders = ordersAfter.filter(o => !ordersBefore.some(b => b.id === o.id))
  for (const r of results) {
    const conv = await api<any>('GET', `/api/tenants/${TENANT}/conversations/${encodeURIComponent(r.chatId)}`)
    const fromCustomer = conv.messages.filter((m: any) => m.from === 'customer').length
    if (fromCustomer !== r.scenario.steps.length) failures.push(`[${r.name}] conversa com ${fromCustomer} mensagens do cliente (esperado ${r.scenario.steps.length})`)
    if (conv.messages.some((m: any) => m.from === 'customer' && /\d+/.test(m.text) && m.text.includes('Rua das Flores') && !m.text.endsWith(` ${r.name.split(' ')[1]}`))) {
      failures.push(`[${r.name}] recebeu mensagem de outro cliente`)
    }
    if (r.scenario.order) {
      const mine = newOrders.filter(o => o.chatId === r.chatId)
      if (mine.length !== 1) { failures.push(`[${r.name}] ${mine.length} pedidos (esperado 1)`); continue }
      const items = mine[0].items.map((i: any) => [i.name, i.qty])
      if (JSON.stringify(items) !== JSON.stringify(r.scenario.order.items) || mine[0].total !== r.scenario.order.total || mine[0].customerName !== r.name) {
        failures.push(`[${r.name}] pedido errado: ${JSON.stringify(mine[0].items)} total ${mine[0].total} nome ${mine[0].customerName}`)
      }
    }
  }
  const expectedOrders = results.filter(r => r.scenario.order).length
  const numbers = newOrders.map(o => o.number)
  if (new Set(numbers).size !== numbers.length) failures.push(`números de pedido repetidos: ${numbers.join(', ')}`)

  const sorted = [...latencies].sort((a, b) => a - b)
  console.log(`Mensagens respondidas: ${latencies.length}/${totalMessages} em ${seconds.toFixed(1)} s (${(latencies.length / seconds).toFixed(0)} msg/s)`)
  console.log(`Tempo de resposta do bot: mediana ${pct(sorted, 0.5).toFixed(0)} ms · 95% até ${pct(sorted, 0.95).toFixed(0)} ms · pior ${(sorted.at(-1) ?? 0).toFixed(0)} ms`)
  console.log(`Pedidos criados: ${newOrders.length}/${expectedOrders} (números únicos: ${new Set(numbers).size === numbers.length ? 'sim' : 'NÃO'})`)
  console.log('(No WhatsApp o bot ainda espera de propósito 1–7 s de "digitando…" por mensagem; isso não entra nesta medição.)')
  if (failures.length) {
    console.log(`\n✖ ${failures.length} problema(s):\n  ${failures.slice(0, 30).join('\n  ')}`)
    process.exitCode = 1
  } else {
    console.log('\n✔ Todas as conversas responderam certo, sem misturar clientes nem pedidos.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
