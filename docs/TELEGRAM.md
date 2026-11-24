# Integração com o Telegram

O webhook `/webhook/telegram` recebe as mensagens do bot, passa cada uma pelo **mesmo assistente** do site e do
WhatsApp (`conversaService.processar`, canal `telegram`) e responde pelo `sendMessage`.

```text
Usuário ─► Telegram ─► POST /webhook/telegram ─► confere o segredo ─► assistente ─► sendMessage ─► Usuário
```

Segurança: o Telegram envia o cabeçalho `X-Telegram-Bot-Api-Secret-Token` (definido por você no `setWebhook`);
o servidor compara em tempo constante e recusa (401) se não bater. O número do chat só existe em memória: no banco fica o hash.
Reenvios (mesmo `update_id`) são respondidos uma vez; só conversas privadas são atendidas.

## Passo a passo
1. **Banco já criado antes?** Aplique uma vez a migração (aceita o canal `telegram`):
   `Get-Content database\migracao-telegram.sql | docker exec -i busucsal-db psql -U busucsal -d busucsal`
   (Banco novo criado por `npm run db:setup` já vem certo.)
2. **Criar o bot:** no Telegram, converse com **@BotFather** → `/newbot` → escolha um nome e um usuário terminado em `bot`. Copie o **token**.
3. **`.env`:**
   ```env
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=123456789:AAH...
   TELEGRAM_WEBHOOK_SECRET=um-segredo-inventado-com-16-ou-mais-caracteres
   ```
   (segredo: só letras, números, `_` e `-`). Reinicie o servidor.
4. **ngrok:** `ngrok http 3000` e copie o endereço `https://....ngrok-free.dev`.
5. **Registrar o webhook:** `node scripts/telegram-webhook.js https://SEU-ENDERECO.ngrok-free.dev`
   - Ver o estado: `node scripts/telegram-webhook.js --status`
   - Remover: `node scripts/telegram-webhook.js --remover`
6. **Testar:** abra o bot no Telegram, toque em **Iniciar** (`/start`) e escreva `quando o ônibus chega?`.

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| `--status` mostra `ultimo_erro` | URL do ngrok mudou/túnel fora do ar: registre de novo |
| 401 no ngrok | `TELEGRAM_WEBHOOK_SECRET` mudou depois do registro: rode o passo 5 de novo |
| 501 no ngrok | `TELEGRAM_ENABLED` não está `true` ou o servidor não foi reiniciado |
| Bot responde só no 1º `oi` e depois erro no terminal | Falta a migração do passo 1 (o banco recusa o canal `telegram`) |
| `Forbidden: bot was blocked by the user` | O usuário bloqueou o bot |
