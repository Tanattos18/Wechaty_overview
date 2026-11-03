// Painel do cliente — JavaScript puro, sem build.

const $ = (sel, root = document) => root.querySelector(sel)
const view = $('#view')

const TABS = {
  connection: 'Conexão com WhatsApp',
  chats: 'Conversas',
  orders: 'Pedidos',
  knowledge: 'Base de conhecimento',
  config: 'Configuração do bot',
  simulator: 'Simulador',
}
const STATUS_LABEL = { stopped: 'Desligado', starting: 'Iniciando…', qr: 'Aguardando leitura do QR', online: 'Conectado', error: 'Erro' }
const ORDER_STATUS = ['novo', 'confirmado', 'preparando', 'enviado', 'concluido', 'cancelado']
const MENU_TYPES = { text: 'Resposta fixa', catalog: 'Catálogo / pedido', ai: 'Dúvidas com IA', human: 'Falar com atendente' }

const state = {
  me: null,
  tenants: [],
  tenantId: null,
  tab: 'connection',
  chatId: null,
  simChatId: null,
  config: null,
  poll: null,
}

// ---------- utilidades ----------

async function api (method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Sessão expirada.') }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}
const tenantUrl = (path = '') => `/api/tenants/${encodeURIComponent(state.tenantId)}${path}`

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** Escapa e aplica a formatação do WhatsApp (*negrito* e _itálico_). */
const waFormat = s => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const time = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function toast (msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => el.classList.add('hidden'), 2800)
}

function stopPolling () { clearInterval(state.poll); state.poll = null }
function startPolling (fn, ms = 4000) { stopPolling(); state.poll = setInterval(() => fn().catch(() => {}), ms) }

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
  try {
    await api('POST', '/api/login', { tenantId: form.get('tenantId'), password: form.get('password') })
    e.target.reset()
    await boot()
  } catch (err) {
    $('#login-error').textContent = err.message
  }
})

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {})
  showLogin()
})

// ---------- navegação ----------

$('#nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]')
  if (btn) openTab(btn.dataset.tab)
})

$('#tenant-select').addEventListener('change', e => {
  state.tenantId = e.target.value
  state.chatId = null
  state.simChatId = null
  state.config = null
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

async function boot () {
  state.me = await api('GET', '/api/me')
  $('#login').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#new-tenant').classList.toggle('hidden', state.me.role !== 'admin')
  await loadTenants()
  openTab(state.tab)
  updateBadges().catch(() => {})
  boot.badges ??= setInterval(() => updateBadges().catch(() => {}), 8000)
}

async function updateBadges () {
  if (!state.tenantId) return
  const [convs, orders, unanswered] = await Promise.all([
    api('GET', tenantUrl('/conversations')), api('GET', tenantUrl('/orders')), api('GET', tenantUrl('/knowledge/unanswered')),
  ])
  const waiting = convs.filter(c => c.needsAgent || (c.unread > 0 && c.state === 'human')).length
  const fresh = orders.filter(o => o.status === 'novo').length
  setBadge('#badge-chats', waiting)
  setBadge('#badge-orders', fresh)
  setBadge('#badge-knowledge', unanswered.length)
}
function setBadge (sel, n) {
  const el = $(sel)
  el.textContent = n
  el.classList.toggle('hidden', !n)
}

function openTab (tab) {
  stopPolling()
  state.tab = tab
  $('#title').textContent = TABS[tab]
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('active', b.dataset.tab === tab)
  if (!state.tenantId) {
    view.innerHTML = '<div class="card empty">Nenhum cliente cadastrado. Use “+ Novo cliente”.</div>'
    return
  }
  const render = { connection: renderConnection, chats: renderChats, orders: renderOrders, knowledge: renderKnowledge, config: renderConfig, simulator: renderSimulator }[tab]
  render().catch(err => { view.innerHTML = `<div class="card error">${esc(err.message)}</div>` })
}

// ---------- novo cliente (admin) ----------

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
    <div class="card stack" style="max-width:640px">
      <div class="row"><strong>Status:</strong> <span id="bot-status" class="status-pill">…</span></div>
      <div id="bot-detail" class="muted"></div>
      <div id="bot-qr"></div>
      <div class="row">
        <button id="bot-start" class="btn primary">Conectar WhatsApp</button>
        <button id="bot-stop" class="btn danger">Desconectar</button>
      </div>
      <p class="muted">Ao conectar, um QR Code aparece aqui. No celular do negócio abra o WhatsApp →
        <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e aponte para o código.</p>
    </div>`
  $('#bot-start').onclick = async () => { await api('POST', tenantUrl('/bot/start')); toast('Iniciando…'); refresh() }
  $('#bot-stop').onclick = async () => { await api('POST', tenantUrl('/bot/stop')); toast('Desconectado.'); refresh() }

  async function refresh () {
    const info = await api('GET', tenantUrl('/bot'))
    const pill = $('#bot-status')
    if (!pill) return
    pill.className = `status-pill ${info.status}`
    pill.textContent = STATUS_LABEL[info.status] ?? info.status
    $('#bot-detail').textContent = info.user ? `Conectado como ${info.user}` : (info.error ? `Erro: ${info.error}` : '')
    $('#bot-qr').innerHTML = info.qrImage ? `<div class="qr-box"><img alt="QR Code do WhatsApp" src="${info.qrImage}"></div>` : ''
    $('#bot-start').disabled = info.status !== 'stopped' && info.status !== 'error'
    $('#bot-stop').disabled = info.status === 'stopped'
  }
  await refresh()
  startPolling(refresh, 3000)
}

// ---------- Conversas ----------

function messageHtml (m) {
  const who = { customer: 'Cliente', bot: 'Bot', agent: 'Atendente' }[m.from]
  return `<div class="msg ${m.from}">${waFormat(m.text)}<span class="meta">${who} · ${time(m.at)}</span></div>`
}

function stateTag (c) {
  if (c.needsAgent) return '<span class="tag alert">Aguardando atendente</span>'
  if (c.state === 'human') return '<span class="tag human">Atendimento humano</span>'
  if (c.state.startsWith('checkout')) return '<span class="tag">Finalizando pedido</span>'
  return ''
}

async function renderChats () {
  view.innerHTML = `
    <div class="chats">
      <div class="card chat-list" id="chat-list"></div>
      <div class="card chat-panel" id="chat-panel"><div class="empty">Selecione uma conversa</div></div>
    </div>`

  async function refreshList () {
    const convs = await api('GET', tenantUrl('/conversations'))
    const list = $('#chat-list')
    if (!list) return
    list.innerHTML = convs.length ? convs.map(c => `
      <div class="chat-item ${c.chatId === state.chatId ? 'active' : ''}" data-id="${esc(c.chatId)}">
        <div class="top"><span>${esc(c.name || c.chatId)}</span>
          ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</div>
        <div class="row">${stateTag(c)}${c.channel === 'simulator' ? '<span class="tag">Simulador</span>' : ''}
          <span class="muted" style="font-size:.75rem;margin-left:auto">${time(c.updatedAt)}</span></div>
        <div class="preview">${c.lastMessage ? esc(c.lastMessage.text) : ''}</div>
      </div>`).join('') : '<div class="empty">Nenhuma conversa ainda.</div>'
  }

  async function refreshChat (scroll) {
    if (!state.chatId) return
    const c = await api('GET', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}`))
    const panel = $('#chat-panel')
    if (!panel) return
    const box = $('#messages', panel)
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40
    const draft = $('#reply', panel)?.value ?? ''
    const human = c.state === 'human'
    panel.innerHTML = `
      <div class="chat-head">
        <div><strong>${esc(c.name || c.chatId)}</strong> ${stateTag(c)}
          ${c.cart.length ? `<div class="muted" style="font-size:.85rem">🛒 ${c.cart.map(i => `${i.qty}x ${esc(i.name)}`).join(', ')}</div>` : ''}</div>
        <div class="row">
          ${human
            ? '<button class="btn small" id="release">Devolver ao bot</button>'
            : '<button class="btn small" id="takeover">Assumir conversa</button>'}
        </div>
      </div>
      <div class="messages" id="messages">${c.messages.map(messageHtml).join('')}</div>
      <form class="composer" id="composer">
        <input id="reply" placeholder="Responder como atendente… (o bot pausa nesta conversa)" autocomplete="off">
        <button class="btn primary">Enviar</button>
      </form>`
    const input = $('#reply', panel)
    input.value = draft
    const msgs = $('#messages', panel)
    if (scroll || atBottom) msgs.scrollTop = msgs.scrollHeight
    $('#composer', panel).onsubmit = async e => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      try {
        await api('POST', tenantUrl(`/conversations/${encodeURIComponent(state.chatId)}/reply`), { text })
        input.value = ''
        await refreshChat(true)
      } catch (err) { toast(err.message) }
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
      } catch (err) { toast(err.message) }
    })
    if (document.activeElement !== input && draft) input.focus()
  }

  $('#chat-list').addEventListener('click', e => {
    const item = e.target.closest('.chat-item')
    if (!item) return
    state.chatId = item.dataset.id
    for (const el of document.querySelectorAll('.chat-item')) el.classList.toggle('active', el === item)
    refreshChat(true)
  })

  await refreshList()
  await refreshChat(true)
  startPolling(async () => {
    await refreshList()
    // não redesenha enquanto o atendente digita
    if (document.activeElement?.id !== 'reply') await refreshChat()
  })
}

// ---------- Pedidos ----------

async function renderOrders () {
  async function refresh () {
    const orders = await api('GET', tenantUrl('/orders'))
    if (state.tab !== 'orders') return
    if (document.activeElement?.tagName === 'SELECT') return
    view.innerHTML = orders.length ? `
      <div class="card table-wrap">
        <table>
          <thead><tr><th>#</th><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Entrega</th><th>Status</th></tr></thead>
          <tbody>${orders.map(o => `
            <tr>
              <td><strong>${o.number}</strong></td>
              <td>${time(o.createdAt)}</td>
              <td>${esc(o.customerName)}${o.channel === 'simulator' ? ' <span class="tag">Simulador</span>' : ''}</td>
              <td>${o.items.map(i => `${i.qty}x ${esc(i.name)}`).join('<br>')}</td>
              <td>${money(o.total)}</td>
              <td>${esc(o.address)}</td>
              <td><select data-id="${esc(o.id)}">${ORDER_STATUS.map(s =>
                `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="card empty">Nenhum pedido ainda. Teste pelo Simulador!</div>'
    for (const sel of view.querySelectorAll('select[data-id]')) {
      sel.onchange = async () => {
        try {
          await api('PATCH', tenantUrl(`/orders/${encodeURIComponent(sel.dataset.id)}`), { status: sel.value })
          toast('Status atualizado.')
          sel.blur()
          updateBadges()
        } catch (err) { toast(err.message) }
      }
    }
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

function productRow (p = { id: '', name: '', price: '', description: '', active: true }) {
  return `
    <div class="edit-row product product-row" data-id="${esc(p.id)}">
      <input name="name" value="${esc(p.name)}" placeholder="Produto" aria-label="Produto">
      <input name="price" type="number" min="0" step="0.01" value="${esc(p.price)}" placeholder="Preço" aria-label="Preço">
      <input name="description" value="${esc(p.description ?? '')}" placeholder="Descrição (opcional)" aria-label="Descrição">
      <label class="check"><input name="active" type="checkbox" ${p.active ? 'checked' : ''}> Ativo</label>
      <button type="button" class="btn small danger remove" aria-label="Remover">✕</button>
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
        <div id="product-rows">${c.products.map(productRow).join('')}</div>
        <div><button type="button" class="btn small" id="add-product">+ Adicionar produto</button></div>
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
      products: [...form.querySelectorAll('.product-row')].map(r => ({
        id: r.dataset.id, name: $('[name=name]', r).value, price: $('[name=price]', r).value,
        description: $('[name=description]', r).value, active: $('[name=active]', r).checked,
      })),
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

// ---------- Simulador ----------

async function renderSimulator () {
  view.innerHTML = `
    <div class="row" style="align-items:flex-start">
      <div class="card phone">
        <div class="chat-head"><strong>📱 Cliente de teste</strong>
          <div class="row">
            <input id="sim-name" value="Maria" aria-label="Nome do cliente de teste" title="Nome do cliente de teste" style="width:90px;padding:.3rem .5rem">
            <label class="check" style="font-size:.85rem"><input type="checkbox" id="sim-typing" checked> Ritmo real</label>
            <button class="btn small" id="sim-reset">Nova conversa</button>
          </div></div>
        <div class="messages" id="sim-messages"><div class="empty">Envie “oi” para começar.</div></div>
        <form class="composer" id="sim-form">
          <input id="sim-input" placeholder="Digite como se fosse o cliente…" autocomplete="off">
          <button class="btn primary">Enviar</button>
        </form>
      </div>
      <div class="card stack" style="max-width:360px">
        <h3>Como testar</h3>
        <p class="muted">O simulador usa exatamente o mesmo bot do WhatsApp, com a configuração salva deste cliente.
          Pedidos de teste aparecem em <b>Pedidos</b> e a conversa em <b>Conversas</b> (marcados como “Simulador”).</p>
        <p class="muted">Experimente: <b>oi</b> → <b>1</b> → <b>2 x3</b> → <b>finalizar</b>, ou faça uma pergunta livre para a IA.</p>
      </div>
    </div>`
  const box = $('#sim-messages')
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const showTyping = () => {
    box.insertAdjacentHTML('beforeend', '<div class="msg bot typing" aria-label="digitando"><span></span><span></span><span></span></div>')
    box.scrollTop = box.scrollHeight
    return box.lastElementChild
  }
  const add = (from, text) => {
    $('.empty', box)?.remove()
    box.insertAdjacentHTML('beforeend', messageHtml({ from, text, at: new Date().toISOString() }))
    box.scrollTop = box.scrollHeight
  }
  $('#sim-reset').onclick = () => { state.simChatId = null; box.innerHTML = '<div class="empty">Envie “oi” para começar.</div>' }
  $('#sim-form').onsubmit = async e => {
    e.preventDefault()
    const input = $('#sim-input')
    const text = input.value.trim()
    if (!text) return
    input.value = ''
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
        add('bot', r)
      }
    } catch (err) { toast(err.message) }
    input.focus()
  }
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
  const builtin = { empresa: cfg.name, horario: cfg.business.hours, endereco: cfg.business.address, telefone: cfg.business.phone }
  const topicTitles = Object.fromEntries(details.flatMap(p => p.topics.map(t => [`${p.id}/${t.key}`, `${p.name} › ${t.title}`])))
  const topicVars = Object.fromEntries(details.flatMap(p => p.topics.map(t => [`${p.id}/${t.key}`, placeholders(t.answer)])))
  const labels = Object.fromEntries(packs.flatMap(p => p.variables.map(v => [v.key, v.label])))

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

      <section class="card stack">
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
      </section>

      <section class="card stack">
        <h3>Informações do negócio</h3>
        <p class="muted">As respostas usam estas informações. Assunto sem informação preenchida não é respondido; o bot oferece um atendente.
          Nome, horário, endereço e telefone vêm da aba <b>Configuração</b>.</p>
        ${varsHtml || '<p class="muted">Ative um pacote para ver os campos.</p>'}
      </section>

      <section class="card stack">
        <h3>Perguntas sem resposta <span class="badge ${unanswered.length ? '' : 'hidden'}">${unanswered.length}</span></h3>
        <p class="muted">O que os clientes perguntaram e o bot não soube responder. Use para completar as informações ou criar novas respostas.</p>
        ${unanswered.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Pergunta</th><th>Vezes</th><th>Motivo</th><th>Última</th><th></th></tr></thead>
          <tbody>${unanswered.map(u => {
            const reason = u.topic
              ? `Assunto reconhecido (${esc(topicTitles[u.topic] ?? u.topic)}), mas falta: ${esc((topicVars[u.topic] ?? []).filter(x => !builtin[x]).map(x => labels[x] ?? x).join(', ') || 'resposta ativa')}`
              : 'Nenhum assunto parecido no banco'
            return `<tr><td>${esc(u.text)}</td><td>${u.count}</td><td class="muted">${reason}</td><td>${time(u.lastAt)}</td>
              <td><button class="btn small ghost kb-del" data-id="${u.id}" aria-label="Remover">✕</button></td></tr>`
          }).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma por enquanto. 🎉</p>'}
      </section>

      <section class="card stack">
        <h3>Respostas e formas de perguntar</h3>
        <p class="muted">Personalize o texto de qualquer resposta ou desative assuntos que não se aplicam ao negócio.</p>
        ${topicsHtml || '<p class="muted">Nenhum pacote ativo.</p>'}
      </section>

      <div class="save-bar"><button class="btn primary" id="kb-save">Salvar base de conhecimento</button></div>
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

  $('#kb-save').onclick = async () => {
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

// ---------- início ----------

boot().catch(() => showLogin())
