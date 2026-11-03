import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export interface Session {
  role: 'admin' | 'tenant'
  tenantId?: string
  /** Super Admin vendo o painel como o cliente ("Ver como cliente"). */
  impersonating?: boolean
  exp: number
}

const COOKIE = 'sid'
const SESSION_HOURS = 12

export function hashPassword (password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword (password: string, stored: string | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = crypto.scryptSync(password, salt, expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

export function safeEqual (a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export class Auth {
  constructor (
    private readonly secret: string,
    /** Cliente suspenso (mensalidade atrasada) perde o acesso ao painel. */
    private readonly isSuspended: (tenantId: string) => boolean = () => false,
  ) {}

  private sign (payload: string): string {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url')
  }

  issue (res: Response, session: Omit<Session, 'exp'>): void {
    const payload = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + SESSION_HOURS * 3600_000 }))
      .toString('base64url')
    res.cookie(COOKIE, `${payload}.${this.sign(payload)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true', // com HTTPS na VPS
      maxAge: SESSION_HOURS * 3600_000,
    })
  }

  clear (res: Response): void {
    res.clearCookie(COOKIE)
  }

  read (req: Request): Session | undefined {
    const raw = parseCookies(req.headers.cookie)[COOKIE]
    if (!raw) return undefined
    const [payload, sig] = raw.split('.')
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) return undefined
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
      return session.exp > Date.now() ? session : undefined
    } catch {
      return undefined
    }
  }

  /** Exige login; o admin acessa todos os clientes, o cliente só o próprio :tenantId. */
  required = (req: Request, res: Response, next: NextFunction): void => {
    const session = this.read(req)
    if (!session) { res.status(401).json({ error: 'Faça login.' }); return }
    if (session.role === 'tenant' && !session.impersonating && this.isSuspended(session.tenantId ?? '')) {
      res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o suporte.', suspended: true })
      return
    }
    const tenantId = req.params.tenantId
    if (tenantId && session.role !== 'admin' && session.tenantId !== tenantId) {
      res.status(403).json({ error: 'Sem acesso a este cliente.' })
      return
    }
    res.locals.session = session
    next()
  }

  adminOnly = (_req: Request, res: Response, next: NextFunction): void => {
    if ((res.locals.session as Session | undefined)?.role !== 'admin') {
      res.status(403).json({ error: 'Apenas o administrador.' })
      return
    }
    next()
  }
}

function parseCookies (header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
