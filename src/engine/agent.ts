import type { Conversation, TenantConfig } from '../types.js'
import { formatPrice } from './engine.js'

/**
 * IA "funcionária": atende a conversa inteira com os dados do cliente e usa ferramentas para
 * anotar o pedido, fechar, cancelar e chamar um atendente. Preços e totais vêm sempre do sistema.
 */

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AgentRequest {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  tools: AgentTool[]
  /** Executa a ferramenta pedida pela IA e devolve o resultado em texto. */
  run: (name: string, args: Record<string, unknown>) => Promise<string> | string
}

export type AgentRunner = (req: AgentRequest) => Promise<string>

const HISTORY_LIMIT = 24
const MAX_ROUNDS = 6

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'adicionar_item',
    description: 'Anota um produto no pedido do cliente. Use quando o cliente disser que quer algo. O resultado traz o pedido atualizado com o total.',
    parameters: obj({
      produto: { type: 'string', description: 'Nome do produto ou o número dele no cardápio' },
      quantidade: { type: 'integer', description: 'Quantidade (padrão 1)' },
      tamanho: { type: 'string', description: 'Tamanho escolhido, se o produto tiver tamanhos' },
      adicionais: { type: 'array', items: { type: 'string' }, description: 'Adicionais escolhidos (ex.: borda recheada)' },
      meio_a_meio_com: { type: 'string', description: 'Segundo sabor, quando o cliente quer pizza meio a meio' },
    }, ['produto']),
  },
  {
    name: 'remover_item',
    description: 'Tira um item do pedido (ou diminui a quantidade).',
    parameters: obj({
      item: { type: 'string', description: 'Nome do item como está no pedido, ou o número da linha do pedido' },
      quantidade: { type: 'integer', description: 'Quantas unidades tirar (sem informar, tira o item todo)' },
    }, ['item']),
  },
  {
    name: 'ver_pedido',
    description: 'Mostra o pedido atual: itens, total e dados de entrega já informados.',
    parameters: obj({}),
  },
  {
    name: 'dados_entrega',
    description: 'Guarda o nome do cliente e o endereço de entrega (ou que ele vai retirar no local).',
    parameters: obj({
      nome: { type: 'string' },
      endereco: { type: 'string', description: 'Rua, número, bairro e complemento' },
      retirada: { type: 'boolean', description: 'true se o cliente vai buscar no local' },
      pagamento: { type: 'string', description: 'Forma de pagamento escolhida (e troco, se for dinheiro)' },
    }),
  },
  {
    name: 'confirmar_pedido',
    description: 'Registra o pedido para a empresa preparar. Só use depois de mostrar o resumo e o cliente responder que confirma.',
    parameters: obj({}),
  },
  {
    name: 'cancelar_pedido',
    description: 'Cancela o pedido em andamento (o cliente desistiu).',
    parameters: obj({}),
  },
  {
    name: 'chamar_atendente',
    description: 'Passa a conversa para uma pessoa da equipe. Use se o cliente pedir, reclamar ou estiver insatisfeito, ou em questões de saúde (alergias).',
    parameters: obj({ motivo: { type: 'string' } }, ['motivo']),
  },
  {
    name: 'informacao_nao_cadastrada',
    description: 'Avisa a empresa que o cliente perguntou algo que não está nas informações (para ela cadastrar depois).',
    parameters: obj({ pergunta: { type: 'string' } }, ['pergunta']),
  },
]

/** Tudo o que a "funcionária" precisa saber sobre a empresa, o cardápio e a conversa. */
export function agentPrompt (tenant: TenantConfig, conv: Conversation, faq: { title: string; answer: string }[], now: Date): string {
  const option = (o: { name: string; price: number }) => `${o.name} ${formatPrice(o.price)}`
  const products = tenant.products.filter(p => p.active)
    .map((p, i) => `${i + 1} - ${p.name}: ${formatPrice(p.price)}${p.description ? ` (${p.description})` : ''}` +
      (p.sizes?.length ? ` | tamanhos: ${p.sizes.map(option).join(', ')}` : '') +
      (p.extras?.length ? ` | adicionais: ${p.extras.map(option).join(', ')}` : ''))
    .join('\n') || '(sem produtos cadastrados)'
  const variables = Object.entries(tenant.knowledge?.variables ?? {})
    .filter(([, v]) => v?.trim()).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
  const half = tenant.halfHalf === 'off' ? 'Não fazemos pizza meio a meio.'
    : tenant.halfHalf === 'avg' ? 'Meio a meio: cobra a média dos dois sabores.'
      : tenant.halfHalf === 'max' ? 'Meio a meio: cobra o sabor mais caro.' : ''
  const when = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const agentName = tenant.ai.agentName?.trim()
  const cart = conv.cart.length
    ? conv.cart.map(i => `${i.qty}x ${i.name} — ${formatPrice(i.qty * i.price)}`).join('; ')
    : 'vazio'

  return `Você é ${agentName ? `${agentName}, ` : ''}atendente da empresa "${tenant.name}" no WhatsApp. Você faz parte da equipe: atende, tira dúvidas, ajuda a escolher e anota pedidos, como a melhor funcionária faria. Fale em português do Brasil.

Jeito de atender:
- Mensagens curtas e naturais de WhatsApp: simpática, direta, no máximo 1 emoji. Use *negrito* do WhatsApp. Nada de títulos Markdown ou tabelas; listas só para cardápio ou pedido (uma linha por item).
- Chame o cliente pelo nome quando souber${conv.name ? ` (nome no WhatsApp: ${conv.name})` : ''}. Não se apresente como IA ou robô; se perguntarem diretamente, diga que é a assistente virtual da empresa.
- Responda tudo o que o cliente perguntou na mensagem, e ajude a vender: sugira produtos do cardápio quando fizer sentido, sem insistir.
- Use SOMENTE as informações abaixo. Nunca invente preço, produto, prazo, promoção, endereço ou política. Se não souber, diga que não tem essa informação agora, ajude com o que souber e use a ferramenta informacao_nao_cadastrada. Não chame atendente só por isso.

Ordem do atendimento:
1. Início (contato): cumprimente pelo período do dia e pelo nome, diga de onde fala e pergunte como pode ajudar. Pode citar a promoção do dia, se houver.
2. Meio (conversa): tire dúvidas, mostre o cardápio quando pedirem, ajude a escolher e anote os itens. Depois de anotar, pergunte só se quer mais alguma coisa.
3. Fim (fechamento), só quando o cliente disser que terminou, nesta ordem e um passo por mensagem (pule o que ele já informou):
   a) confira o pedido (ver_pedido) e o pedido mínimo, se houver;
   b) confirme o nome;
   c) entrega ou retirada — se entrega, endereço com rua, número e bairro;
   d) forma de pagamento (se for dinheiro, pergunte o troco);
   e) guarde com dados_entrega e mostre o resumo: itens, subtotal, taxa de entrega (se houver), total, nome, entrega e pagamento — e pergunte se pode confirmar;
   f) só depois do "sim": confirmar_pedido, e informe o número do pedido, o tempo de entrega e, se for Pix, a chave Pix.

Pedidos (sempre pelas ferramentas — o sistema calcula preços e total):
- Cliente quer algo → chame adicionar_item na hora, um item por chamada (aceita o nome ou o número do cardápio). Só pergunte o tamanho se o produto tiver "tamanhos:" no cardápio ou se a ferramenta responder FALTA TAMANHO; sem isso, anote direto, sem perguntar tamanho. Confirme o que anotou usando o resultado da ferramenta.
- Antes de dizer o que está no pedido, confie no resultado das ferramentas (ou chame ver_pedido), nunca na memória.
- Pergunta não é pedido: só anote quando o cliente pedir.
- Não repita pedidos de dados que o cliente já deu. Use os totais que as ferramentas devolvem.
- Mudanças: remover_item, ou adicionar_item de novo. Desistiu: cancelar_pedido.
- Chame chamar_atendente se o cliente pedir uma pessoa, reclamar, estiver insatisfeito, ou em questão de saúde (alergia, restrição alimentar). Depois disso não diga mais nada além de avisar que alguém da equipe vai responder.

Agora: ${when} (horário de Brasília).
Pedido em andamento: ${cart}

<empresa>
Nome: ${tenant.name}
Descrição: ${tenant.business.description}
Horário de funcionamento: ${tenant.business.hours}
Endereço: ${tenant.business.address}
Telefone: ${tenant.business.phone}
${variables ? `${variables}\n` : ''}${half ? `${half}\n` : ''}Informações adicionais:
${tenant.business.extraInfo}
</empresa>

<cardapio> (numerado como o cliente vê: "a 1" é o item 1)
${products}
</cardapio>

<respostas_da_empresa> (respostas oficiais para dúvidas comuns; use o conteúdo, com suas palavras)
${faq.map(f => `- ${f.title}: ${f.answer.replace(/\s*\n\s*/g, ' ')}`).join('\n') || '(nenhuma)'}
</respostas_da_empresa>
${tenant.ai.instructions ? `\nInstruções da empresa (siga sempre):\n${tenant.ai.instructions}\n` : ''}`
}

/** Histórico recente: cliente = user; bot e atendente = assistant. */
export function agentHistory (conv: Conversation): AgentRequest['messages'] {
  const recent = conv.messages.slice(-HISTORY_LIMIT)
  const first = recent.findIndex(m => m.from === 'customer')
  if (first < 0) return []
  const out: AgentRequest['messages'] = []
  for (const m of recent.slice(first)) {
    const role = m.from === 'customer' ? 'user' : 'assistant'
    const last = out.at(-1)
    // Várias mensagens seguidas do mesmo lado viram uma só (algumas APIs exigem alternância)
    if (last?.role === role) last.content += `\n\n${m.text}`
    else out.push({ role, content: m.text })
  }
  return out
}

/** Agente pelo OpenRouter (API compatível com OpenAI, com ferramentas). */
export function createOpenRouterAgent (apiKey: string, models: string[]): AgentRunner {
  // Cota acabou (429): para de tentar por um tempo — enquanto isso o bot responde pelas regras
  let pausedUntil = 0
  return async ({ system, messages, tools, run }) => {
    if (Date.now() < pausedUntil) throw new Error('IA em pausa: cota do OpenRouter esgotada')
    const msgs: Record<string, unknown>[] = [{ role: 'system', content: system }, ...messages]
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'SaaS ChatBot' },
        body: JSON.stringify({
          models,
          max_tokens: 2000,
          temperature: 0.5,
          reasoning: { effort: 'low', exclude: true },
          tools: tools.map(t => ({ type: 'function', function: t })),
          tool_choice: 'auto',
          messages: msgs,
        }),
        signal: AbortSignal.timeout(45_000),
      })
      const data = await res.json().catch(() => ({})) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] } }[]
        error?: { message?: string }
      }
      if (res.status === 429) {
        const daily = /per-day/i.test(data.error?.message ?? '')
        pausedUntil = Date.now() + (daily ? 30 : 1) * 60_000
        console.error(`[ia] cota do OpenRouter esgotada${daily ? ' (limite diário dos modelos grátis — com crédito na conta o limite sobe)' : ''}; usando as regras por ${daily ? 30 : 1} min`)
      }
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? 'erro'}`)
      const message = data.choices?.[0]?.message
      const calls = message?.tool_calls ?? []
      if (!calls.length) return cleanText(message?.content ?? '')

      msgs.push({ role: 'assistant', content: message?.content ?? '', tool_calls: calls })
      for (const call of calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(call.function.arguments || '{}') } catch { /* argumentos inválidos: vazio */ }
        let output: string
        try { output = await run(call.function.name, args) } catch (err) {
          output = `ERRO: ${err instanceof Error ? err.message : String(err)}`
        }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: output })
      }
    }
    throw new Error('a IA usou ferramentas demais sem responder')
  }
}

/** Remove raciocínio exposto e marcas antigas que alguns modelos repetem. */
function cleanText (raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\[(ATENDENTE|SEM_INFO)\]/g, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // negrito Markdown -> negrito do WhatsApp
    .trim()
}
