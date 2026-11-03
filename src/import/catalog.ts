import { newTenant } from '../tenant-template.js'
import type { Product, ProductOption, TenantConfig } from '../types.js'

/**
 * Converte o `dados.json` do Catálogo Digital (site estático com painel) num cliente do bot:
 * empresa, horários, cardápio com tamanhos/pesos/adicionais, entrega, pagamento, encomendas
 * e as respostas do Conhecimento. Ao atualizar um cliente que já existe, mantém o que é do bot
 * (senha, IA, mensagens, respostas personalizadas, frases ensinadas, plano).
 */

interface CatalogItem {
  nome: string
  desc?: string
  preco?: number
  precoKg?: number
  opcoes?: { nome: string; preco: number }[]
  sabores?: { lista: string[]; max?: number }
  rendimento?: string
  tags?: string[]
  oculto?: boolean
  esgotado?: boolean
}

interface CatalogData {
  nome: string
  chamada?: string
  slogan?: string
  sobre?: string
  diferenciais?: string[]
  promo?: { ativo?: boolean; titulo?: string; texto?: string }
  contato?: { whatsapp?: string; telefone?: string; email?: string }
  redes?: { instagram?: string; facebook?: string; tiktok?: string }
  endereco?: { rua?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; referencia?: string; linkMapa?: string }
  horarios?: ({ abre: string; fecha: string } | null)[]
  pedidos?: { entrega?: boolean; retirada?: boolean; encomenda?: boolean; antecedenciaDias?: number; avisoEncomenda?: string }
  entrega?: { taxa?: number; tempo?: string; pedidoMinimo?: number; gratisAcima?: number; area?: string }
  pagamento?: {
    pix?: { ativo?: boolean; chave?: string; titular?: string }
    credito?: boolean; debito?: boolean; dinheiro?: boolean; obsCartao?: string; transferencia?: boolean
  }
  bolosKg?: {
    pesos?: number[]
    fatiasPorKg?: number
    massas?: { nome: string; acrescimo: number; porKg?: boolean }[]
    pedirNome?: boolean
    topo?: { ativo?: boolean; preco?: number }
  }
  categorias?: { nome: string; icone?: string; desc?: string; oculto?: boolean; itens: CatalogItem[] }[]
}

const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const kg = (w: number) => `${String(w).replace('.', ',')} kg`
const hour = (h: string) => h.replace(/^0/, '').replace(':00', 'h').replace(':', 'h')
const round2 = (v: number) => Math.round(v * 100) / 100

/** "Segunda a sexta, 8h às 19h; sábado, 8h às 14h; domingo fechado". */
export function hoursText (horarios: CatalogData['horarios']): string {
  if (!horarios?.length) return ''
  const order = [1, 2, 3, 4, 5, 6, 0] // começa na segunda
  const label = (d: number) => {
    const h = horarios[d]
    return h ? `${hour(h.abre)} às ${hour(h.fecha)}` : 'fechado'
  }
  const groups: { from: number; to: number; text: string }[] = []
  for (const d of order) {
    const text = label(d)
    const last = groups.at(-1)
    if (last && last.text === text) last.to = d
    else groups.push({ from: d, to: d, text })
  }
  return groups.map(g => {
    const days = g.from === g.to ? DAYS[g.from] : `${DAYS[g.from]} a ${DAYS[g.to]}`
    return g.text === 'fechado' ? `${days} fechado` : `${days}, ${g.text}`
  }).join('; ').replace(/^./, c => c.toUpperCase())
}

function slug (s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
}

/** Seção sem o preço do nome ("Bolos confeitados · R$ 80/kg" -> "Bolos confeitados"). */
const sectionName = (nome: string) => nome.split('·')[0].trim()

function products (data: CatalogData): Product[] {
  const out: Product[] = []
  const pesos = data.bolosKg?.pesos?.length ? data.bolosKg.pesos : [1]
  const massas: ProductOption[] = (data.bolosKg?.massas ?? [])
    .filter(m => m.acrescimo > 0)
    .map(m => ({ name: m.nome, price: m.acrescimo }))
  const ids = new Set<string>()
  for (const cat of data.categorias ?? []) {
    const section = sectionName(cat.nome)
    for (const item of cat.itens) {
      let id = slug(item.nome) || `p${out.length + 1}`
      while (ids.has(id)) id += '-2'
      ids.add(id)
      const active = !cat.oculto && !item.oculto && !item.esgotado
      const notes = [item.desc, item.rendimento].filter(Boolean)
      if (item.sabores?.lista?.length) {
        notes.push(`Sabores: ${item.sabores.lista.join(', ')}${item.sabores.max ? ` (até ${item.sabores.max} por pedido)` : ''}.`)
      }
      if (item.precoKg) {
        const name = /^bolo\b/i.test(item.nome) ? item.nome : `Bolo ${item.nome}`
        out.push({
          id, name, category: section, active,
          price: round2(item.precoKg * pesos[0]),
          description: [...notes, `${money(item.precoKg)} o kg.`].join(' '),
          sizes: pesos.map(w => ({ name: kg(w), price: round2(item.precoKg! * w) })),
          ...(massas.length ? { extras: massas } : {}),
        })
      } else if (item.opcoes?.length) {
        out.push({
          id, name: item.nome, category: section, active,
          price: Math.min(...item.opcoes.map(o => o.preco)),
          description: notes.join(' '),
          // "Cento (100 un.)" -> "Cento – 100 un." (no pedido o tamanho já aparece entre parênteses)
          sizes: item.opcoes.map(o => ({ name: o.nome.replace(/\s*\((.+)\)\s*$/, ' – $1'), price: o.preco })),
        })
      } else {
        out.push({ id, name: item.nome, category: section, active, price: item.preco ?? 0, description: notes.join(' ') })
      }
    }
  }
  return out
}

function priceRange (values: number[]): string {
  const v = [...new Set(values)].sort((a, b) => a - b)
  if (!v.length) return ''
  return v.length === 1 ? money(v[0]) : `de ${money(v[0])} a ${money(v.at(-1)!)}`
}

/** Respostas do Conhecimento preenchidas com os dados do catálogo. */
function variables (data: CatalogData, items: Product[]): Record<string, string> {
  const vars: Record<string, string> = {}
  const set = (k: string, v: string | undefined | false) => { if (v && v.trim()) vars[k] = v.trim() }
  const pay = data.pagamento ?? {}
  const methods = [
    pay.pix?.ativo && 'Pix', pay.credito && 'cartão de crédito', pay.debito && 'débito', pay.dinheiro && 'dinheiro',
    pay.transferencia && 'transferência',
  ].filter(Boolean) as string[]
  set('formas_pagamento', methods.length > 1 ? `${methods.slice(0, -1).join(', ')} e ${methods.at(-1)}` : methods[0])
  if (pay.pix?.ativo) set('chave_pix', pay.pix.chave ? `${pay.pix.chave}${pay.pix.titular ? ` (${pay.pix.titular})` : ''}` : '')
  set('parcelamento', pay.obsCartao)
  const e = data.entrega ?? {}
  if (data.pedidos?.entrega) {
    set('faz_entrega', `Fazemos entrega sim! ${e.area ? `Atendemos ${e.area}.` : ''}`)
    set('area_entrega', e.area)
    if (e.taxa) set('taxa_entrega', money(e.taxa))
    set('tempo_entrega', e.tempo)
  }
  if (e.pedidoMinimo) set('pedido_minimo', money(e.pedidoMinimo))
  if (data.pedidos?.retirada) set('retirada', 'Pode sim! É só fazer o pedido por aqui e combinar o horário pra retirar. 😊')
  if (data.redes?.instagram) set('instagram', `@${data.redes.instagram.replace(/^@/, '')}`)
  // Só é promoção se o destaque do site falar de preço/desconto ("Encomendas" é só um aviso)
  const promoText = [data.promo?.titulo, data.promo?.texto].filter(Boolean).join(' — ')
  if (data.promo?.ativo && /promo|desconto|off|%|gr[aá]tis|leve|compre|por apenas/i.test(promoText)) set('promocoes', [data.promo.titulo, data.promo.texto].filter(Boolean).join(' — '))
  const top = (data.categorias ?? []).filter(c => !c.oculto).flatMap(c => c.itens.filter(i => i.tags?.some(t => /mais pedido/i.test(t))).map(i => i.nome))
  set('destaques', top.length ? `Os mais pedidos: ${top.join(', ')}.` : '')

  // Confeitaria
  if (data.pedidos?.encomenda) {
    set('antecedencia', data.pedidos.avisoEncomenda || `Encomendas com no mínimo ${data.pedidos.antecedenciaDias ?? 1} dia(s) de antecedência.`)
  }
  const byKg = items.filter(p => p.active && p.sizes?.length && /o kg\.$/.test(p.description ?? ''))
  if (byKg.length) {
    const perKg = [...new Set((data.categorias ?? []).flatMap(c => c.itens.map(i => i.precoKg).filter(Boolean) as number[]))].sort((a, b) => a - b)
    const list = perKg.map(v => money(v))
    set('precos_bolos', `Bolos confeitados por kg: ${list.length > 1 ? `${list.slice(0, -1).join(', ')} ou ${list.at(-1)}` : list[0]} o kg, conforme o recheio.`)
    const pesos = data.bolosKg?.pesos ?? []
    if (pesos.length) set('pesos', `Fazemos bolos de ${kg(pesos[0])} a ${kg(pesos.at(-1)!)} (${pesos.map(kg).join(', ')}).`)
    const f = data.bolosKg?.fatiasPorKg
    if (f) set('fatias_por_kg', `Cada kg serve cerca de ${f} fatias — por exemplo, 2 kg ≈ ${f * 2} fatias e 3 kg ≈ ${f * 3} fatias.`)
    const ms = data.bolosKg?.massas ?? []
    if (ms.length) set('massas', `Massas: ${ms.map(m => `${m.nome.toLowerCase()}${m.acrescimo ? ` (+${money(m.acrescimo)})` : ''}`).join(' ou ')}.`)
    const topo = data.bolosKg?.topo
    set('nome_no_bolo', [
      data.bolosKg?.pedirNome && 'Escrevemos o nome ou a frase que você quiser no bolo — é só me dizer na hora do pedido. 😊',
      topo?.ativo && `Topo personalizado: ${topo.preco ? `+${money(topo.preco)}` : 'sob consulta'}.`,
    ].filter(Boolean).join(' '))
  }
  const doces = items.filter(p => p.active && /docinho/i.test(`${p.category} ${p.name}`) && p.sizes?.length)
  if (doces.length) {
    set('docinhos_info', doces.map(d => `${d.name}: ${d.sizes!.map(s => `${s.name.toLowerCase()} ${money(s.price)}`).join(', ')}`).join('; ') + '.')
    const sab = (data.categorias ?? []).flatMap(c => c.itens).find(i => i.sabores?.lista?.length)
    if (sab) set('sabores_docinhos', `${sab.nome}: ${sab.sabores!.lista.join(', ')}${sab.sabores!.max ? ` — você pode escolher até ${sab.sabores!.max} sabores por pedido` : ''}.`)
  }
  const caseiros = items.filter(p => p.active && /caseiro/i.test(p.category ?? ''))
  if (caseiros.length) {
    const comCalda = caseiros.filter(p => /calda/i.test(p.category ?? ''))
    const semCalda = caseiros.filter(p => !/calda/i.test(p.category ?? ''))
    set('bolos_caseiros', [
      semCalda.length && `Bolos caseiros (sem calda) ${priceRange(semCalda.map(p => p.price))}: ${semCalda.map(p => p.name.replace(/^Bolo (de )?/i, '')).join(', ')}.`,
      comCalda.length && `Com calda ${priceRange(comCalda.map(p => p.price))}: ${comCalda.map(p => p.name).join(', ')}.`,
    ].filter(Boolean).join(' '))
  }
  const kits = items.filter(p => p.active && /kit/i.test(p.category ?? ''))
  if (kits.length) set('kits_festa', kits.map(k => `${k.name} por ${money(k.price)} — ${k.description}`).join(' '))
  return vars
}

function extraInfo (data: CatalogData): string {
  const lines = [
    data.diferenciais?.length && `Diferenciais: ${data.diferenciais.join('; ')}.`,
    data.pedidos?.avisoEncomenda,
    data.entrega?.area && `Entrega: ${data.entrega.area}.`,
    data.pagamento?.obsCartao && `Cartão: ${data.pagamento.obsCartao}`,
    data.endereco?.linkMapa && `Localização no mapa: ${data.endereco.linkMapa}`,
    data.redes?.instagram && `Instagram: @${data.redes.instagram.replace(/^@/, '')}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/** Instruções da IA pensadas para o ramo (confeitaria ou loja/restaurante genérico). */
function aiInstructions (data: CatalogData): string {
  const lines = [`Você atende pela ${data.nome}.`]
  if (data.bolosKg && (data.categorias ?? []).some(c => c.itens.some(i => i.precoKg))) {
    lines.push(
      'Bolo confeitado: confirme sabor (recheio), peso em kg e massa (branca, ou de chocolate com acréscimo), e pergunte se quer nome ou frase no bolo — anote isso em "observacao".',
      `Ajude a calcular o peso pelo número de convidados: cada kg serve cerca de ${data.bolosKg.fatiasPorKg ?? 10} fatias.`,
      'Docinhos: confirme a quantidade (cento ou meio cento) e os sabores, e anote os sabores em "observacao".',
      'Quando o cliente pedir bolo para festa, você pode sugerir docinhos, sem insistir.',
    )
  }
  if (data.pedidos?.encomenda) lines.push(`Tudo é sob encomenda: lembre a antecedência mínima (${data.pedidos.antecedenciaDias ?? 1} dias) e confirme o dia e o horário.`)
  if (data.entrega?.area) lines.push(`Entrega: ${data.entrega.area}. Se o endereço for longe, diga que a taxa pode ser combinada com a equipe.`)
  if (data.pagamento?.pix?.ativo && !data.pagamento.pix.chave) lines.push('A chave Pix é enviada pela equipe depois da confirmação.')
  return lines.join('\n')
}

/** Cria (ou atualiza, preservando o que é do bot) o cliente a partir do catálogo. */
export function catalogToTenant (data: CatalogData, id: string, current?: TenantConfig): TenantConfig {
  const isBakery = Boolean(data.bolosKg && (data.categorias ?? []).some(c => c.itens.some(i => i.precoKg)))
  const base = current ?? newTenant(id, data.nome, isBakery ? 'confeitaria' : 'restaurante')
  const items = products(data)
  const a = data.endereco ?? {}
  const address = [[a.rua, a.bairro].filter(Boolean).join(', '), [a.cidade, a.uf].filter(Boolean).join('/'), a.cep && `CEP ${a.cep}`, a.referencia]
    .filter(Boolean).join(' — ')
  const hours = hoursText(data.horarios) || base.business.hours
  const imported = variables(data, items)
  const knowledge = base.knowledge ?? { packs: ['comum'], variables: {}, overrides: {} }

  const tenant: TenantConfig = {
    ...base,
    name: data.nome,
    business: {
      description: [data.chamada, data.slogan, data.sobre].filter(Boolean).join(' — '),
      hours,
      address,
      phone: data.contato?.telefone ?? base.business.phone,
      extraInfo: extraInfo(data),
    },
    products: items,
    knowledge: {
      ...knowledge,
      packs: current ? knowledge.packs : isBakery ? ['comum', 'confeitaria'] : ['comum', 'restaurante'],
      variables: { ...knowledge.variables, ...imported },
    },
    scheduling: data.pedidos?.encomenda ? { enabled: true, minDays: data.pedidos.antecedenciaDias ?? 1 } : undefined,
  }
  if (!current) {
    // Cliente novo: conversa já organizada para o ramo
    tenant.ai = { enabled: true, mode: 'agent', instructions: aiInstructions(data) }
    tenant.style = 'human'
    tenant.humanTimeoutMin = 60
    tenant.messages = {
      ...base.messages,
      welcome: `{saudacao}, {nome}! 😊 Aqui é da *{empresa}*${isBakery ? ' 🎂' : ''}. ${data.chamada ? `${data.chamada}${data.pedidos?.encomenda ? ' sob encomenda' : ''}.` : ''} Como posso te ajudar?`.replace(/\s+/g, ' ').trim(),
      orderConfirmed: data.pedidos?.encomenda
        ? '✅ Encomenda *{pedido}* anotada! Obrigada, {nome} 💕 Vamos confirmar tudo com você por aqui.'
        : base.messages.orderConfirmed,
      humanHandoff: 'Vou chamar alguém da equipe pra falar com você. Só um instantinho! 💕',
    }
    tenant.menu = [
      { key: '1', label: 'Ver o cardápio e fazer pedido', type: 'catalog' },
      { key: '2', label: 'Horário, endereço e entrega', type: 'text', text: `🕘 *{empresa}*\nHorário: ${hours}\nEndereço: ${address}${data.entrega?.area ? `\nEntrega: ${data.entrega.area}` : ''}` },
      { key: '3', label: 'Tirar uma dúvida', type: 'ai' },
      { key: '4', label: 'Falar com atendente', type: 'human' },
    ]
    tenant.synonyms = isBakery
      ? { kitkat: 'kit kat', 'kit-kat': 'kit kat', 'sonho valsa': 'sonho de valsa', 'brigadeiro preto': 'brigadeiro', 'bolo de pote': 'bolo' }
      : base.synonyms
  }
  return tenant
}
