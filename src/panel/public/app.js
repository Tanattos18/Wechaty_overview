// Painel — JavaScript puro, sem build.

const $ = (sel, root = document) => root.querySelector(sel)
const view = $('#view')

const TABS = {
  home: 'Início',
  clients: 'Clientes',
  requests: 'Pedidos de ajuste',
  quality: 'Qualidade do atendimento',
  connection: 'Conexão com WhatsApp',
  chats: 'Conversas',
  orders: 'Pedidos',
  knowledge: 'Base de conhecimento',
  config: 'Configuração do bot',
  simulator: 'Simulador',
}
const STATUS_LABEL = { stopped: 'Desligado', starting: 'Iniciando…', qr: 'Aguardando leitura do QR', online: 'Conectado', error: 'Erro' }
const ORDER_STATUS = ['novo', 'confirmado', 'preparando', 'enviado', 'concluido', 'cancelado']
const ORDER_LABEL = { novo: 'Novo', confirmado: 'Confirmado', preparando: 'Preparando', enviado: 'Saiu para entrega', concluido: 'Concluído', cancelado: 'Cancelado' }
const MENU_TYPES = { text: 'Resposta fixa', catalog: 'Catálogo / pedido', ai: 'Dúvidas com IA', human: 'Falar com atendente' }

const state = {
  me: null,
  brand: { name: 'Akylla Bot', color: '#0f9d7a' },
  tenants: [],
  tenantId: null,
  tab: 'home',
  chatId: null,
  simChatId: null,
  config: null,
  poll: null,
  dirty: false,
  alerts: null,
}

// ---------- ícones (traço fino, herdam a cor do texto) ----------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.4-5.2A8.5 8.5 0 1 1 21 11.5z"/>',
  orders: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11.5h6M9 15.5h4"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  flask: '<path d="M9 2.5h6M10 2.5v6L4.6 18.4A2 2 0 0 0 6.4 21.5h11.2a2 2 0 0 0 1.8-3.1L14 8.5v-6"/><path d="M7.2 15h9.6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2.5h6V4M9 10h6M9 14h6M9 18h3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M8.6 3.6A6 6 0 0 1 18 9c0 3 .6 4.9 1.3 6M6 9c0 6-2.5 7.5-2.5 7.5H16M10 20a2 2 0 0 0 4 0M3 3l18 18"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3.5" r="1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  thumbDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
}
const icon = (name, size = 20) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`

// ---------- utilidades ----------

async function api (method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Sessão expirada.') }
  if (res.status === 403 && data.suspended) {
    showLogin()
    $('#login-error').textContent = data.error
    throw new Error(data.error)
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  if (method !== 'GET') state.dirty = false // algo foi salvo: não há mais alterações pendentes
  return data
}
const tenantUrl = (path = '') => `/api/tenants/${encodeURIComponent(state.tenantId)}${path}`

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** Escapa e aplica a formatação do WhatsApp (*negrito* e _itálico_). */
const waFormat = s => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const time = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hour = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Iniciais e cor estável a partir do nome, para os avatares. */
const AVATAR_TONES = ['#0f9d7a', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#9333ea']
function avatar (name, size = 40) {
  const clean = String(name || '?').trim()
  const initials = clean.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  let h = 0
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `<span class="avatar" style="--av:${AVATAR_TONES[h % AVATAR_TONES.length]};width:${size}px;height:${size}px">${esc(initials)}</span>`
}

/** Tela vazia com ilustração. */
function emptyState (iconName, title, text = '') {
  return `<div class="empty-state">
    <div class="empty-art">${icon(iconName, 34)}</div>
    <h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
  </div>`
}

/** Blocos cinza animados enquanto a tela carrega. */
function skeleton () {
  return `<div class="skeleton-wrap" aria-busy="true" aria-label="Carregando">
    <div class="sk-row">${'<div class="sk sk-card"></div>'.repeat(4)}</div>
    <div class="sk sk-block"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div>
  </div>`
}

function toast (msg, kind = '') {
  const el = $('#toast')
  el.innerHTML = `${kind === 'error' ? icon('alert', 18) : icon('check', 18)}<span>${esc(msg)}</span>`
  el.className = `toast show ${kind}`
  clearTimeout(toast.t)
  toast.t = setTimeout(() => el.classList.remove('show'), 2800)
}

function stopPolling () { clearInterval(state.poll); state.poll = null }
function startPolling (fn, ms = 4000) { stopPolling(); state.poll = setInterval(() => fn().catch(() => {}), ms) }

// ---------- marca e tema ----------

async function loadBrand () {
  try { state.brand = await api('GET', '/api/brand') } catch { /* usa o padrão */ }
  const { name, color } = state.brand
  const root = document.documentElement
  root.style.setProperty('--brand', color)
  // Tom validado para gráficos no tema escuro quando a cor é a padrão; senão, clareia a cor da marca
  root.style.setProperty('--brand-dark', color.toLowerCase() === '#0f9d7a' ? '#1aa883' : `color-mix(in oklab, ${color} 82%, white)`)
  document.title = name
  for (const el of document.querySelectorAll('[data-brand-name]')) el.textContent = name
  for (const el of document.querySelectorAll('[data-brand-logo]')) el.innerHTML = logoMark(30)
  const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color}"/><path d="M48 31a16 16 0 0 1-23.2 14.3L16 47l2.6-8.2A16 16 0 1 1 48 31z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><circle cx="25" cy="31" r="2.6" fill="#fff"/><circle cx="32" cy="31" r="2.6" fill="#fff"/><circle cx="39" cy="31" r="2.6" fill="#fff"/></svg>`
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(fav)}`
}

function logoMark (size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--brand)"/><path d="M48 31a16 16 0 0 1-23.2 14.3L16 47l2.6-8.2A16 16 0 1 1 48 31z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><circle cx="25" cy="31" r="2.6" fill="#fff"/><circle cx="32" cy="31" r="2.6" fill="#fff"/><circle cx="39" cy="31" r="2.6" fill="#fff"/></svg>`
}

const THEMES = ['system', 'light', 'dark']
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' }
const THEME_LABEL = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' }
function getTheme () { try { return localStorage.getItem('theme') || 'system' } catch { return 'system' } }
function applyTheme (theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  const btn = $('#theme-toggle')
  if (btn) { btn.innerHTML = icon(THEME_ICON[theme]); btn.title = THEME_LABEL[theme]; btn.setAttribute('aria-label', THEME_LABEL[theme]) }
}
$('#theme-toggle').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length]
  try { localStorage.setItem('theme', next) } catch {}
  applyTheme(next)
  toast(THEME_LABEL[next])
  if (state.tab === 'home') renderHome().catch(() => {}) // gráficos usam a cor do tema
})

// ---------- avisos: som e notificação do navegador ----------

function alertsEnabled () { try { return localStorage.getItem('alerts') === 'on' } catch { return false } }
function renderAlertsButton () {
  const on = alertsEnabled()
  const btn = $('#alerts-toggle')
  btn.innerHTML = icon(on ? 'bell' : 'bellOff')
  btn.title = on ? 'Avisos ligados (som e notificação)' : 'Ligar avisos de pedido novo e atendimento'
  btn.classList.toggle('on', on)
}
$('#alerts-toggle').addEventListener('click', async () => {
  const on = !alertsEnabled()
  if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  try { localStorage.setItem('alerts', on ? 'on' : 'off') } catch {}
  renderAlertsButton()
  if (on) { beep(); toast('Avisos ligados: você ouvirá um som em pedidos novos e pedidos de atendente.') } else toast('Avisos desligados.')
})

let audioCtx
function beep () {
  try {
    audioCtx ??= new AudioContext()
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.frequency.value = freq
      osc.connect(gain).connect(audioCtx.destination)
      const t = audioCtx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.start(t)
      osc.stop(t + 0.17)
    }
  } catch { /* navegador sem áudio */ }
}

function notify (title, body, tab) {
  if (!alertsEnabled()) return
  beep()
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification(title, { body, icon: $('#favicon').href, tag: tab })
    n.onclick = () => { window.focus(); openTab(tab); n.close() }
  }
}

// ---------- login ----------

function showLogin () {
  stopPolling()
  $('#app').classList.add('hidden')
  $('#login').classList.remove('hidden')
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault()
  const form = new FormData(e.target)
  $('#login-error').textContent = ''
  const btn = e.submitter
  btn.disabled = true
  try {
    await api('POST', '/api/login', { tenantId: form.get('tenantId'), password: form.get('password') })
    e.target.reset()
    await boot()
  } catch (err) {
    $('#login-error').textContent = err.message
  } finally { btn.disabled = false }
})

$('#logout').addEventListener('click', async () => {
  if (!confirmLeave()) return
  await api('POST', '/api/logout').catch(() => {})
  showLogin()
})

// ---------- alterações não salvas ----------

view.addEventListener('input', e => {
  if (e.target.closest('.config') && !e.target.matches('#kb-test, #sim-input, #sim-name')) state.dirty = true
})
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = '' } })
function confirmLeave () {
  if (!state.dirty) return true
  if (!confirm('Você tem alterações não salvas. Sair mesmo assim?')) return false
  state.dirty = false
  return true
}

// ---------- navegação ----------

for (const b of document.querySelectorAll('#nav button[data-icon]')) {
  b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon))
}
$('#logout').insertAdjacentHTML('afterbegin', icon('logout', 18))

$('#nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]')
  if (btn) openTab(btn.dataset.tab)
})

$('#tenant-select').addEventListener('change', e => {
  if (!confirmLeave()) { e.target.value = state.tenantId; return }
  state.tenantId = e.target.value
  state.chatId = null
  state.simChatId = null
  state.config = null
  state.alerts = null
  openTab(state.tab)
})

async function loadTenants () {
  state.tenants = await api('GET', '/api/tenants')
  const select = $('#tenant-select')
  select.innerHTML = state.tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')
  if (!state.tenants.some(t => t.id === state.tenantId)) state.tenantId = state.tenants[0]?.id ?? null
  select.value = state.tenantId ?? ''
  select.classList.toggle('hidden', state.me.role !== 'admin')
}

const isAdmin = () => state.me?.role === 'admin'
const can = perm => isAdmin() || Boolean(state.me?.clientCan?.[perm])

async function boot () {
  state.me = await api('GET', '/api/me')
  $('#login').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#new-tenant').classList.toggle('hidden', !isAdmin())
  $('#user-name').textContent = isAdmin() ? 'Super Admin' : (state.me.tenantName ?? '')
  $('#user-role').textContent = isAdmin() ? 'Acesso total' : `Plano ${state.me.plan?.name ?? ''}`
  $('#user-avatar').innerHTML = avatar(isAdmin() ? 'Super Admin' : state.me.tenantName, 34)

  // Abas por perfil: o cliente vê o dia a dia; a configuração só se o Super Admin liberou
  const visible = {
    clients: isAdmin(),
    config: isAdmin() || can('info') || can('products'),
  }
  for (const b of document.querySelectorAll('#nav button[data-tab]')) {
    b.classList.toggle('hidden', visible[b.dataset.tab] === false)
  }
  $('#impersonation').classList.toggle('hidden', !state.me.impersonating)
  $('#impersonation-name').textContent = state.me.tenantName ?? ''

  await loadTenants()
  if (!boot.started || (state.tab === 'clients' && !isAdmin()) || (state.tab === 'config' && !visible.config)) {
    state.tab = 'home'
  }
  boot.started = true
  state.alerts = null
  openTab(state.tab)
  renderAlertsButton()
  updateBadges().catch(() => {})
  boot.badges ??= setInterval(() => updateBadges().catch(() => {}), 8000)
}

$('#impersonation-stop').addEventListener('click', async () => {
  await api('POST', '/api/impersonate/stop')
  state.tab = 'clients'
  await boot()
})

async function updateBadges () {
  let pending = 0
  if (isAdmin()) {
    const all = await api('GET', '/api/requests')
    pending = all.filter(r => r.status === 'aberto').length
    setBadge('#badge-requests', pending)
  }
  if (!state.tenantId) return
  const [convs, orders, unanswered] = await Promise.all([
    api('GET', tenantUrl('/conversations')), api('GET', tenantUrl('/orders')), api('GET', tenantUrl('/knowledge/unanswered')),
  ])
  const waiting = convs.filter(c => c.needsAgent || (c.unread > 0 && c.state === 'human')).length
  const fresh = orders.filter(o => o.status === 'novo')
  setBadge('#badge-chats', waiting)
  setBadge('#badge-orders', fresh.length)
  setBadge('#badge-knowledge', unanswered.length)

  // Avisa só o que é novo desde a última verificação
  const freshIds = new Set(fresh.map(o => o.id))
  const waitingIds = new Set(convs.filter(c => c.needsAgent).map(c => c.chatId))
  if (state.alerts) {
    const newOrders = fresh.filter(o => !state.alerts.orders.has(o.id))
    const newWaiting = convs.filter(c => c.needsAgent && !state.alerts.waiting.has(c.chatId))
    if (newOrders.length) notify('🧾 Pedido novo!', `${newOrders[0].customerName}: ${money(newOrders[0].total)}`, 'orders')
    else if (newWaiting.length) notify('🙋 Cliente pedindo atendente', newWaiting[0].name || 'Nova conversa', 'chats')
  }
  state.alerts = { orders: freshIds, waiting: waitingIds }
  const total = waiting + fresh.length + pending
  document.title = total ? `(${total}) ${state.brand.name}` : state.brand.name
}
function setBadge (sel, n) {
  const el = $(sel)
  el.textContent = n
  el.classList.toggle('hidden', !n)
}

function openTab (tab) {
  if (tab !== state.tab && !confirmLeave()) return
  state.dirty = false
  stopPolling()
  state.viewAbort?.abort() // eventos registrados pela tela anterior
  state.viewAbort = new AbortController()
  state.tab = tab
  $('#title').textContent = TABS[tab]
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('active', b.dataset.tab === tab)
  // Visões gerais do Super Admin não dependem do cliente selecionado
  $('.tenant-picker').classList.toggle('hidden', (tab === 'clients' || tab === 'requests') && isAdmin())
  if (!state.tenantId && !['clients', 'home'].includes(tab) && !(tab === 'requests' && isAdmin())) {
    view.innerHTML = emptyState('users', 'Nenhum cliente cadastrado', 'Use “+ Novo cliente” para começar.')
    return
  }
  view.innerHTML = skeleton()
  view.classList.remove('enter')
  void view.offsetWidth // reinicia a animação de entrada
  view.classList.add('enter')
  const render = {
    home: renderHome, clients: renderClients, requests: renderRequests, quality: renderQuality, connection: renderConnection, chats: renderChats,
    orders: renderOrders, knowledge: renderKnowledge, config: isAdmin() ? renderConfig : renderClientConfig, simulator: renderSimulator,
  }[tab]
  render().catch(err => { view.innerHTML = `<div class="card error">${esc(err.message)}</div>` })
}

// ---------- novo cliente (admin) ----------

$('#new-tenant').insertAdjacentHTML('afterbegin', icon('plus', 16))
$('#new-tenant').addEventListener('click', () => {
  $('#new-tenant-error').textContent = ''
  $('#new-tenant-dialog').showModal()
})
$('#new-tenant-form').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'ok') return
  e.preventDefault()
  const form = new FormData(e.target)
  try {
    const t = await api('POST', '/api/tenants', Object.fromEntries(form))
    $('#new-tenant-dialog').close()
    e.target.reset()
    state.tenantId = t.id
    await loadTenants()
    openTab('config')
    toast('Cliente criado. Complete a configuração.')
  } catch (err) {
    $('#new-tenant-error').textContent = err.message
  }
})

// ---------- Conexão ----------

async function renderConnection () {
  view.innerHTML = `
    <div class="connect-grid">
      <div class="card stack">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">WhatsApp do negócio</h3>
          <span id="bot-status" class="status-pill">…</span>
        </div>
        <div id="bot-detail" class="muted"></div>
        <div id="bot-qr" class="qr-area"></div>
        <div class="row">
          <button id="bot-start" class="btn primary">${icon('phone', 18)} Conectar WhatsApp</button>
          <button id="bot-stop" class="btn danger">Desconectar</button>
        </div>
      </div>
      <div class="card stack steps">
        <h3 style="margin:0">Como conectar</h3>
        <ol>
          <li>Clique em <b>Conectar WhatsApp</b> e aguarde o QR Code.</li>
          <li>No celular do negócio, abra o WhatsApp → <b>Aparelhos conectados</b>.</li>
          <li>Toque em <b>Conectar um aparelho</b> e aponte a câmera para o código.</li>
          <li>Pronto! O status muda para <b>Conectado</b> e o bot começa a responder.</li>
        </ol>
        <p class="muted">A conexão fica salva: depois de reiniciar o servidor não é preciso ler o QR de novo.</p>
      </div>
    </div>`
  $('#bot-start').onclick = async () => {
    try { await api('POST', tenantUrl('/bot/start')); toast('Iniciando…'); refresh() } catch (err) { toast(err.message, 'error') }
  }
  $('#bot-stop').onclick = async () => { await api('POST', tenantUrl('/bot/stop')); toast('Desconectado.'); refresh() }

  async function refresh () {
    const info = await api('GET', tenantUrl('/bot'))
    const pill = $('#bot-status')
    if (!pill) return
    pill.className = `status-pill ${info.status}`
    pill.textContent = STATUS_LABEL[info.status] ?? info.status
    $('#bot-detail').textContent = info.user ? `Conectado como ${info.user}` : (info.error ? `Erro: ${info.error}` : '')
    $('#bot-qr').innerHTML = info.qrImage
      ? `<div class="qr-box"><img alt="QR Code do WhatsApp" src="${info.qrImage}"></div>`
      : info.status === 'online' ? `<div class="connected-art">${icon('check', 40)}<span>WhatsApp conectado</span></div>` : ''
    $('#bot-start').disabled = info.status !== 'stopped' && info.status !== 'error'
    $('#bot-stop').disabled = info.status === 'stopped'
  }
  await refresh()
  startPolling(refresh, 3000)
}


// ---------- Início (painel com números) ----------

function statTile ({ label, value, sub = '', iconName, tone = '', tab = '' }) {
  const tag = tab ? 'button' : 'div'
  return `<${tag} class="stat ${tone}" ${tab ? `data-goto="${tab}" type="button"` : ''}>
    <span class="stat-ico">${icon(iconName, 20)}</span>
    <span class="stat-label">${esc(label)}</span>
    <span class="stat-value">${value}</span>
    ${sub ? `<span class="stat-sub">${sub}</span>` : ''}
  </${tag}>`
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
const DAYMONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const parseDay = d => new Date(`${d}T12:00:00`)

/** Escala "bonita" para o eixo: 1, 2, 5, 10, 20, 50... */
function niceMax (v) {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  const n = [1, 2, 5, 10].map(m => m * p).find(x => x >= v) ?? v
  return n % 2 ? n + 1 : n // par: a linha do meio fica num número redondo
}

/**
 * Barras de uma série (sem legenda: o título nomeia a série).
 * Barras finas com topo arredondado, grade discreta, dica ao passar o mouse e tabela acessível.
 */
function barChart ({ id, title, days, key, unit }) {
  const values = days.map(d => d[key])
  const total = values.reduce((a, b) => a + b, 0)
  // O desenho é feito depois, na largura real do cartão (texto dos eixos em tamanho real)
  return `<figure class="card chart" id="${id}">
    <figcaption><span>${esc(title)}</span><span class="muted">${total} nos últimos 7 dias</span></figcaption>
    <div class="chart-box" data-chart="${esc(JSON.stringify({ title, days, key, unit }))}">
      <div class="chart-tip" role="status"></div>
    </div>
    <details class="chart-table"><summary>Ver em tabela</summary>
      <table><thead><tr><th>Dia</th><th>${esc(unit)}</th></tr></thead>
      <tbody>${days.map(d => `<tr><td>${DAYMONTH.format(parseDay(d.day))}</td><td>${d[key]}</td></tr>`).join('')}</tbody></table>
    </details>
  </figure>`
}

function drawBars (box) {
  const { title, days, key, unit } = JSON.parse(box.dataset.chart)
  const W = Math.max(260, Math.round(box.clientWidth))
  const H = 200
  const pad = { l: 34, r: 8, t: 14, b: 30 }
  const values = days.map(d => d[key])
  const max = niceMax(Math.max(...values, 1))
  const slot = (W - pad.l - pad.r) / days.length
  const bw = Math.min(26, slot * 0.46)
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const base = y(0)
  const grid = [0, max / 2, max].map(v => `
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${Math.round(v)}</text>`).join('')
  const bars = days.map((d, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2
    const top = y(d[key])
    const h = base - top
    const r = Math.min(4, h)
    const shape = h <= 0 ? '' : `<path class="bar" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`
    const label = `${WEEKDAY.format(parseDay(d.day)).replace('.', '')}, ${DAYMONTH.format(parseDay(d.day))}`
    return `${shape}
      <text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" class="axis">${WEEKDAY.format(parseDay(d.day)).replace('.', '')}</text>
      <rect class="hit" x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${base - pad.t}" data-tip="${esc(label)} · ${d[key]} ${unit}"/>`
  }).join('')
  box.querySelector('svg')?.remove()
  box.insertAdjacentHTML('afterbegin', `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${values.join(', ')} nos últimos 7 dias">
    ${grid}<line x1="${pad.l}" x2="${W - pad.r}" y1="${base}" y2="${base}" class="baseline"/>${bars}
  </svg>`)
}

let chartResize
window.addEventListener('resize', () => {
  clearTimeout(chartResize)
  chartResize = setTimeout(() => { for (const box of view.querySelectorAll('.chart-box[data-chart]')) drawBars(box) }, 150)
})

function wireCharts () {
  for (const box of view.querySelectorAll('.chart-box')) {
    drawBars(box)
    const tip = $('.chart-tip', box)
    box.addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit')
      for (const h of box.querySelectorAll('.hit.on')) if (h !== hit) h.classList.remove('on')
      if (!hit) { tip.classList.remove('show'); return }
      hit.classList.add('on')
      tip.textContent = hit.dataset.tip
      const r = box.getBoundingClientRect()
      tip.style.left = `${Math.min(r.width - 150, Math.max(0, e.clientX - r.left - 75))}px`
      tip.classList.add('show')
    })
    box.addEventListener('mouseleave', () => { tip.classList.remove('show'); for (const h of box.querySelectorAll('.hit.on')) h.classList.remove('on') })
  }
  for (const b of view.querySelectorAll('[data-goto]')) b.onclick = () => openTab(b.dataset.goto)
}

async function renderHome () {
  const [overview, s] = await Promise.all([
    isAdmin() ? api('GET', '/api/overview') : null,
    state.tenantId ? api('GET', tenantUrl('/stats')) : null,
  ])
  const tenantName = state.tenants.find(t => t.id === state.tenantId)?.name ?? ''
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' })()

  const adminHtml = overview ? `
    <section class="stack">
      <div class="section-head"><h2>Visão geral do SaaS</h2><button class="btn small ghost" data-goto="clients">Ver clientes ${icon('arrowRight', 16)}</button></div>
      <div class="stats">
        ${statTile({ label: 'Clientes', value: overview.clients, sub: `${overview.online} com WhatsApp conectado`, iconName: 'users', tab: 'clients' })}
        ${statTile({ label: 'Conversas hoje', value: overview.conversationsToday, sub: 'somando todos os clientes', iconName: 'chat' })}
        ${statTile({ label: 'Pedidos hoje', value: overview.ordersToday, sub: money(overview.revenueToday), iconName: 'orders' })}
        ${statTile({ label: 'Ajustes pendentes', value: overview.pendingRequests, sub: overview.suspended ? `${overview.suspended} cliente(s) suspenso(s)` : 'nenhum cliente suspenso', iconName: 'clipboard', tone: overview.pendingRequests ? 'warn' : '', tab: 'requests' })}
      </div>
    </section>` : ''

  const tenantHtml = s ? `
    <section class="stack">
      <div class="section-head"><h2>${isAdmin() ? `Cliente selecionado: ${esc(tenantName)}` : `${greeting}! 👋`}</h2>
        <span class="status-pill ${s.bot}">${STATUS_LABEL[s.bot] ?? s.bot}</span></div>
      <div class="stats">
        ${statTile({ label: 'Conversas hoje', value: s.conversationsToday, sub: `${s.messagesToday} mensagens recebidas`, iconName: 'chat', tab: 'chats' })}
        ${statTile({ label: 'Pedidos hoje', value: s.ordersToday, sub: money(s.revenueToday), iconName: 'orders', tab: 'orders' })}
        ${statTile({ label: 'Aguardando atendente', value: s.waitingAgent, sub: s.waitingAgent ? 'responda pela aba Conversas' : 'ninguém esperando', iconName: s.waitingAgent ? 'alert' : 'check', tone: s.waitingAgent ? 'warn' : 'good', tab: 'chats' })}
        ${statTile({ label: 'Perguntas sem resposta', value: s.unanswered, sub: s.unanswered ? 'complete a base de conhecimento' : 'o bot está respondendo tudo', iconName: 'book', tone: s.unanswered ? 'warn' : '', tab: 'knowledge' })}
      </div>
      <div class="charts">
        ${barChart({ id: 'chart-msgs', title: 'Mensagens recebidas', days: s.days, key: 'messages', unit: 'mensagens' })}
        ${barChart({ id: 'chart-orders', title: 'Pedidos', days: s.days, key: 'orders', unit: 'pedidos' })}
      </div>
    </section>` : ''

  view.innerHTML = `<div class="home">${adminHtml}${tenantHtml || (overview ? '' : emptyState('home', 'Nada por aqui ainda'))}</div>`
  wireCharts()
  startPolling(async () => { if (state.tab === 'home' && !view.querySelector('.chart-tip.show')) await renderHome() }, 30000)
}

// ---------- Conversas (estilo WhatsApp) ----------

const DEFAULT_QUICK_REPLIES = [
  'Olá! Aqui é da equipe, já vou te ajudar. 😊',
  'Seu pedido já está sendo preparado! 👨‍🍳',
  'Seu pedido saiu para entrega! 🛵',
  'Pode me passar mais detalhes, por favor?',
  'Obrigado pela preferência! Volte sempre. 💚',
]

function dayLabel (iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

function bubble (m, rate = false) {
  const who = m.from === 'bot' ? `<span class="who${m.kind === 'ai' ? ' ai' : ''}">${icon('bot', 13)} ${m.kind === 'ai' ? 'Bot · IA' : 'Bot'}</span>` : m.from === 'agent' ? '<span class="who agent">Atendente</span>' : ''
  const fb = rate && m.from === 'bot'
    ? `<button class="fb ${m.feedback === 'bad' ? 'on' : ''}" data-at="${esc(m.at)}" title="${m.feedback === 'bad' ? 'Marcada como errada (clique para desfazer)' : 'Resposta errada? Marque para treinar o bot'}" aria-label="Marcar resposta errada">${icon('thumbDown', 14)}</button>`
    : ''
  return `<div class="bubble ${m.from}${m.feedback === 'bad' ? ' bad' : ''}">${fb}${who}<div class="txt">${waFormat(m.text)}</div><span class="t">${hour(m.at)}${m.from !== 'customer' ? ' <span class="ticks">✓✓</span>' : ''}</span></div>`
}
const messageHtml = bubble

function messagesHtml (msgs, rate = false) {
  let last = ''
  return msgs.map(m => {
    const label = dayLabel(m.at)
    const sep = label !== last ? `<div class="day-sep"><span>${label}</span></div>` : ''
    last = label
    return sep + bubble(m, rate)
  }).join('')
}

function stateTag (c) {
  if (c.needsAgent) return '<span class="tag alert">Aguardando atendente</span>'
  if (c.state === 'human') return '<span class="tag human">Atendimento humano</span>'
  if (c.state.startsWith('checkout')) return '<span class="tag">Finalizando pedido</span>'
  return ''
}

const CHAT_FILTERS = { all: 'Todas', waiting: 'Aguardando', unread: 'Não lidas', human: 'Com atendente' }

async function renderChats () {
  state.chatFilter ??= 'all'
  state.chatSearch ??= ''
  state.config = await api('GET', tenantUrl('/config'))
  view.innerHTML = `
    <div class="chats ${state.chatId ? 'show-panel' : ''}">
      <div class="card chat-side">
        <div class="chat-tools">
          <label class="search">${icon('search', 18)}<input id="chat-search" placeholder="Buscar conversa" value="${esc(state.chatSearch)}" autocomplete="off"></label>
          <div class="row" style="gap:.4rem">
            <a class="btn small ghost" href="${tenantUrl('/conversations-export?format=txt&days=30')}">${icon('download', 16)} Exportar conversas</a>
          </div>
          <div class="chips" id="chat-filters">${Object.entries(CHAT_FILTERS).map(([k, l]) =>
            `<button class="chip ${state.chatFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="chat-list" id="chat-list"></div>
      </div>
      <div class="card chat-panel" id="chat-panel">${emptyState('chat', 'Selecione uma conversa', 'As mensagens dos clientes aparecem aqui.')}</div>
    </div>`

  let convs = []
  let shownCount = 0
  const matches = c => {
    const q = state.chatSearch.trim().toLowerCase()
    if (q && !`${c.name} ${c.chatId} ${c.lastMessage?.text ?? ''}`.toLowerCase().includes(q)) return false
    if (state.chatFilter === 'waiting') return c.needsAgent
    if (state.chatFilter === 'unread') return c.unread > 0
    if (state.chatFilter === 'human') return c.state === 'human'
    return true
  }

  function drawList () {
    const list = $('#chat-list')
    if (!list) return
    const items = convs.filter(matches)
    list.innerHTML = items.length ? items.map(c => `
      <button class="chat-item ${c.chatId === state.chatId ? 'active' : ''}" data-id="${esc(c.chatId)}">
        ${avatar(c.name || c.chatId, 44)}
        <span class="ci-body">
          <span class="ci-top"><span class="ci-name">${esc(c.name || c.chatId)}</span><span class="ci-time">${hour(c.updatedAt)}</span></span>
          <span class="ci-bottom"><span class="ci-preview">${c.lastMessage ? (c.lastMessage.from !== 'customer' ? '✓✓ ' : '') + esc(c.lastMessage.text.replace(/[*_~]/g, '')) : ''}</span>
            ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</span>
          <span class="ci-tags">${stateTag(c)}${c.channel === 'simulator' ? '<span class="tag">Simulador</span>' : ''}</span>
        </span>
      </button>`).join('') : `<div class="list-empty muted">${convs.length ? 'Nenhuma conversa neste filtro.' : 'Nenhuma conversa ainda.'}</div>`
  }

  async function refreshList () {
    convs = await api('GET', tenantUrl('/conversations'))
    drawList()
  }

  const quickReplies = () => state.config?.quickReplies?.length ? state.config.quickReplies : DEFAULT_QUICK_REPLIES

  async function refreshChat (scroll) {
    if (!state.chatId) return
    const c = await api('GET', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}`))
    const panel = $('#chat-panel')
    if (!panel) return
    const box = $('#messages', panel)
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 60
    const draft = $('#reply', panel)?.value ?? ''
    const human = c.state === 'human'
    const isNew = c.messages.length > shownCount && shownCount > 0
    panel.innerHTML = `
      <div class="chat-head">
        <button class="btn icon-btn back-btn" id="chat-back" aria-label="Voltar para a lista">←</button>
        ${avatar(c.name || c.chatId, 40)}
        <div class="ch-info"><strong>${esc(c.name || c.chatId)}</strong>
          <span class="muted">${human ? 'Atendimento humano — o bot está pausado' : 'Bot respondendo'}${c.cart.length ? ` · 🛒 ${c.cart.map(i => `${i.qty}x ${esc(i.name)}`).join(', ')}` : ''}</span></div>
        <button class="btn icon-btn ghost" id="save-test" title="Salvar como teste (garante que esta conversa continue funcionando)" aria-label="Salvar como teste">${icon('save', 18)}</button>
        ${human
          ? '<button class="btn small" id="release">Devolver ao bot</button>'
          : '<button class="btn small primary" id="takeover">Assumir conversa</button>'}
      </div>
      <div class="messages wa-bg" id="messages">${messagesHtml(c.messages, true)}</div>
      <div class="quick">
        ${quickReplies().map((q, i) => `<button class="chip" data-quick="${i}" title="${esc(q)}">${esc(q.length > 34 ? q.slice(0, 32) + '…' : q)}</button>`).join('')}
        <button class="chip ghost" id="edit-quick">${icon('edit', 14)} Editar</button>
      </div>
      <form class="composer" id="composer">
        <input id="reply" placeholder="Responder como atendente… (o bot pausa nesta conversa)" autocomplete="off">
        <button class="btn primary send-btn" aria-label="Enviar">${icon('send', 18)}</button>
      </form>`
    shownCount = c.messages.length
    const input = $('#reply', panel)
    input.value = draft
    const msgs = $('#messages', panel)
    if (isNew) msgs.lastElementChild?.classList.add('pop')
    if (scroll || atBottom) msgs.scrollTop = msgs.scrollHeight
    $('#chat-back', panel).onclick = () => { state.chatId = null; $('.chats').classList.remove('show-panel'); drawList() }
    for (const b of panel.querySelectorAll('[data-quick]')) {
      b.onclick = () => { input.value = quickReplies()[Number(b.dataset.quick)]; input.focus() }
    }
    $('#edit-quick', panel).onclick = editQuickReplies
    for (const b of panel.querySelectorAll('.fb')) {
      b.onclick = async () => {
        const r = await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/feedback`), { at: b.dataset.at })
        toast(r.feedback ? 'Marcada como errada. A pergunta foi para “Treinar o bot” (aba Conhecimento).' : 'Marcação desfeita.')
        refreshChat()
      }
    }
    $('#save-test', panel).onclick = async () => {
      const title = prompt('Nome do teste (ex.: Pedido com meio a meio):', `Conversa com ${c.name || 'cliente'}`)
      if (title === null) return
      try {
        await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/save-test`), { title })
        toast('Conversa salva como teste. Rode os testes na aba Qualidade.')
      } catch (err) { toast(err.message, 'error') }
    }
    $('#composer', panel).onsubmit = async e => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      try {
        await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/reply`), { text })
        input.value = ''
        await refreshChat(true)
      } catch (err) { toast(err.message, 'error') }
    }
    $('#takeover', panel)?.addEventListener('click', async () => {
      await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/takeover`))
      toast('Você assumiu a conversa. O bot está pausado.')
      refreshChat()
    })
    $('#release', panel)?.addEventListener('click', async () => {
      try {
        await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/release`))
        toast('Conversa devolvida ao bot.')
        refreshChat(true)
      } catch (err) { toast(err.message, 'error') }
    })
    if (document.activeElement !== input && draft) input.focus()
  }

  function editQuickReplies () {
    const dlg = $('#quick-dialog')
    $('#quick-text').value = quickReplies().join('\n')
    dlg.showModal()
    $('#quick-form').onsubmit = async e => {
      if (e.submitter?.value !== 'ok') return
      e.preventDefault()
      const list = $('#quick-text').value.split('\n').map(s => s.trim()).filter(Boolean)
      try {
        const res = await api('PUT', tenantUrl('/quick-replies'), { quickReplies: list })
        state.config.quickReplies = res.quickReplies
        dlg.close()
        toast('Respostas rápidas salvas ✔')
        refreshChat()
      } catch (err) { toast(err.message, 'error') }
    }
  }

  $('#chat-list').addEventListener('click', e => {
    const item = e.target.closest('.chat-item')
    if (!item) return
    state.chatId = item.dataset.id
    shownCount = 0
    $('.chats').classList.add('show-panel')
    for (const el of document.querySelectorAll('.chat-item')) el.classList.toggle('active', el === item)
    refreshChat(true)
  })
  $('#chat-search').addEventListener('input', e => { state.chatSearch = e.target.value; drawList() })
  $('#chat-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]')
    if (!b) return
    state.chatFilter = b.dataset.filter
    for (const x of document.querySelectorAll('#chat-filters .chip')) x.classList.toggle('on', x === b)
    drawList()
  })

  await refreshList()
  await refreshChat(true)
  startPolling(async () => {
    await refreshList()
    // não redesenha enquanto o atendente digita
    if (document.activeElement?.id !== 'reply') await refreshChat()
  })
}

// ---------- Pedidos (quadro) ----------

const BOARD = ['novo', 'confirmado', 'preparando', 'enviado', 'concluido', 'cancelado']

function printOrder (o) {
  const brand = state.tenants.find(t => t.id === state.tenantId)?.name ?? state.brand.name
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) { toast('Permita pop-ups para imprimir.', 'error'); return }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${o.number}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm }
      body { font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #000; width: 72mm; margin: 0 auto }
      h1 { font-size: 16px; text-align: center; margin: 0 0 2px } .c { text-align: center } hr { border: 0; border-top: 1px dashed #000; margin: 8px 0 }
      table { width: 100%; border-collapse: collapse } td { padding: 2px 0; vertical-align: top } td:last-child { text-align: right; white-space: nowrap }
      .tot { font-size: 15px; font-weight: 700 }
    </style></head><body>
    <h1>${esc(brand)}</h1><div class="c">PEDIDO #${o.number}</div><div class="c">${time(o.createdAt)}</div><hr>
    <div><b>Cliente:</b> ${esc(o.customerName)}</div><div><b>Entrega:</b> ${esc(o.address)}</div><hr>
    <table>${o.items.map(i => `<tr><td>${i.qty}x ${esc(i.name)}</td><td>${money(i.qty * i.price)}</td></tr>`).join('')}</table><hr>
    <table><tr class="tot"><td>TOTAL</td><td>${money(o.total)}</td></tr></table><hr>
    <div class="c">Status: ${esc(ORDER_LABEL[o.status] ?? o.status)}</div>
    <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300) }<\/script>
    </body></html>`)
  w.document.close()
}

async function renderOrders () {
  let orders = []
  let dragging = null

  async function setStatus (id, status) {
    try {
      await api('PATCH', tenantUrl(`/orders/${encodeURIComponent(id)}`), { status })
      const o = orders.find(x => x.id === id)
      if (o) o.status = status
      draw()
      toast(`Pedido movido para “${ORDER_LABEL[status]}”.`)
      updateBadges().catch(() => {})
    } catch (err) { toast(err.message, 'error') }
  }

  function card (o) {
    return `<article class="order-card" draggable="true" data-id="${esc(o.id)}">
      <div class="oc-top"><strong>#${o.number}</strong><span class="muted">${hour(o.createdAt)}</span></div>
      <div class="oc-name">${esc(o.customerName)}${o.channel === 'simulator' ? ' <span class="tag">Simulador</span>' : ''}</div>
      <ul class="oc-items">${o.items.map(i => `<li>${i.qty}x ${esc(i.name)}</li>`).join('')}</ul>
      <div class="oc-addr muted">${esc(o.address)}</div>
      <div class="oc-bottom">
        <span class="oc-total">${money(o.total)}</span>
        <span class="row" style="gap:.3rem">
          <select class="oc-status" aria-label="Mudar status">${ORDER_STATUS.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${ORDER_LABEL[s]}</option>`).join('')}</select>
          <button class="btn icon-btn" data-print="${esc(o.id)}" title="Imprimir pedido" aria-label="Imprimir pedido">${icon('printer', 16)}</button>
        </span>
      </div>
    </article>`
  }

  function draw () {
    if (!orders.length) { view.innerHTML = emptyState('orders', 'Nenhum pedido ainda', 'Os pedidos feitos pelo WhatsApp aparecem aqui. Faça um teste pelo <b>Simulador</b>!'); return }
    const scroll = view.querySelector('.board')?.scrollLeft ?? 0
    view.innerHTML = `
      <p class="muted board-hint">Arraste os cartões entre as colunas (ou use a lista em cada cartão) para mudar o status.</p>
      <div class="board">${BOARD.map(s => {
        const list = orders.filter(o => o.status === s)
        const shown = s === 'concluido' || s === 'cancelado' ? list.slice(0, 15) : list
        return `<section class="col col-${s}" data-status="${s}">
          <header><span>${ORDER_LABEL[s]}</span><span class="count">${list.length}</span></header>
          <div class="col-body">${shown.map(card).join('') || '<div class="col-empty">—</div>'}</div>
        </section>`
      }).join('')}</div>`
    view.querySelector('.board').scrollLeft = scroll
  }

  const sig = { signal: state.viewAbort.signal } // solta os eventos ao trocar de aba
  view.addEventListener('dragstart', onDragStart, sig)
  function onDragStart (e) {
    const c = e.target.closest?.('.order-card')
    if (!c || state.tab !== 'orders') return
    dragging = c.dataset.id
    c.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  }
  view.addEventListener('dragend', () => { dragging = null; view.querySelectorAll('.dragging, .drop').forEach(el => el.classList.remove('dragging', 'drop')) }, sig)
  view.addEventListener('dragover', e => {
    const col = e.target.closest?.('.col')
    if (!col || !dragging) return
    e.preventDefault()
    view.querySelectorAll('.col.drop').forEach(el => el !== col && el.classList.remove('drop'))
    col.classList.add('drop')
  }, sig)
  view.addEventListener('drop', e => {
    const col = e.target.closest?.('.col')
    if (!col || !dragging) return
    e.preventDefault()
    const o = orders.find(x => x.id === dragging)
    if (o && o.status !== col.dataset.status) setStatus(o.id, col.dataset.status)
  }, sig)
  view.addEventListener('change', e => {
    if (!e.target.matches('.oc-status')) return
    setStatus(e.target.closest('.order-card').dataset.id, e.target.value)
  }, sig)
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-print]')
    if (b) printOrder(orders.find(o => o.id === b.dataset.print))
  }, sig)

  async function refresh () {
    if (dragging || document.activeElement?.matches('.oc-status')) return
    const next = await api('GET', tenantUrl('/orders'))
    if (state.tab !== 'orders') return
    orders = next
    draw()
  }
  await refresh()
  startPolling(refresh, 6000)
}


// ---------- Configuração ----------

function menuRow (o = { key: '', label: '', type: 'text', text: '' }) {
  return `
    <div class="edit-row menu-row">
      <input name="key" value="${esc(o.key)}" placeholder="Nº" aria-label="Número">
      <input name="label" value="${esc(o.label)}" placeholder="Texto da opção" aria-label="Texto da opção">
      <select name="type" aria-label="Tipo">${Object.entries(MENU_TYPES).map(([v, l]) =>
        `<option value="${v}" ${v === o.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn small danger remove" aria-label="Remover">✕</button>
      <textarea name="text" placeholder="Resposta (para “Resposta fixa”). Use {empresa} e {nome}." class="${o.type === 'text' ? '' : 'hidden'}">${esc(o.text ?? '')}</textarea>
    </div>`
}

const optionsText = list => (list ?? []).map(o => `${o.name}=${String(o.price).replace('.', ',')}`).join('; ')

function productRow (p = { id: '', name: '', price: '', description: '', active: true }) {
  return `
    <div class="edit-row product product-row" data-id="${esc(p.id)}">
      <input name="name" value="${esc(p.name)}" placeholder="Produto" aria-label="Produto">
      <input name="price" type="number" min="0" step="0.01" value="${esc(p.price)}" placeholder="Preço" aria-label="Preço">
      <input name="description" value="${esc(p.description ?? '')}" placeholder="Descrição (opcional)" aria-label="Descrição">
      <label class="check"><input name="active" type="checkbox" ${p.active ? 'checked' : ''}> Ativo</label>
      <button type="button" class="btn small danger remove" aria-label="Remover">✕</button>
      <input name="sizes" class="opt-sizes" value="${esc(optionsText(p.sizes))}" placeholder="Tamanhos (opcional): Média=49,90; Grande=59,90" aria-label="Tamanhos e preços">
      <input name="extras" class="opt-extras" value="${esc(optionsText(p.extras))}" placeholder="Adicionais (opcional): Borda de catupiry=9; Bacon=6" aria-label="Adicionais e preços">
    </div>`
}

const productFromRow = r => ({
  id: r.dataset.id, name: $('[name=name]', r).value, price: $('[name=price]', r).value,
  description: $('[name=description]', r).value, active: $('[name=active]', r).checked,
  sizes: $('[name=sizes]', r).value, extras: $('[name=extras]', r).value,
})

/** Meio a meio e sinônimos (ficam junto do cardápio). */
function catalogRulesHtml (c) {
  const syn = Object.entries(c.synonyms ?? {}).map(([a, b]) => `${a}=${b}`).join('\n')
  return `<div class="grid2">
    <label>Pizza meio a meio
      <select name="halfHalf">
        <option value="" ${!c.halfHalf ? 'selected' : ''}>Não montar (só responder dúvidas)</option>
        <option value="max" ${c.halfHalf === 'max' ? 'selected' : ''}>Cobrar pelo sabor mais caro</option>
        <option value="avg" ${c.halfHalf === 'avg' ? 'selected' : ''}>Cobrar a média dos dois sabores</option>
        <option value="off" ${c.halfHalf === 'off' ? 'selected' : ''}>Não fazemos meio a meio</option>
      </select>
      <span class="muted" style="font-weight:400">O bot entende “meio calabresa meio 4 queijos” e calcula o preço.</span>
    </label>
    <label>Sinônimos (um por linha: como o cliente fala = nome no cardápio)
      <textarea name="synonyms" rows="4" placeholder="coca=refrigerante&#10;4 queijos=quatro queijos&#10;marguerita=margherita">${esc(syn)}</textarea>
    </label>
  </div>`
}

async function renderConfig () {
  const c = state.config = await api('GET', tenantUrl('/config'))
  const isAdmin = state.me.role === 'admin'
  view.innerHTML = `
    <form id="config-form" class="config">
      <section class="card stack">
        <h3>Negócio</h3>
        <div class="grid2">
          <label>Nome<input name="name" value="${esc(c.name)}"></label>
          <label>Telefone<input name="business.phone" value="${esc(c.business.phone)}"></label>
          <label>Horário de funcionamento<input name="business.hours" value="${esc(c.business.hours)}"></label>
          <label>Endereço<input name="business.address" value="${esc(c.business.address)}"></label>
        </div>
        <label>Descrição do negócio<textarea name="business.description" placeholder="O que vocês fazem, diferenciais, formas de pagamento…">${esc(c.business.description)}</textarea></label>
        <label>Perguntas frequentes e informações extras (a IA usa este texto)
          <textarea name="business.extraInfo" rows="6" placeholder="Ex.: Entregamos em até 40 min no centro. Taxa de entrega R$ 5. Aceitamos Pix e cartão.">${esc(c.business.extraInfo)}</textarea></label>
      </section>

      <section class="card stack">
        <h3>Menu de atendimento</h3>
        <p class="muted">O cliente digita o número da opção. Comandos sempre disponíveis: <b>menu</b>, <b>atendente</b>, <b>cancelar</b>.</p>
        <div id="menu-rows">${c.menu.map(menuRow).join('')}</div>
        <div><button type="button" class="btn small" id="add-menu">+ Adicionar opção</button></div>
      </section>

      <section class="card stack">
        <h3>Catálogo</h3>
        <p class="muted">Tamanhos e adicionais são opcionais. Com tamanhos, o bot pergunta qual o cliente quer. Para a promoção virar item que dá para pedir, cadastre um produto com “Promoção” ou “Combo” no nome.</p>
        <div id="product-rows">${c.products.map(productRow).join('')}</div>
        <div><button type="button" class="btn small" id="add-product">+ Adicionar produto</button></div>
        ${catalogRulesHtml(c)}
      </section>

      <section class="card stack">
        <h3>Inteligência artificial</h3>
        <label class="check"><input type="checkbox" name="ai.enabled" ${c.ai.enabled ? 'checked' : ''}> Responder perguntas livres com IA (Claude)</label>
        <label>Instruções extras para a IA<textarea name="ai.instructions" placeholder="Ex.: Trate o cliente por você. Nunca ofereça desconto.">${esc(c.ai.instructions)}</textarea></label>
      </section>

      <section class="card stack">
        <h3>Mensagens</h3>
        <p class="muted">Use <b>{empresa}</b> e <b>{nome}</b>. Na confirmação, <b>{pedido}</b> vira o número do pedido.</p>
        <div class="grid2">
          <label>Boas-vindas<textarea name="messages.welcome">${esc(c.messages.welcome)}</textarea></label>
          <label>Não entendi<textarea name="messages.fallback">${esc(c.messages.fallback)}</textarea></label>
          <label>Chamando atendente<textarea name="messages.humanHandoff">${esc(c.messages.humanHandoff)}</textarea></label>
          <label>Bot de volta<textarea name="messages.humanBack">${esc(c.messages.humanBack)}</textarea></label>
          <label>Pedido confirmado<textarea name="messages.orderConfirmed">${esc(c.messages.orderConfirmed)}</textarea></label>
          <label>Mensagem não-texto (áudio, foto…)<textarea name="messages.nonText">${esc(c.messages.nonText)}</textarea></label>
        </div>
        <label style="max-width:320px">Bot volta sozinho após (minutos sem atendente)
          <input name="humanTimeoutMin" type="number" min="1" max="1440" value="${c.humanTimeoutMin}"></label>
      </section>

      <section class="card stack">
        <h3>Acesso ao painel</h3>
        ${isAdmin ? `<label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Cliente ativo</label>` : ''}
        <p class="muted">ID de login: <b>${esc(c.id)}</b> · ${c.hasPassword ? 'Senha definida' : 'Sem senha — o cliente ainda não consegue entrar'}</p>
        <label style="max-width:320px">Nova senha do painel<input name="newPassword" type="password" minlength="8" autocomplete="new-password" placeholder="deixe em branco para manter"></label>
      </section>

      <div class="save-bar"><button class="btn primary">Salvar configuração</button></div>
    </form>`

  const form = $('#config-form')
  $('#add-menu').onclick = () => $('#menu-rows').insertAdjacentHTML('beforeend', menuRow({ key: String($('#menu-rows').children.length + 1), label: '', type: 'text', text: '' }))
  $('#add-product').onclick = () => $('#product-rows').insertAdjacentHTML('beforeend', productRow())
  form.addEventListener('click', e => { if (e.target.matches('.remove')) e.target.closest('.edit-row').remove() })
  form.addEventListener('change', e => {
    if (e.target.matches('.menu-row select[name=type]')) {
      e.target.closest('.menu-row').querySelector('textarea').classList.toggle('hidden', e.target.value !== 'text')
    }
  })

  form.onsubmit = async e => {
    e.preventDefault()
    const v = name => form.elements[name]
    const body = {
      name: v('name').value,
      active: isAdmin ? v('active').checked : c.active,
      business: {
        phone: v('business.phone').value,
        hours: v('business.hours').value,
        address: v('business.address').value,
        description: v('business.description').value,
        extraInfo: v('business.extraInfo').value,
      },
      menu: [...form.querySelectorAll('.menu-row')].map(r => ({
        key: $('[name=key]', r).value, label: $('[name=label]', r).value,
        type: $('[name=type]', r).value, text: $('[name=text]', r).value,
      })),
      products: [...form.querySelectorAll('.product-row')].map(productFromRow),
      halfHalf: v('halfHalf').value,
      synonyms: v('synonyms').value,
      ai: { enabled: v('ai.enabled').checked, instructions: v('ai.instructions').value },
      messages: Object.fromEntries(['welcome', 'fallback', 'humanHandoff', 'humanBack', 'orderConfirmed', 'nonText']
        .map(k => [k, v(`messages.${k}`).value])),
      humanTimeoutMin: v('humanTimeoutMin').value,
      newPassword: v('newPassword').value,
    }
    try {
      await api('PUT', tenantUrl('/config'), body)
      toast('Configuração salva ✔')
      await loadTenants()
      renderConfig()
    } catch (err) { toast(err.message) }
  }
}


// ---------- Qualidade do atendimento ----------

async function renderQuality () {
  const [q, tests] = await Promise.all([api('GET', tenantUrl('/quality')), api('GET', tenantUrl('/tests'))])
  const tone = q.understoodPct >= 85 ? 'good' : q.answered ? 'warn' : ''
  view.innerHTML = `
    <div class="home">
      <section class="stack">
        <div class="section-head"><h2>Últimos 7 dias</h2>
          <span class="row" style="gap:.4rem">
            <a class="btn small" href="${tenantUrl('/conversations-export?format=txt&days=30')}">${icon('download', 16)} Exportar conversas (.txt)</a>
            <a class="btn small ghost" href="${tenantUrl('/conversations-export?format=json&days=30')}">.json</a>
          </span></div>
        <div class="stats">
          ${statTile({ label: 'Entendimento', value: q.answered ? `${q.understoodPct}%` : '—', sub: `${q.answered} respostas do bot`, iconName: q.understoodPct >= 85 ? 'check' : 'chart', tone })}
          ${statTile({ label: 'Não entendidas', value: q.notUnderstood, sub: 'o bot pediu para explicar de outro jeito', iconName: 'alert', tone: q.notUnderstood ? 'warn' : '' })}
          ${statTile({ label: 'Atendente chamado', value: q.handoffs, sub: `${q.clarified} vez(es) o bot perguntou “você quis dizer…?”`, iconName: 'users' })}
          ${statTile({ label: 'Marcadas como erradas', value: q.markedWrong, sub: 'pelo 👎 nas Conversas', iconName: 'thumbDown', tab: 'knowledge', tone: q.markedWrong ? 'warn' : '' })}
        </div>
        <div class="charts">
          ${barChart({ id: 'chart-quality', title: 'Mensagens entendidas por dia (%)', days: q.days, key: 'pct', unit: '%' })}
          <div class="card stack">
            <h3>O que mais falhou</h3>
            ${q.unanswered.length
              ? `<ol class="fail-list">${q.unanswered.map(u => `<li><span>“${esc(u.text)}”</span><span class="muted">${u.count}x</span></li>`).join('')}</ol>
                 <button class="btn small" data-goto="knowledge">Treinar o bot ${icon('arrowRight', 16)}</button>`
              : '<p class="muted">Nada falhando por enquanto. 🎉</p>'}
          </div>
        </div>
      </section>

      <section class="card stack">
        <div class="section-head"><h3>Bateria de testes</h3><button class="btn primary small" id="qa-run">${icon('flask', 16)} Rodar bateria</button></div>
        <p class="muted">Testa frases típicas do ramo e os fluxos básicos (saudação, cardápio, pedido, atendente) com a configuração deste cliente, sem afetar as conversas reais. Use antes de entregar o bot e depois de cada ajuste.</p>
        <div id="qa-result"></div>
      </section>

      <section class="card stack">
        <div class="section-head"><h3>Conversas salvas como teste <span class="muted">(${tests.length})</span></h3>
          ${tests.length ? `<button class="btn small" id="tests-run">${icon('check', 16)} Rodar todos</button>` : ''}</div>
        <p class="muted">Na aba Conversas, use o botão ${icon('save', 14)} para guardar uma conversa. Aqui você confere se ela continua sendo respondida do mesmo jeito depois de cada mudança.</p>
        <div id="tests-list">${tests.length ? tests.map(t => `
          <div class="test-item" data-id="${esc(t.id)}">
            <div><strong>${esc(t.title)}</strong> <span class="muted">· ${t.messages.length} mensagem(ns) · ${time(t.createdAt)}</span></div>
            <div class="test-result"></div>
            <div class="row"><button class="btn small ghost test-del">Excluir</button></div>
          </div>`).join('') : '<p class="muted">Nenhuma conversa salva ainda.</p>'}</div>
      </section>
    </div>`
  wireCharts()

  $('#qa-run').onclick = async () => {
    const box = $('#qa-result')
    box.innerHTML = '<div class="sk sk-line"></div><div class="sk sk-line short"></div>'
    try {
      const r = await api('POST', tenantUrl('/qa'))
      box.innerHTML = `
        <div class="qa-score ${r.score >= 90 ? 'good' : 'warn'}"><strong>${r.score}%</strong> das frases do ramo respondidas certo (${r.ok} de ${r.total})</div>
        <h4>Fluxos básicos</h4>
        <ul class="qa-flows">${r.flows.map(f => `<li class="${f.ok ? 'ok' : 'bad'}">${f.ok ? '✅' : '❌'} ${esc(f.name)}${f.ok ? '' : ` — <span class="muted">${esc(f.detail)}</span>`}</li>`).join('')}</ul>
        ${r.missingTopics.length ? `<h4>Assuntos sem informação preenchida (${r.missingTopics.length})</h4>
          <p class="muted">O bot reconhece estas perguntas, mas não responde porque falta a informação do negócio (aba Conhecimento).</p>
          <ul class="qa-missing">${r.missingTopics.map(m => `<li><b>${esc(m.title)}</b> <span class="muted">— falta: ${esc(m.missing.join(', ') || 'resposta desativada')}</span></li>`).join('')}</ul>` : '<p>✅ Todas as informações dos assuntos estão preenchidas.</p>'}
        ${r.results.length ? `<h4>Frases com problema (${r.results.length})</h4>
          <div class="table-wrap"><table><thead><tr><th>Frase</th><th>Resultado</th></tr></thead><tbody>
          ${r.results.map(x => `<tr><td>“${esc(x.text)}”</td><td class="muted">${x.status === 'sem-info'
            ? `Falta preencher: ${esc((x.missing ?? []).join(', '))}`
            : x.got ? `Respondeu “${esc(x.title)}” (esperado outro assunto)` : 'Não respondeu'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}`
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>` }
  }

  $('#tests-run')?.addEventListener('click', async () => {
    const results = await api('POST', tenantUrl('/tests/run'))
    for (const r of results) {
      const item = view.querySelector(`.test-item[data-id="${r.id}"]`)
      if (!item) continue
      $('.test-result', item).innerHTML = r.ok
        ? '<span class="tag ok">✅ Passou</span>'
        : `<span class="tag alert">❌ Mudou em ${r.diffs.length} resposta(s)</span>
           ${r.diffs.map(d => `<div class="diff"><div><b>Cliente:</b> ${esc(d.said)}</div>
             <div class="diff-old"><b>Antes:</b> ${waFormat(d.expected)}</div><div class="diff-new"><b>Agora:</b> ${waFormat(d.got)}</div></div>`).join('')}
           <button class="btn small test-accept">A resposta nova está certa</button>`
      $('.test-accept', item)?.addEventListener('click', async () => {
        await api('POST', tenantUrl(`/tests/${r.id}/accept`))
        toast('Resposta esperada atualizada ✔')
        $('.test-result', item).innerHTML = '<span class="tag ok">✅ Atualizado</span>'
      })
    }
    toast(`${results.filter(r => r.ok).length} de ${results.length} teste(s) passaram.`)
  })
  for (const b of view.querySelectorAll('.test-del')) {
    b.onclick = async () => {
      const id = b.closest('.test-item').dataset.id
      if (!confirm('Excluir este teste?')) return
      await api('DELETE', tenantUrl(`/tests/${id}`))
      renderQuality()
    }
  }
}

// ---------- Simulador (celular desenhado) ----------

async function renderSimulator () {
  const business = state.tenants.find(t => t.id === state.tenantId)?.name ?? state.brand.name
  view.innerHTML = `
    <div class="sim-layout">
      <div class="phone" role="region" aria-label="Simulador de WhatsApp">
        <div class="phone-notch"></div>
        <div class="phone-screen">
          <div class="wa-head">
            <span class="wa-back">←</span>
            <span class="wa-avatar">${logoMark(36)}</span>
            <span class="wa-title"><strong>${esc(business)}</strong><span id="sim-status">online</span></span>
          </div>
          <div class="messages wa-bg" id="sim-messages"><div class="day-sep"><span>Hoje</span></div>
            <div class="sim-hint">Envie “oi” para começar 👋</div></div>
          <form class="wa-composer" id="sim-form">
            <input id="sim-input" placeholder="Mensagem" autocomplete="off">
            <button class="wa-send" aria-label="Enviar">${icon('send', 20)}</button>
          </form>
        </div>
      </div>
      <div class="card stack sim-side">
        <h3>Teste como se fosse o cliente</h3>
        <label>Nome do cliente de teste<input id="sim-name" value="Maria"></label>
        <label class="check"><input type="checkbox" id="sim-typing" checked> Ritmo real (lido, “digitando…” e pausa como no WhatsApp)</label>
        <button class="btn" id="sim-reset">Nova conversa</button>
        <p class="muted">O simulador usa exatamente o mesmo bot do WhatsApp, com a configuração salva deste cliente.
          Pedidos de teste aparecem em <b>Pedidos</b> e a conversa em <b>Conversas</b> (marcados como “Simulador”).</p>
        <div class="try">
          <span class="muted">Experimente:</span>
          ${['oi', 'que horas vocês abrem?', 'quanto custa a calabresa?', 'quero 2 calabresa e 1 refri', 'aceita pix?']
            .map(t => `<button class="chip" data-try="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
      </div>
    </div>`
  const box = $('#sim-messages')
  const status = $('#sim-status')
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const showTyping = () => {
    status.textContent = 'digitando…'
    box.insertAdjacentHTML('beforeend', '<div class="bubble bot typing" aria-label="digitando"><span></span><span></span><span></span></div>')
    box.scrollTop = box.scrollHeight
    return box.lastElementChild
  }
  const add = (from, text, kind) => {
    $('.sim-hint', box)?.remove()
    box.insertAdjacentHTML('beforeend', bubble({ from, text, kind, at: new Date().toISOString() }))
    box.lastElementChild.classList.add('pop')
    box.scrollTop = box.scrollHeight
  }
  const send = async text => {
    add('customer', text)
    try {
      const res = await api('POST', tenantUrl('/simulate'), { chatId: state.simChatId, text, name: $('#sim-name').value.trim() || 'Cliente' })
      state.simChatId = res.chatId
      if (!res.replies.length) add('bot', '(bot em silêncio — conversa com atendente humano)')
      // Mesmo ritmo do WhatsApp: pausa de leitura e "digitando…" proporcional ao tamanho da resposta
      const realistic = $('#sim-typing')?.checked
      if (realistic && res.replies.length) await wait(600 + Math.random() * 900)
      for (const r of res.replies) {
        if (realistic) {
          const typing = showTyping()
          await wait(Math.min(7000, Math.max(1200, 900 + r.length * 28)) * (0.85 + Math.random() * 0.3))
          typing.remove()
        }
        add('bot', r, r === res.replies[0] ? res.kind : undefined)
      }
    } catch (err) { toast(err.message, 'error') }
    status.textContent = 'online'
  }
  $('#sim-reset').onclick = () => {
    state.simChatId = null
    box.innerHTML = '<div class="day-sep"><span>Hoje</span></div><div class="sim-hint">Envie “oi” para começar 👋</div>'
  }
  $('#sim-form').onsubmit = e => {
    e.preventDefault()
    const input = $('#sim-input')
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    send(text)
    input.focus()
  }
  for (const b of view.querySelectorAll('[data-try]')) b.onclick = () => send(b.dataset.try)
  $('#sim-input').focus()
}


// ---------- Base de conhecimento ----------

const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1])

async function renderKnowledge () {
  const [{ packs }, cfg, unanswered] = await Promise.all([
    api('GET', '/api/knowledge/packs'), api('GET', tenantUrl('/config')), api('GET', tenantUrl('/knowledge/unanswered')),
  ])
  const k = cfg.knowledge ?? { packs: ['comum'], variables: {}, overrides: {} }
  const active = new Set(k.packs)
  const details = await Promise.all(packs.filter(p => active.has(p.id)).map(p => api('GET', `/api/knowledge/packs/${p.id}`)))
  const isAdmin = state.me.role === 'admin'
  const canInfo = can('info')
  const builtin = { empresa: cfg.name, horario: cfg.business.hours, endereco: cfg.business.address, telefone: cfg.business.phone }
  const topicTitles = Object.fromEntries(details.flatMap(p => p.topics.map(t => [`${p.id}/${t.key}`, `${p.name} › ${t.title}`])))
  const topicVars = Object.fromEntries(details.flatMap(p => p.topics.map(t => [`${p.id}/${t.key}`, placeholders(t.answer)])))
  const labels = Object.fromEntries(packs.flatMap(p => p.variables.map(v => [v.key, v.label])))
  const topicOptions = selected => details.map(p => `<optgroup label="${esc(p.name)}">${p.topics.map(t =>
    `<option value="${esc(p.id)}/${esc(t.key)}" ${`${p.id}/${t.key}` === selected ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</optgroup>`).join('')

  const varsHtml = details.map(p => {
    const list = packs.find(x => x.id === p.id).variables
    if (!list.length) return ''
    const filled = list.filter(v => k.variables[v.key]?.trim()).length
    return `
      <details class="kb-group" ${filled < list.length ? 'open' : ''}>
        <summary><strong>${esc(p.name)}</strong> <span class="tag ${filled < list.length ? 'human' : ''}">${filled}/${list.length} preenchidas</span></summary>
        <div class="grid2" style="margin-top:.8rem">
          ${list.map(v => `<label>${esc(v.label)}
            <textarea name="var" data-key="${esc(v.key)}" rows="2" placeholder="Ex.: ${esc(v.example ?? '')}">${esc(k.variables[v.key] ?? '')}</textarea></label>`).join('')}
        </div>
      </details>`
  }).join('')

  const topicsHtml = details.map(p => {
    const byCategory = {}
    for (const t of p.topics) (byCategory[t.category || 'Geral'] ??= []).push(t)
    return `
      <details class="kb-group">
        <summary><strong>${esc(p.name)}</strong> <span class="muted">· ${p.topics.length} assuntos · ${p.topics.reduce((s, t) => s + t.questions.length, 0)} variações de pergunta</span></summary>
        ${Object.entries(byCategory).map(([cat, topics]) => `
          <h4 class="kb-cat">${esc(cat)}</h4>
          ${topics.map(t => {
            const id = `${p.id}/${t.key}`
            const ov = k.overrides[id] ?? {}
            const template = ov.answer?.trim() ? ov.answer : t.answer
            const missing = placeholders(template).filter(x => !(builtin[x] ?? k.variables[x])?.trim())
            const status = ov.enabled === false ? '<span class="tag">Desativado</span>'
              : missing.length ? `<span class="tag human">Falta: ${missing.map(m => esc(labels[m] ?? m)).join(', ')}</span>`
              : '<span class="tag ok">Respondendo</span>'
            const action = t.action === 'human' ? ' · chama atendente' : t.action === 'catalog' ? ' · mostra o catálogo' : ''
            return `
              <details class="kb-topic" data-id="${esc(id)}">
                <summary>${esc(t.title)} ${status}</summary>
                <div class="stack" style="padding:.6rem 0 .2rem">
                  <div class="muted" style="font-size:.85rem">Resposta padrão${action}: <span class="kb-answer">${waFormat(t.answer || '(sem texto)')}</span></div>
                  <label>Resposta personalizada (opcional)
                    <textarea name="override" rows="2" placeholder="Deixe em branco para usar a padrão. Pode usar {variaveis}.">${esc(ov.answer ?? '')}</textarea></label>
                  <label class="check"><input type="checkbox" name="enabled" ${ov.enabled === false ? '' : 'checked'}> Responder este assunto</label>
                  <div class="kb-questions"><strong>${t.questions.length} formas de perguntar:</strong> ${t.questions.map(esc).join(' · ')}</div>
                </div>
              </details>`
          }).join('')}`).join('')}
      </details>`
  }).join('')

  view.innerHTML = `
    <div class="config">
      <section class="card stack">
        <h3>Testar uma pergunta</h3>
        <form class="row" id="kb-test-form">
          <input id="kb-test" placeholder="Ex.: vcs entregam no centro?" autocomplete="off" style="flex:1;min-width:200px">
          <button class="btn primary">Testar</button>
        </form>
        <div id="kb-test-result" class="muted">Digite como um cliente escreveria e veja qual resposta o bot daria.</div>
      </section>

      ${isAdmin ? `<section class="card stack">
        <h3>Pacotes de perguntas</h3>
        <p class="muted">Ative os pacotes do ramo do negócio. O pacote comum vale para todos.</p>
        ${packs.map(p => `
          <div class="kb-pack">
            <label class="check"><input type="checkbox" name="pack" value="${esc(p.id)}" ${active.has(p.id) ? 'checked' : ''}>
              <span><strong>${esc(p.name)}</strong> <span class="muted">v${p.version} · ${p.topics} assuntos · ${p.questions} variações</span><br>
              <span class="muted" style="font-weight:400">${esc(p.description)}</span></span></label>
            <a class="btn small ghost" href="/api/knowledge/packs/${encodeURIComponent(p.id)}/export">⬇ Exportar</a>
          </div>`).join('')}
        ${isAdmin ? `<div class="row"><label class="btn small" style="display:inline-flex">⬆ Importar pacote (.json)
          <input type="file" id="kb-import" accept=".json,application/json" hidden></label>
          <span class="muted">Um pacote com o mesmo ID substitui o atual.</span></div>` : ''}
      </section>` : ''}

      ${canInfo ? `<section class="card stack">
        <h3>Informações do negócio</h3>
        <p class="muted">As respostas usam estas informações. Assunto sem informação preenchida não é respondido; o bot oferece um atendente.
          Nome, horário, endereço e telefone vêm da aba <b>Configuração</b>.</p>
        ${varsHtml || '<p class="muted">Ative um pacote para ver os campos.</p>'}
      </section>` : ''}

      <section class="card stack">
        <h3>Treinar o bot <span class="badge ${unanswered.length ? '' : 'hidden'}">${unanswered.length}</span></h3>
        <p class="muted">Perguntas que o bot não soube responder ou que foram marcadas com 👎 nas Conversas. Escolha o assunto certo e clique em <b>Ensinar</b>: a frase vira uma nova forma de perguntar e o bot passa a acertar.</p>
        ${unanswered.length ? `<div class="train-list">${unanswered.map(u => {
            const reason = u.topic === 'resposta-errada' ? '👎 Resposta marcada como errada'
              : u.topic ? `Assunto reconhecido (${esc(topicTitles[u.topic] ?? u.topic)}), mas falta: ${esc((topicVars[u.topic] ?? []).filter(x => !builtin[x]).map(x => labels[x] ?? x).join(', ') || 'resposta ativa')}`
              : 'Nenhum assunto parecido'
            const selected = topicTitles[u.topic] ? u.topic : ''
            return `<div class="train-item" data-id="${u.id}" data-text="${esc(u.text)}">
              <div class="train-q"><strong>“${esc(u.text)}”</strong> <span class="muted">· ${u.count}x · ${time(u.lastAt)}</span><br><span class="muted" style="font-size:.84rem">${reason}</span></div>
              <div class="row train-actions">
                <select class="train-topic" aria-label="Assunto certo"><option value="">Escolha o assunto certo…</option>${topicOptions(selected)}</select>
                ${isAdmin ? '<label class="check" title="Grava no pacote: vale para todos os clientes"><input type="checkbox" class="train-global"> Todos os clientes</label>' : ''}
                <button class="btn small primary train-btn">Ensinar</button>
                <button class="btn small ghost kb-del" data-id="${u.id}" aria-label="Descartar">✕</button>
              </div>
            </div>`
          }).join('')}</div>` : '<p class="muted">Nada para treinar por enquanto. 🎉</p>'}
      </section>

      ${isAdmin ? `<section class="card stack">
        <h3>Respostas e formas de perguntar</h3>
        <p class="muted">Personalize o texto de qualquer resposta ou desative assuntos que não se aplicam ao negócio.</p>
        ${topicsHtml || '<p class="muted">Nenhum pacote ativo.</p>'}
      </section>` : ''}

      ${!isAdmin ? '<p class="muted">Precisa mudar alguma resposta do bot? Peça na aba <b>Ajustes</b>. 😉</p>' : ''}
      ${canInfo ? '<div class="save-bar"><button class="btn primary" id="kb-save">Salvar</button></div>' : ''}
    </div>`

  $('#kb-test-form').onsubmit = async e => {
    e.preventDefault()
    const text = $('#kb-test').value.trim()
    if (!text) return
    const { result, threshold } = await api('POST', tenantUrl('/knowledge/test'), { text })
    const box = $('#kb-test-result')
    if (!result) { box.innerHTML = '❌ Nenhum assunto parecido. O bot responderia que não tem essa informação e ofereceria um atendente.'; return }
    const pct = Math.round(result.score * 100)
    const head = `<b>${esc(topicTitles[`${result.packId}/${result.topic}`] ?? result.title)}</b> · semelhança ${pct}% · pergunta mais parecida: “${esc(result.question)}”`
    if (result.score < threshold) box.innerHTML = `⚠️ ${head}<br>Semelhança baixa (mínimo ${Math.round(threshold * 100)}%): o bot <b>não</b> usaria esta resposta.`
    else if (result.status === 'missing') box.innerHTML = `⚠️ ${head}<br>Falta preencher: ${esc(result.missing.map(m => labels[m] ?? m).join(', ') || 'resposta desativada')}`
    else box.innerHTML = `✅ ${head}<div class="msg bot" style="margin-top:.5rem;max-width:100%">${waFormat(result.answer || '(chama o atendente)')}</div>`
  }

  for (const b of view.querySelectorAll('.kb-del')) {
    b.onclick = async () => { await api('DELETE', tenantUrl(`/knowledge/unanswered/${b.dataset.id}`)); renderKnowledge(); updateBadges() }
  }
  for (const item of view.querySelectorAll('.train-item')) {
    $('.train-btn', item).onclick = async () => {
      const key = $('.train-topic', item).value
      if (!key) { toast('Escolha o assunto certo primeiro.', 'error'); return }
      try {
        const r = await api('POST', tenantUrl('/knowledge/train'), {
          text: item.dataset.text, key, unansweredId: item.dataset.id, global: $('.train-global', item)?.checked === true,
        })
        toast(r.global ? 'Ensinado para todos os clientes ✔' : 'Ensinado ✔ O bot já entende essa frase.')
        renderKnowledge()
        updateBadges()
      } catch (err) { toast(err.message, 'error') }
    }
  }

  $('#kb-import')?.addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const pack = JSON.parse(await file.text())
      const res = await api('POST', '/api/knowledge/packs', pack)
      toast(`Pacote “${res.name}” importado (${res.topics} assuntos).`)
      renderKnowledge()
    } catch (err) { toast(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err.message) }
  })

  if ($('#kb-save')) $('#kb-save').onclick = async () => {
    const variables = { ...k.variables }
    for (const t of view.querySelectorAll('textarea[name=var]')) variables[t.dataset.key] = t.value.trim()
    const overrides = { ...k.overrides }
    for (const el of view.querySelectorAll('.kb-topic')) {
      const answer = $('textarea[name=override]', el).value
      const enabled = $('input[name=enabled]', el).checked
      if (answer.trim() || !enabled) overrides[el.dataset.id] = { answer, enabled }
      else delete overrides[el.dataset.id]
    }
    const packsOn = [...view.querySelectorAll('input[name=pack]:checked')].map(i => i.value)
    try {
      await api('PUT', tenantUrl('/config'), { ...cfg, knowledge: { packs: packsOn, variables, overrides } })
      toast('Base de conhecimento salva ✔')
      renderKnowledge()
    } catch (err) { toast(err.message) }
  }
}

// ---------- Clientes (Super Admin) ----------

async function renderClients () {
  const tenants = await api('GET', '/api/tenants')
  const statusPill = t => t.suspended
    ? '<span class="tag alert">Suspenso</span>'
    : `<span class="status-pill ${t.bot}">${STATUS_LABEL[t.bot] ?? t.bot}</span>`
  view.innerHTML = tenants.length ? `
    <div class="card table-wrap">
      <table class="clients">
        <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Plano e ajustes do mês</th><th>O cliente pode editar</th><th>Ações</th></tr></thead>
        <tbody>${tenants.map(t => `
          <tr data-id="${esc(t.id)}" class="${t.suspended ? 'suspended' : ''}">
            <td><strong>${esc(t.name)}</strong><br><span class="muted">ID: ${esc(t.id)}${t.hasPassword ? '' : ' · <span class="tag human">sem senha</span>'}</span>
              ${t.openRequests ? `<br><span class="tag alert">${t.openRequests} ajuste(s) pendente(s)</span>` : ''}</td>
            <td>${statusPill(t)}<br><span class="muted">${t.conversations} conversa(s)</span></td>
            <td>
              <div class="row" style="gap:.4rem">
                <input name="planName" value="${esc(t.plan.name)}" aria-label="Nome do plano" style="width:110px">
                <input name="planQuota" type="number" min="0" max="999" value="${t.plan.adjustmentsPerMonth}" aria-label="Ajustes por mês" style="width:70px">
                <span class="muted">/mês</span>
              </div>
              <div class="${t.usage > t.plan.adjustmentsPerMonth ? 'error' : 'muted'}" style="font-size:.85rem">${t.usage} de ${t.plan.adjustmentsPerMonth} usados este mês</div>
            </td>
            <td>
              <label class="check"><input type="checkbox" name="info" ${t.clientCan.info ? 'checked' : ''}> Informações (horário, Pix, taxa...)</label>
              <label class="check"><input type="checkbox" name="products" ${t.clientCan.products ? 'checked' : ''}> Produtos e preços</label>
            </td>
            <td class="actions">
              <button class="btn small primary" data-act="save">Salvar</button>
              <button class="btn small" data-act="view" ${t.suspended ? 'disabled' : ''}>👁️ Ver como cliente</button>
              <button class="btn small" data-act="open">Abrir</button>
              <button class="btn small ${t.suspended ? '' : 'danger'}" data-act="suspend">${t.suspended ? '✅ Reativar' : '⛔ Suspender'}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:.8rem">⛔ <b>Suspender</b> desliga o WhatsApp do cliente e bloqueia o painel dele até você reativar (use para mensalidade atrasada).
      👁️ <b>Ver como cliente</b> abre o painel exatamente como o cliente vê.</p>`
    : '<div class="card empty">Nenhum cliente ainda. Use “+ Novo cliente”.</div>'

  view.querySelector('table')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]')
    if (!btn) return
    const row = btn.closest('tr')
    const id = row.dataset.id
    const t = tenants.find(x => x.id === id)
    try {
      if (btn.dataset.act === 'save') {
        await api('PATCH', `/api/tenants/${encodeURIComponent(id)}/admin`, {
          plan: { name: $('[name=planName]', row).value, adjustmentsPerMonth: $('[name=planQuota]', row).value },
          clientCan: { info: $('[name=info]', row).checked, products: $('[name=products]', row).checked },
        })
        toast(`${t.name}: salvo ✔`)
      } else if (btn.dataset.act === 'suspend') {
        const suspend = !t.suspended
        if (suspend && !confirm(`Suspender ${t.name}? O WhatsApp será desligado e o cliente perde o acesso ao painel até ser reativado.`)) return
        await api('PATCH', `/api/tenants/${encodeURIComponent(id)}/admin`, { suspended: suspend })
        toast(suspend ? `${t.name} suspenso.` : `${t.name} reativado. Conecte o WhatsApp de novo na aba Conexão.`)
      } else if (btn.dataset.act === 'view') {
        await api('POST', `/api/tenants/${encodeURIComponent(id)}/impersonate`)
        state.tenantId = id
        state.tab = 'chats'
        await boot()
        return
      } else if (btn.dataset.act === 'open') {
        state.tenantId = id
        $('#tenant-select').value = id
        openTab('connection')
        return
      }
      await loadTenants()
      renderClients()
    } catch (err) { toast(err.message) }
  })
}

// ---------- Pedidos de ajuste ----------

const REQUEST_STATUS = { aberto: 'Aberto', andamento: 'Em andamento', feito: 'Feito', recusado: 'Recusado' }
const requestTag = s => `<span class="tag ${s === 'aberto' ? 'alert' : s === 'andamento' ? 'human' : s === 'feito' ? 'ok' : ''}">${REQUEST_STATUS[s]}</span>`

async function renderRequests () {
  return isAdmin() ? renderAdminRequests() : renderClientRequests()
}

async function renderAdminRequests () {
  const all = await api('GET', '/api/requests')
  const filter = renderAdminRequests.filter ?? 'pendentes'
  const shown = filter === 'pendentes' ? all.filter(r => r.status === 'aberto' || r.status === 'andamento') : all
  view.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <button class="btn small ${filter === 'pendentes' ? 'primary' : ''}" data-filter="pendentes">Pendentes (${all.filter(r => r.status === 'aberto' || r.status === 'andamento').length})</button>
      <button class="btn small ${filter === 'todos' ? 'primary' : ''}" data-filter="todos">Todos (${all.length})</button>
    </div>
    ${shown.length ? `<div class="stack">${shown.map(r => `
      <div class="card stack request" data-tenant="${esc(r.tenantId)}" data-id="${esc(r.id)}">
        <div class="row" style="justify-content:space-between">
          <div><strong>${esc(r.tenantName)}</strong> <span class="muted">· #${r.number} · ${time(r.createdAt)}</span></div>
          ${requestTag(r.status)}
        </div>
        <div class="request-text">${esc(r.text)}</div>
        <div class="row">
          <select name="status" aria-label="Status">${Object.entries(REQUEST_STATUS).map(([v, l]) => `<option value="${v}" ${v === r.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input name="note" value="${esc(r.note)}" placeholder="Resposta para o cliente (opcional)" style="flex:1;min-width:200px">
          <button class="btn small primary" data-act="save">Salvar</button>
          <button class="btn small" data-act="view">👁️ Ver como cliente</button>
        </div>
      </div>`).join('')}</div>` : '<div class="card empty">Nenhum pedido de ajuste pendente. 🎉</div>'}`

  for (const b of view.querySelectorAll('[data-filter]')) {
    b.onclick = () => { renderAdminRequests.filter = b.dataset.filter; renderAdminRequests() }
  }
  for (const card of view.querySelectorAll('.request')) {
    const tenant = card.dataset.tenant
    $('[data-act=save]', card).onclick = async () => {
      try {
        await api('PATCH', `/api/tenants/${encodeURIComponent(tenant)}/requests/${encodeURIComponent(card.dataset.id)}`, {
          status: $('[name=status]', card).value, note: $('[name=note]', card).value,
        })
        toast('Pedido atualizado ✔')
        renderAdminRequests()
        updateBadges().catch(() => {})
      } catch (err) { toast(err.message) }
    }
    $('[data-act=view]', card).onclick = async () => {
      await api('POST', `/api/tenants/${encodeURIComponent(tenant)}/impersonate`)
      state.tenantId = tenant
      state.tab = 'chats'
      await boot()
    }
  }
}

async function renderClientRequests () {
  const { requests, plan, usage } = await api('GET', tenantUrl('/requests'))
  const over = usage >= plan.adjustmentsPerMonth
  view.innerHTML = `
    <div class="config">
      <section class="card stack">
        <h3>Pedir um ajuste</h3>
        <p class="muted">Descreva o que você quer mudar no bot: preços, produtos, respostas, horário, mensagens... A nossa equipe faz para você.</p>
        <form id="req-form" class="stack">
          <textarea id="req-text" rows="3" placeholder="Ex.: Mudar o preço da pizza calabresa para R$ 55,00 e incluir a pizza de frango com catupiry por R$ 59,90." required></textarea>
          <div class="row" style="justify-content:space-between">
            <span class="${over ? 'error' : 'muted'}">Plano ${esc(plan.name)}: ${usage} de ${plan.adjustmentsPerMonth} ajustes usados este mês${over ? ' — novos pedidos podem ser cobrados à parte' : ''}</span>
            <button class="btn primary">Enviar pedido</button>
          </div>
        </form>
      </section>
      <section class="card stack">
        <h3>Meus pedidos</h3>
        ${requests.length ? requests.map(r => `
          <div class="request-item">
            <div class="row" style="justify-content:space-between"><span class="muted">#${r.number} · ${time(r.createdAt)}</span>${requestTag(r.status)}</div>
            <div class="request-text">${esc(r.text)}</div>
            ${r.note ? `<div class="request-note">💬 ${esc(r.note)}</div>` : ''}
          </div>`).join('') : '<p class="muted">Você ainda não fez nenhum pedido.</p>'}
      </section>
    </div>`
  $('#req-form').onsubmit = async e => {
    e.preventDefault()
    try {
      await api('POST', tenantUrl('/requests'), { text: $('#req-text').value })
      toast('Pedido enviado! Avisaremos por aqui quando estiver pronto. ✔')
      renderClientRequests()
    } catch (err) { toast(err.message) }
  }
}

// ---------- Configuração do cliente (só o que o Super Admin liberou) ----------

async function renderClientConfig () {
  const c = await api('GET', tenantUrl('/config'))
  const info = can('info')
  const products = can('products')
  view.innerHTML = `
    <form id="client-config" class="config">
      ${info ? `<section class="card stack">
        <h3>Dados do negócio</h3>
        <div class="grid2">
          <label>Horário de funcionamento<input name="hours" value="${esc(c.business.hours)}"></label>
          <label>Telefone<input name="phone" value="${esc(c.business.phone)}"></label>
          <label>Endereço<input name="address" value="${esc(c.business.address)}"></label>
        </div>
        <label>Descrição do negócio<textarea name="description">${esc(c.business.description)}</textarea></label>
        <label>Perguntas frequentes e informações extras<textarea name="extraInfo" rows="5">${esc(c.business.extraInfo)}</textarea></label>
        <p class="muted">Pix, taxa de entrega, promoções e outras informações ficam na aba <b>Conhecimento</b>.</p>
      </section>` : ''}
      ${products ? `<section class="card stack">
        <h3>Produtos e preços</h3>
        <div id="product-rows">${c.products.map(productRow).join('')}</div>
        <div><button type="button" class="btn small" id="add-product">+ Adicionar produto</button></div>
        ${catalogRulesHtml(c)}
      </section>` : ''}
      <section class="card stack">
        <h3>Senha do painel</h3>
        <label style="max-width:320px">Nova senha<input name="newPassword" type="password" minlength="8" autocomplete="new-password" placeholder="deixe em branco para manter"></label>
      </section>
      <p class="muted">Para mudar menu, mensagens ou respostas do bot, peça na aba <b>Ajustes</b>.</p>
      <div class="save-bar"><button class="btn primary">Salvar</button></div>
    </form>`
  const form = $('#client-config')
  $('#add-product')?.addEventListener('click', () => $('#product-rows').insertAdjacentHTML('beforeend', productRow()))
  form.addEventListener('click', e => { if (e.target.matches('.remove')) e.target.closest('.edit-row').remove() })
  form.onsubmit = async e => {
    e.preventDefault()
    const v = name => form.elements[name]
    const body = { ...c, newPassword: v('newPassword').value }
    if (info) {
      body.business = {
        ...c.business,
        hours: v('hours').value, phone: v('phone').value, address: v('address').value,
        description: v('description').value, extraInfo: v('extraInfo').value,
      }
    }
    if (products) {
      body.products = [...form.querySelectorAll('.product-row')].map(productFromRow)
      body.halfHalf = v('halfHalf').value
      body.synonyms = v('synonyms').value
    }
    try {
      await api('PUT', tenantUrl('/config'), body)
      toast('Salvo ✔')
      renderClientConfig()
    } catch (err) { toast(err.message) }
  }
}


// ---------- início ----------

applyTheme(getTheme())
loadBrand().finally(() => boot().catch(() => showLogin()))
