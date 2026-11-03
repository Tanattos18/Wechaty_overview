import Anthropic from '@anthropic-ai/sdk'
import type { AiResponder, AiResult, Conversation, TenantConfig } from '../types.js'
import { formatPrice } from './engine.js'

const HISTORY_LIMIT = 16
const HANDOFF_MARK = '[ATENDENTE]'
const MISSING_MARK = '[SEM_INFO]'

const HANDOFF_TOOL: Anthropic.Beta.BetaTool = {
  name: 'transferir_para_atendente',
  description: 'Transfere a conversa para um atendente humano da empresa. Use quando o cliente pedir para falar ' +
    'com uma pessoa, fizer uma reclamação, ou perguntar algo que as informações do negócio não respondem.',
  input_schema: {
    type: 'object',
    properties: { motivo: { type: 'string', description: 'Resumo curto do motivo da transferência' } },
    required: ['motivo'],
    additionalProperties: false,
  },
  strict: true,
}

/** Texto estável por cliente: fica no cache de prompt entre as mensagens. */
export function systemPrompt (tenant: TenantConfig): string {
  const option = (o: { name: string, price: number }) => `${o.name} ${formatPrice(o.price)}`
  const products = tenant.products.filter(p => p.active)
    .map((p, i) => `${i + 1} - ${p.name}: ${formatPrice(p.price)}${p.description ? ` (${p.description})` : ''}` +
      (p.sizes?.length ? ` | tamanhos: ${p.sizes.map(option).join(', ')}` : '') +
      (p.extras?.length ? ` | adicionais: ${p.extras.map(option).join(', ')}` : ''))
    .join('\n') || '(sem produtos cadastrados)'
  const variables = Object.entries(tenant.knowledge?.variables ?? {})
    .filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')

  return `Você é atendente de WhatsApp da empresa "${tenant.name}". Atende clientes finais em português do Brasil, como uma pessoa da equipe.

Como responder:
- Mensagens curtas, simpáticas e naturais, no estilo de WhatsApp (no máximo 3 parágrafos curtos, 1 emoji no máximo). Pode usar *negrito* do WhatsApp; não use Markdown de títulos, listas longas ou tabelas.
- Não diga que é uma IA, robô ou assistente virtual, a não ser que perguntem diretamente.
- Use somente as informações abaixo. Nunca invente preços, prazos, promoções, endereços ou políticas. Se algo não estiver nas informações, não afirme nem negue: diga com naturalidade que não tem essa informação agora, ajude com o que souber e termine com a marca ${MISSING_MARK} (ela não aparece para o cliente e avisa a empresa para cadastrar). Não chame atendente só por isso.
- Pedidos são anotados pelo sistema quando o cliente escreve o produto e a quantidade (ex.: "quero 2 calabresa"). Você não anota pedidos: se o cliente quiser pedir, indique o produto e convide-o a escrever assim. Para fechar o pedido ele escreve *finalizar*.
- Leve em conta o pedido já anotado (abaixo): não ofereça de novo o que já está nele.
- Só chame um atendente se o cliente pedir para falar com uma pessoa, reclamar ou estiver insatisfeito, ou se for questão de saúde (alergia, restrição alimentar). Nesses casos, responda o que souber e termine a mensagem com a marca ${HANDOFF_MARK} (ela chama um atendente e não aparece para o cliente; o sistema já avisa o cliente, então não repita que vai chamar alguém).

<negocio>
Descrição: ${tenant.business.description}
Horário de funcionamento: ${tenant.business.hours}
Endereço: ${tenant.business.address}
Telefone: ${tenant.business.phone}
${variables ? `${variables}\n` : ''}Informações adicionais e perguntas frequentes:
${tenant.business.extraInfo}
</negocio>

<produtos> (numerados como no cardápio que o cliente vê: "a 1" é o item 1)
${products}
</produtos>
${tenant.ai.instructions ? `\nInstruções específicas da empresa:\n${tenant.ai.instructions}\n` : ''}`
}

/** Pedido em andamento, para a IA não perder o contexto. */
function cartNote (conv: Conversation): string {
  if (!conv.cart.length) return ''
  return `\n\nPedido anotado até agora nesta conversa: ${conv.cart.map(i => `${i.qty}x ${i.name}`).join(', ')}.`
}

/** Converte o histórico da conversa em mensagens da API (cliente = user; bot/atendente = assistant). */
function toMessages (conv: Conversation): Anthropic.Beta.BetaMessageParam[] {
  const recent = conv.messages.slice(-HISTORY_LIMIT)
  const firstUser = recent.findIndex(m => m.from === 'customer')
  if (firstUser < 0) return []
  return recent.slice(firstUser).map(m => ({
    role: m.from === 'customer' ? 'user' : 'assistant',
    content: m.text,
  }))
}

export function createClaudeResponder (model: string): AiResponder {
  // Criado no primeiro uso: sem credencial configurada o servidor sobe e o bot usa o fallback.
  let client: Anthropic | undefined

  return async (tenant, conv) => {
    const messages = toMessages(conv)
    if (messages.length === 0) return { text: '', handoff: false }

    client ??= new Anthropic({ maxRetries: 1, timeout: 30_000 })
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: systemPrompt(tenant), cache_control: { type: 'ephemeral' } }, { type: 'text', text: cartNote(conv) || ' ' }],
      tools: [HANDOFF_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return { text: 'Não consigo ajudar com isso por aqui. Vou chamar um atendente.', handoff: true }
    }

    const text = response.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .trim()
    const parsed = parseReply(text)
    const handoff = parsed.handoff || response.content.some(b => b.type === 'tool_use' && b.name === HANDOFF_TOOL.name)
    return { ...parsed, handoff }
  }
}

/** Separa a marca de transferência do texto que vai para o cliente. */
export function parseReply (raw: string): AiResult {
  const handoff = raw.includes(HANDOFF_MARK)
  const missing = raw.includes(MISSING_MARK)
  const text = raw.replaceAll(HANDOFF_MARK, '').replaceAll(MISSING_MARK, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  return missing ? { text, handoff, missing } : { text, handoff }
}

/**
 * IA pelo OpenRouter (API compatível com OpenAI). `models` é a lista de modelos em ordem de
 * preferência: se o primeiro estiver fora do ar ou no limite, o OpenRouter usa o próximo.
 */
export function createOpenRouterResponder (apiKey: string, models: string[]): AiResponder {
  return async (tenant, conv) => {
    const history = toMessages(conv)
    if (history.length === 0) return { text: '', handoff: false }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'SaaS ChatBot' },
      body: JSON.stringify({
        models,
        max_tokens: 1500,
        temperature: 0.6,
        reasoning: { effort: 'low', exclude: true },
        messages: [
          { role: 'system', content: systemPrompt(tenant) + cartNote(conv) },
          ...history,
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    const data = await res.json().catch(() => ({})) as {
      choices?: { message?: { content?: string | null } }[]
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? 'erro'}`)
    return parseReply(data.choices?.[0]?.message?.content ?? '')
  }
}
