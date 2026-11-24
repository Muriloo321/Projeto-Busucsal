# Integração com o WhatsApp (Cloud API da Meta)

O webhook `/webhook/whatsapp` recebe as mensagens, passa cada uma pelo **mesmo assistente** do simulador
(`conversaService.processar`, canal `whatsapp`) e devolve a resposta pelo número do BusUCSAL. As regras
(status, previsão, avisos) não mudam: o WhatsApp é só outro canal.

```text
Usuário ─► WhatsApp ─► Meta ─► POST /webhook/whatsapp ─► valida assinatura ─► assistente ─► Graph API ─► Usuário
```

Segurança já embutida: assinatura `X-Hub-Signature-256` (HMAC com o App Secret) conferida sobre o corpo bruto;
token de verificação comparado em tempo constante; o número do usuário só existe em memória e no envio
(no banco fica apenas o hash); reenvios da Meta (mesmo id de mensagem) são respondidos uma vez só;
a resposta HTTP 200 é imediata e o processamento segue em segundo plano.

## 1. Pré-requisitos
- Conta em https://developers.facebook.com e um app do tipo **Empresa** com o produto **WhatsApp**.
- Uma **URL pública HTTPS** para o servidor (a Meta não chama `localhost`). Para testar no seu computador use um túnel:
  - `ngrok http 3000` (https://ngrok.com) ou `cloudflared tunnel --url http://localhost:3000`
  - A URL fica como `https://xxxx.ngrok-free.app`.

## 2. Pegar as credenciais no painel da Meta
| Variável `.env` | Onde encontrar |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → **Configuração da API** → "ID do número de telefone" |
| `WHATSAPP_ACCESS_TOKEN` | Mesma tela (token temporário, 24 h) — para produção crie um **token permanente** de *Usuário do sistema* (Configurações do negócio → Usuários do sistema, permissões `whatsapp_business_messaging` e `whatsapp_business_management`) |
| `WHATSAPP_APP_SECRET` | Configurações do app → Básico → **Chave secreta do app** |
| `WHATSAPP_VERIFY_TOKEN` | Você escolhe (mín. 16 caracteres). `npm run configurar` já gera um |

## 3. Configurar o `.env`
```env
WHATSAPP_ENABLED=true
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
```
Reinicie com `npm start`. Se faltar algo, o servidor avisa qual variável é.

## 4. Cadastrar o webhook
No painel: WhatsApp → **Configuração** → Webhook → **Editar**
- **URL de callback:** `https://SEU-DOMINIO/webhook/whatsapp`
- **Token de verificação:** o mesmo `WHATSAPP_VERIFY_TOKEN`
- Clique em **Verificar e salvar** e depois em **Gerenciar** → assine o campo **`messages`**.

## 5. Testar sem a Meta (simulação local)
No `.env`: `WHATSAPP_ENABLED=true`, `WHATSAPP_GRAPH_URL=http://127.0.0.1:4010` e valores quaisquer (mín. 16–20 caracteres)
nas demais `WHATSAPP_*`, com `WHATSAPP_PHONE_NUMBER_ID` só com dígitos. Reinicie o servidor e rode, em outro terminal:
`npm run whatsapp:simular` (conversa interativa) ou `npm run whatsapp:simular -- "oi"`.

## 6. Testar com a Meta de verdade
1. Em *Configuração da API*, adicione seu celular em **Para** (lista de destinatários de teste) e confirme o código.
2. Mande "oi" ou "quando o ônibus chega?" para o número de teste da Meta.
3. Com `DEMO_MODE=true`, aplique um cenário na página de apresentação para o assistente ter dados.
4. A página técnica mostra as chamadas em `/webhook/whatsapp` (status 200) e as métricas de resposta.

## 7. Passar para produção
- Adicione um número real e conclua a **verificação da empresa** na Meta.
- Troque o token temporário por um **permanente**.
- Use `DEMO_MODE=false`, `COOKIE_SECURE=true` e HTTPS de verdade (proxy reverso).
- Respostas a mensagens do usuário são livres por 24 h (janela de atendimento). Mensagens iniciadas por você
  fora dessa janela exigem *templates* aprovados (não usados aqui).

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| "Verificar e salvar" falha | URL sem HTTPS/túnel fora do ar, ou token de verificação diferente do `.env` (servidor responde 403) |
| Webhook recebe mas nada responde, log `assinatura_invalida` (401) | `WHATSAPP_APP_SECRET` errado ou de outro app |
| Log "falha ao enviar a resposta … 190" | Token de acesso expirado (o temporário dura 24 h) |
| Erro `131030` | O número não está na lista de destinatários de teste |
| Erro `131047` | Passou de 24 h desde a última mensagem do usuário |
