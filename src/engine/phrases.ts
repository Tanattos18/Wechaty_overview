/**
 * Frases com variações, para o bot não repetir sempre o mesmo texto
 * e soar como um atendente de verdade.
 */
export type Random = () => number

export function pick<T> (list: readonly T[], random: Random): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]
}

/** "Bom dia" / "Boa tarde" / "Boa noite" no horário de Brasília. */
export function periodGreeting (date: Date): string {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(date))
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite'
}

export const PHRASES = {
  howCanIHelp: ['Como posso te ajudar?', 'Em que posso te ajudar?', 'Me conta, como posso ajudar?', 'O que você precisa hoje?'],
  followUp: ['Posso ajudar em mais alguma coisa?', 'Quer saber mais alguma coisa?', 'Mais alguma dúvida? 😊', 'Precisa de mais alguma coisa?'],
  thanks: ['Por nada{nome}! 😊', 'Imagina{nome}! Qualquer coisa, é só chamar. 😊', 'Disponha{nome}! 🙌', 'Eu que agradeço{nome}! 😊'],
  bye: ['Até mais! 👋 Quando precisar, é só chamar.', 'Tchau! Foi um prazer te atender. 😊', 'Até logo! Qualquer coisa, estou por aqui. 👋'],
  notUnderstood: ['Hmm, acho que não entendi direito. 😅', 'Desculpa, não consegui entender muito bem.', 'Opa, não entendi bem o que você quis dizer. 😅'],
  rephrase: ['Pode me explicar de outro jeito?', 'Consegue me dizer de outra forma?', 'Pode escrever de novo, com outras palavras?'],
  noInfo: ['Essa informação eu não tenho aqui agora. 🤔', 'Boa pergunta! Isso eu preciso confirmar com a equipe. 🤔', 'Hmm, sobre isso eu não tenho certeza.'],
  offerHuman: [
    'Quer que eu chame alguém da equipe pra te responder? É só digitar *atendente*.',
    'Se quiser, digite *atendente* que uma pessoa da equipe te responde rapidinho.',
  ],
  added: ['Anotado! ✅', 'Perfeito, anotei! ✅', 'Show, já coloquei no seu pedido! ✅', 'Prontinho! ✅'],
  offerDecline: ['Tudo bem! Se mudar de ideia, é só me chamar. 😊', 'Sem problemas! 😊 Posso ajudar com mais alguma coisa?'],
  catalogIntro: ['Claro! Olha só o que temos: 👇', 'Vou te mandar nossas opções: 👇', 'Aqui está! 👇'],
  cartFooter: [
    'Quer mais alguma coisa? Quando terminar, é só dizer *finalizar*.',
    'Mais alguma coisa? Se for só isso, me diga *finalizar*. 😊',
  ],
  askName: ['Ótimo! Pra finalizar, qual é o seu nome?', 'Perfeito! Me diz seu nome pra eu fechar o pedido?'],
  cancelled: ['Tudo bem, cancelei o pedido. 👍', 'Pronto, pedido cancelado. 👍'],
} as const
