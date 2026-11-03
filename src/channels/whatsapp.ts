import fs from 'node:fs'
import wwebjs from 'whatsapp-web.js'
import type WAWebJS from 'whatsapp-web.js'
import type { Engine } from '../engine/engine.js'
import { readingDelayMs, sleep, typingDelayMs } from '../engine/typing.js'
import type { Store } from '../store.js'

const { Client, LocalAuth } = wwebjs

export type BotStatus = 'stopped' | 'starting' | 'qr' | 'online' | 'error'

export interface BotInfo {
  status: BotStatus
  qr?: string
  user?: string
  error?: string
}

interface BotEntry extends BotInfo {
  client: WAWebJS.Client
}

export interface BotManagerOptions {
  /** Chrome/Edge usado pelo WhatsApp Web (o npm não baixa o Chrome do puppeteer). */
  browserPath?: string
  sessionsDir: string
  /** Simula leitura e "digitando…" antes de cada resposta. */
  humanTyping: boolean
}

/** Ignora grupos, status e canais: o bot atende só conversas individuais. */
const IGNORED_CHATS = /@(g\.us|broadcast|newsletter)$/

/**
 * Mantém um cliente whatsapp-web.js (um número de WhatsApp) por cliente do SaaS
 * e liga as mensagens recebidas ao motor do chatbot.
 */
export class BotManager {
  private bots = new Map<string, BotEntry>()

  constructor (
    private readonly engine: Engine,
    private readonly store: Store,
    private readonly options: BotManagerOptions,
  ) {
    fs.mkdirSync(options.sessionsDir, { recursive: true })
  }

  info (tenantId: string): BotInfo {
    const entry = this.bots.get(tenantId)
    if (!entry) return { status: 'stopped' }
    const { status, qr, user, error } = entry
    return { status, qr, user, error }
  }

  async start (tenantId: string): Promise<void> {
    const existing = this.bots.get(tenantId)
    if (existing?.status === 'error') await this.stop(tenantId) // permite tentar de novo
    else if (existing) return
    const tenant = this.store.getTenant(tenantId)
    if (!tenant) throw new Error(`Cliente não encontrado: ${tenantId}`)
    if (tenant.suspended) throw new Error(`Cliente suspenso: ${tenantId}`)

    const client = new Client({
      // A sessão fica salva em data/sessions/session-<id>: não pede QR a cada reinício.
      authStrategy: new LocalAuth({ clientId: tenantId, dataPath: this.options.sessionsDir }),
      puppeteer: {
        headless: true,
        executablePath: this.options.browserPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    })
    const entry: BotEntry = { client, status: 'starting' }
    this.bots.set(tenantId, entry)

    client
      .on('qr', qr => {
        entry.status = 'qr'
        entry.qr = qr
      })
      .on('authenticated', () => {
        entry.status = 'starting'
        entry.qr = undefined
      })
      .on('ready', () => {
        entry.status = 'online'
        entry.qr = undefined
        entry.error = undefined
        entry.user = client.info?.pushname || client.info?.wid?.user
        console.log(`[bot] ${tenantId} conectado como ${entry.user}`)
      })
      .on('auth_failure', message => {
        entry.status = 'error'
        entry.error = `Falha na autenticação: ${message}`
        console.error(`[bot] ${tenantId} ${entry.error}`)
      })
      .on('disconnected', reason => {
        entry.status = 'error'
        entry.user = undefined
        entry.error = `Desconectado (${reason}). Clique em Conectar para gerar um novo QR Code.`
        console.log(`[bot] ${tenantId} desconectado: ${reason}`)
      })
      .on('message', msg => {
        this.onMessage(tenantId, entry, msg).catch(err =>
          console.error(`[bot] ${tenantId} falha ao responder:`, err instanceof Error ? err.message : err))
      })

    try {
      await client.initialize()
    } catch (err) {
      entry.status = 'error'
      entry.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async stop (tenantId: string): Promise<void> {
    const entry = this.bots.get(tenantId)
    if (!entry) return
    this.bots.delete(tenantId)
    await entry.client.destroy().catch(() => {})
  }

  async stopAll (): Promise<void> {
    await Promise.all([...this.bots.keys()].map(id => this.stop(id)))
  }

  /** Envia uma mensagem do atendente (painel) para o cliente final. */
  async send (tenantId: string, chatId: string, text: string): Promise<void> {
    const entry = this.bots.get(tenantId)
    if (!entry || entry.status !== 'online') throw new Error('O WhatsApp deste cliente não está conectado.')
    await entry.client.sendMessage(chatId, text)
  }

  private async onMessage (tenantId: string, entry: BotEntry, msg: WAWebJS.Message): Promise<void> {
    if (msg.fromMe || IGNORED_CHATS.test(msg.from)) return
    if (Date.now() / 1000 - msg.timestamp > 120) return // ignora mensagens antigas sincronizadas ao conectar

    const contact = await msg.getContact().catch(() => undefined)
    const text = msg.type === 'chat' ? msg.body : ''

    const replies = await this.engine.handle({
      tenantId,
      chatId: msg.from,
      name: contact?.pushname || contact?.name || '',
      text,
      channel: 'whatsapp',
    })
    if (replies.length === 0) return
    if (!this.options.humanTyping) {
      for (const reply of replies) await entry.client.sendMessage(msg.from, reply)
      return
    }

    // Como uma pessoa: lê (visto azul), digita ("digitando…") e só então envia cada mensagem
    const chat = await msg.getChat().catch(() => undefined)
    await chat?.sendSeen().catch(() => {})
    await sleep(readingDelayMs())
    for (const reply of replies) {
      await chat?.sendStateTyping().catch(() => {})
      await sleep(typingDelayMs(reply))
      await entry.client.sendMessage(msg.from, reply)
    }
    await chat?.clearState().catch(() => {})
  }
}
