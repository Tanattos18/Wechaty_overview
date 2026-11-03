/**
 * Tempo que uma pessoa levaria para digitar a resposta: mais longa, mais demora.
 * Entre 1,2 s e 7 s, com uma variação aleatória para não parecer mecânico.
 * (O simulador do painel usa a mesma fórmula em app.js.)
 */
export function typingDelayMs (text: string, random: () => number = Math.random): number {
  const base = Math.min(7000, Math.max(1200, 900 + text.length * 28))
  return Math.round(base * (0.85 + random() * 0.3))
}

/** Pausa de "leitura" antes de começar a digitar. */
export function readingDelayMs (random: () => number = Math.random): number {
  return Math.round(600 + random() * 900)
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
