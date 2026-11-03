# Instalação na VPS da Hostinger

Passo a passo para colocar o SaaS ChatBot no ar numa VPS da Hostinger (Ubuntu), com domínio,
HTTPS e reinício automático. Leva cerca de 30 minutos.

## 0. Antes de começar

- **Plano:** cada número de WhatsApp conectado abre um navegador (≈ 200–300 MB de RAM).
  Como referência: plano com 4 GB para até ~8 clientes conectados; 8 GB para até ~20.
- **Sistema:** no hPanel, em *VPS → Sistema operacional*, escolha **Ubuntu 24.04** (limpo, sem painel).
- **Domínio:** crie um registro **A** apontando, por exemplo, `painel.seudominio.com.br` para o IP da VPS
  (hPanel → *Domínios → DNS*). A propagação pode levar alguns minutos.
- **Acesso:** no hPanel, em *VPS → Visão geral*, pegue o IP e a senha root (ou cadastre sua chave SSH).

## 1. Entrar na VPS e instalar o necessário

No PowerShell do seu computador:

```bash
ssh root@IP_DA_VPS
```

Na VPS:

```bash
apt update && apt upgrade -y
apt install -y git nginx curl ufw

# Node.js 24 (o projeto usa o SQLite embutido no Node 22.13+)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

# Google Chrome (usado pelo WhatsApp Web); já instala as bibliotecas que ele precisa
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
apt install -y /tmp/chrome.deb

# Gerenciador de processos (mantém o bot rodando e reinicia se cair)
npm install -g pm2

node -v && google-chrome-stable --version
```

## 2. Usuário próprio e código do projeto

Não rode o bot como root:

```bash
adduser --disabled-password --gecos "" chatbot
su - chatbot
git clone https://github.com/Tanattos18/Wechaty_overview.git chatbot
cd chatbot
PUPPETEER_SKIP_DOWNLOAD=true npm ci
```

> Se o repositório for privado, o `git clone` pede usuário e um **token** do GitHub
> (GitHub → Settings → Developer settings → Personal access tokens) no lugar da senha.

## 3. Configurar o `.env`

Primeiro confira quais portas já estão em uso (outros sistemas na mesma VPS):

```bash
ss -tlnp | grep -E ':(3000|3100) '
```

Se nada aparecer para `3100`, use `PORT=3100` (recomendado quando a VPS já tem outros sistemas).

```bash
cp .env.example .env
nano .env
```

Ajuste:

```ini
PORT=3100
ADMIN_PASSWORD=uma-senha-forte-e-diferente-da-local
SESSION_SECRET=   # gere com o comando abaixo e cole aqui
BROWSER_PATH=/usr/bin/google-chrome-stable
AUTO_START_BOTS=true
TRUST_PROXY=true
COOKIE_SECURE=true
```

Gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

## 4. Levar os dados do seu computador (opcional)

O Git **não** leva conversas, pedidos, a base de conhecimento já carregada nem as sessões do
WhatsApp (estão no `.gitignore`). Os pacotes de perguntas vêm pelo Git e são carregados no
primeiro início. Para levar os **clientes configurados** no seu computador, rode no PowerShell local,
dentro da pasta do projeto:

```bash
scp -r data/clients root@IP_DA_VPS:/home/chatbot/chatbot/data/
```

Depois, na VPS:

```bash
chown -R chatbot:chatbot /home/chatbot/chatbot/data
```

As **sessões do WhatsApp não devem ser copiadas**: reconecte cada número pelo QR Code no painel da VPS.

## 5. Iniciar com o PM2

Como usuário `chatbot`, dentro de `~/chatbot`:

```bash
pm2 start npm --name chatbot -- start
pm2 save
pm2 logs chatbot --lines 20     # deve aparecer "Painel em http://localhost:3100"
```

Para iniciar sozinho quando a VPS reiniciar, rode `pm2 startup` e **copie e execute como root**
o comando que ele mostrar.

## 6. Domínio com HTTPS

### 6A. VPS que já usa Caddy (outros sistemas já publicados, como na VPS atual)

Se ao instalar o Nginx apareceu *"port 80 is already in use"*, a VPS já tem um servidor web — normalmente
o **Caddy** (veja com `systemctl status caddy`). Use ele; o Caddy já gera o HTTPS sozinho.

Como root, desative o Nginx para ele não disputar a porta 80 depois de reiniciar:

```bash
systemctl disable --now nginx
```

Faça uma cópia do Caddyfile antes de mexer e abra para editar:

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
nano /etc/caddy/Caddyfile
```

**Acrescente no final** (sem alterar os blocos que já existem; troque o domínio):

```caddy
painel.seudominio.com.br {
    reverse_proxy 127.0.0.1:3100
    request_body {
        max_size 10MB
    }
}
```

Valide e recarregue (o reload não derruba os outros sites):

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Se der erro no `validate`, volte a cópia (`cp /etc/caddy/Caddyfile.bak-* /etc/caddy/Caddyfile`) e me mande a mensagem.

### 6B. VPS limpa: Nginx + Certbot

Como root, crie `/etc/nginx/sites-available/chatbot` (troque o domínio e a porta):

```nginx
server {
    listen 80;
    server_name painel.seudominio.com.br;

    client_max_body_size 10m;   # importação de pacotes de conhecimento

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ative e gere o certificado gratuito:

```bash
ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d painel.seudominio.com.br
```

## 7. Firewall

⚠️ **Se a VPS já tem outros sistemas rodando**, antes de ligar o firewall veja quais portas eles usam
(`ss -tlnp`) e libere também as que precisam ser acessadas de fora. Na dúvida, pule este passo e me mande
a saída do `ss -tlnp`.

Deixe abertos só SSH e web. A porta do painel (3100) fica fechada — o acesso passa pelo Caddy/Nginx:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Se a Hostinger tiver firewall próprio ativo no hPanel, libere também as portas 22, 80 e 443 lá.

Pronto: acesse `https://painel.seudominio.com.br`, entre como `admin` e conecte os WhatsApps
na aba **Conexão**.

## Atualizar depois de mudanças

Como usuário `chatbot`:

```bash
cd ~/chatbot && git pull && PUPPETEER_SKIP_DOWNLOAD=true npm ci && pm2 restart chatbot
```

Pacotes de conhecimento com `version` maior são recarregados automaticamente ao reiniciar.

## Backup

Tudo o que importa fica em `~/chatbot/data` (clientes, conversas, pedidos, base de conhecimento,
sessões). Um backup diário às 3h, guardando 14 dias (`crontab -e` como `chatbot`):

```cron
0 3 * * * tar czf ~/backup-chatbot-$(date +\%F).tgz -C ~/chatbot data && find ~ -name 'backup-chatbot-*.tgz' -mtime +14 -delete
```

Vale também ativar os **snapshots/backups da VPS** no hPanel.

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| QR Code não aparece | `pm2 logs chatbot`; confirme `BROWSER_PATH=/usr/bin/google-chrome-stable` e o Chrome instalado |
| "Faça login" a cada clique | Com `COOKIE_SECURE=true` o painel precisa ser aberto por **https://** |
| Painel não abre pelo domínio | `caddy validate --config /etc/caddy/Caddyfile` (ou `nginx -t`), DNS apontando para o IP, firewall com 80/443 liberadas |
| "port 80 is already in use" ao instalar o Nginx | A VPS já tem Caddy: siga o passo **6A** e desative o Nginx |
| VPS lenta / sem memória | `free -h`; muitos WhatsApps conectados → plano com mais RAM |
| Erro de `node:sqlite` | Node antigo: `node -v` precisa ser 22.13 ou maior |
