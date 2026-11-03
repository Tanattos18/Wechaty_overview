import fs from 'node:fs'
import path from 'node:path'

/**
 * Frases que NÃO estão escritas nos pacotes, para medir se a busca generaliza.
 * Ficam em knowledge/qa-phrases.json porque a bateria de testes do painel usa as mesmas.
 * Cada item: mensagem do cliente e o "pacote/assunto" esperado (null = não deve responder).
 */
const phrases = JSON.parse(fs.readFileSync(path.resolve('knowledge/qa-phrases.json'), 'utf8')) as { text: string; expect: string | null }[]
export const CASES: [string, string | null][] = phrases.map(p => [p.text, p.expect])
