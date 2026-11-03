import Anthropic from '@anthropic-ai/sdk'
import type { AiResponder, Conversation, TenantConfig } from '../types.js'
import { formatPrice } from './engine.js'

const HISTORY_LIMIT = 16

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
function systemPrompt (tenant: TenantConfig): string {
  const products = tenant.products.filter(p => p.active)
    .map(p => `- ${p.name}: ${formatPrice(p.price)}${p.description ? ` (${p.description})` : ''}`)
    .join('\n') || '(sem produtos cadastrados)'
  const menu = tenant.menu.map(o => `${o.key} - ${o.label}`).join('\n')

  return `Você é o assistente virtual de WhatsApp da empresa "${tenant.name}". Atende clientes finais em português do Brasil.

Como responder:
- Mensagens curtas, cordiais e diretas, no estilo de WhatsApp (no máximo 3 parágrafos curtos). Pode usar *negrito* do WhatsApp; não use Markdown de títulos ou tabelas.
- Use somente as informações abaixo. Não invente preços, prazos, promoções ou políticas. Se não souber, diga que vai chamar um atendente e use a ferramenta transferir_para_atendente.
- Para fazer pedidos, oriente o cliente a digitar *menu* e escolher a opção do catálogo — você não registra pedidos.
- Se o cliente pedir para falar com uma pessoa ou estiver insatisfeito, use transferir_para_atendente.

<negocio>
Descrição: ${tenant.business.description}
Horário de funcionamento: ${tenant.business.hours}
Endereço: ${tenant.business.address}
Telefone: ${tenant.business.phone}
Informações adicionais e perguntas frequentes:
${tenant.business.extraInfo}
</negocio>

<produtos>
${products}
</produtos>

<menu_do_bot>
${menu}
</menu_do_bot>
${tenant.ai.instructions ? `\nInstruções específicas da empresa:\n${tenant.ai.instructions}\n` : ''}`
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
      system: [{ type: 'text', text: systemPrompt(tenant), cache_control: { type: 'ephemeral' } }],
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
    const handoff = response.content.some(b => b.type === 'tool_use' && b.name === HANDOFF_TOOL.name)
    return { text, handoff }
  }
}
