# BusUCSAL — Previsibilidade no transporte universitário

Aplicação local do projeto BusUCSAL: o rastreador do ônibus envia a posição a cada 30 s, o servidor
guarda o histórico no PostgreSQL + PostGIS, calcula o **status do serviço** e a **previsão de chegada
ao longo da rota**, e o estudante consulta pela página ou pelo **assistente** (simulado localmente). A equipe
publica avisos e cadastra pontos num **painel com login**.

| Página | Endereço | Para quem |
|---|---|---|
| Apresentação | `http://localhost:3000/` | estudantes, professores e banca |
| Painel da equipe | `http://localhost:3000/admin` | equipe BusUCSAL (login) |
| Área técnica | `http://localhost:3000/tecnico` | desenvolvedores e demonstração técnica (login) |

> **Dados demonstrativos.** O trajeto, os 4 pontos e o horário (06:30–22:40) vêm do protótipo anterior e **não são
> oficiais**. Eles ficam marcados como demonstrativos no banco e na interface. Veja [Dados demonstrativos](#dados-demonstrativos).

---

## 1. Requisitos

- **Node.js 22 ou superior** (testado com Node 22). Não é necessário instalar `dotenv`, porque o `.env` é lido pelo próprio Node.
- **Docker Desktop** (ou Docker Engine + Compose) para o PostgreSQL 16 + PostGIS 3.
  Alternativa sem Docker: PostgreSQL 16 com a extensão PostGIS instalada (veja [Sem Docker](#sem-docker)).
- **Python 3.8+** (opcional), apenas para o simulador externo `simulator/simulador_traccar.py`, que usa só a biblioteca padrão.

## 2. Instalação e primeira execução

```bash
# 1) dependências (express, pg, bcryptjs) — gera também o package-lock.json
npm install

# 2) cria o .env com segredos aleatórios (não sobrescreve um .env existente)
npm run configurar

# 3) sobe o PostgreSQL + PostGIS (porta 5432, só neste computador)
docker compose up -d

# 4) cria as 7 tabelas e carrega os dados demonstrativos
npm run db:setup

# 5) cria o primeiro usuário da equipe (pede nome, e-mail e senha)
npm run admin:criar

# 6) inicia o servidor
npm start
```

Abra `http://localhost:3000`. Para desenvolvimento com recarga automática: `npm run dev`.

**Windows (PowerShell):** os mesmos comandos funcionam. Para o simulador, use `python` em vez de `python3`.

### Sem Docker
1. Instale PostgreSQL 16 e PostGIS 3.
2. Crie usuário e bancos: `CREATE USER busucsal PASSWORD '...'; CREATE DATABASE busucsal OWNER busucsal; CREATE DATABASE busucsal_test OWNER busucsal;`
3. Num superusuário, rode `CREATE EXTENSION postgis;` nos dois bancos (ou dê permissão ao usuário).
4. Ajuste `DATABASE_URL` e `DATABASE_URL_TEST` no `.env` e siga a partir do passo 4.

### Comandos do banco
| Comando | O que faz |
|---|---|
| `npm run db:setup` | `schema.sql` + `seed-demo.sql` |
| `npm run db:schema` | só a estrutura |
| `npm run db:seed` | só os dados demonstrativos (pode repetir; não duplica) |
| `npm run db:reset` | **apaga** as 7 tabelas e recria estrutura e dados demonstrativos |

Acrescente `-- --test` para operar no banco de testes (ex.: `npm run db:reset -- --test`).

## 3. Demonstração

Com `DEMO_MODE=true` (padrão do `.env` gerado):

- **Página de apresentação:** a faixa “Demonstração” tem 5 situações: ônibus a caminho, já passou pelo ponto,
  sem sinal do rastreador, aviso da equipe e assistente demorou a entender. Cada uma grava posições
  simuladas e roda a conversa automaticamente. **O status e as previsões são calculados pelas regras**, nunca
  definidos à mão.
- **Área técnica → Simulador GPS:** inicia e interrompe um simulador que envia posições por HTTP para
  `POST /api/posicao` com o token do dispositivo. Há dois modos:
  - **Tempo real:** um envio a cada 30 s.
  - **Demonstração acelerada:** um envio a cada 2 s, cada um avançando 30 s de trajeto. Fica identificada na tela e fora das métricas.

  Também há botões para **perda de sinal**, **veículo parado** e **recomeçar o percurso**.
- **Área técnica → Cenários de teste:** inclui também “Veículo parado” e “Interrupção da operação”.
- **Simulador externo (Python):**
  ```bash
  python3 simulator/simulador_traccar.py                    # tempo real, 30 s
  python3 simulator/simulador_traccar.py --modo parado
  python3 simulator/simulador_traccar.py --modo sem-sinal --envios-antes-da-falha 3
  python3 simulator/simulador_traccar.py --formato osmand    # parâmetros como o Traccar Client
  python3 simulator/simulador_traccar.py --acelerado
  ```
  Ele lê `DEVICE_TOKEN` e `TRACKER_DEVICE_IDS` do `.env` e busca o trajeto em `GET /api/rota`.

O status “Fora de operação” por horário depende da grade cadastrada. Com os dados demonstrativos, fora do
intervalo 06:30–22:40 (horário de Salvador) o status será “Fora de operação”, como manda a regra, e o cenário avisa isso.

Para abrir a apresentação em outro aparelho da mesma rede (ex.: celular), use `HOST=0.0.0.0` e
`INTERNAL_ALLOW_PRIVATE_NETWORK=true` no `.env`.

## 4. Testes

```bash
npm test                  # testes unitários (sem banco; ~6 s)
npm run test:integracao   # Express + PostgreSQL/PostGIS reais (precisa do docker compose up -d)
npm run test:todos
```

Os testes de integração **apagam e recriam** o banco `busucsal_test` (criado automaticamente pelo Docker Compose
na primeira subida). Se as dependências ou `DATABASE_URL_TEST` faltarem, eles são marcados como “ignorados” e o motivo aparece na saída.

| Arquivo | O que verifica |
|---|---|
| `tests/unit/previsao.test.js` | distância pela rota, ponto já ultrapassado, chegada, velocidade mínima, bloqueio com dado vencido, média de 5 min |
| `tests/unit/status.test.js` | fora de operação (horário e interrupção), sem dados (> 3 min), parado (> 5 min), em circulação, fuso de Salvador |
| `tests/unit/rota-sentido.test.js` | escolha do sentido/rota pelo progresso |
| `tests/unit/intencoes.test.js` | 7 intenções, frases de exemplo, números contextuais, **fallback acima de 2 s** |
| `tests/unit/dialogo.test.js` | fluxo da Seção 5, menu numerado, avisos na resposta, sem dados |
| `tests/unit/conversa.test.js` | sessão por usuário, hash do identificador, **expiração em 24 h**, métricas |
| `tests/unit/posicao-estado.test.js` | recebimento de posição, atualização do estado, fora de ordem, duplicada, parado, interrupção |
| `tests/unit/admin.test.js` | login com bcrypt, bloqueio por tentativas, token expirado, CRUD de avisos e pontos |
| `tests/unit/http.test.js` | token do dispositivo (válido/inválido), acesso interno, proteção das rotas, erros centralizados |
| `tests/unit/validacao.test.js` · `traccar.test.js` · `seguranca.test.js` | validação de entradas, formatos do Traccar, tokens, cookies, configuração |
| `tests/unit/indicadores.test.js` · `demonstracao.test.js` | critérios da Seção 8 (“não aferido” sem dados), avaliação do erro, cenários, simulador |
| `tests/integration/postgis.test.js` | consultas PostGIS reais, geometria derivada, restrições do schema |
| `tests/integration/api.test.js` | endpoints HTTP reais, cookies, 401/403/400/422/501/503 |

## 5. Arquitetura

```text
BusUCSAL/
├── public/                     frontend (HTML + CSS + JS modular, sem frameworks nem CDN)
│   ├── index.html · admin.html · tecnico.html · 404.html
│   └── assets/
│       ├── css/                base, components, presentation, admin, technical
│       ├── js/                 api.js, dom.js (sem innerHTML), formatacao.js, validacao.js
│       │   ├── components/     linha (diagrama), mapa-rota (SVG), situacao, conversa, login, tabela, notificacao
│       │   ├── paginas/        apresentacao.js, admin.js, tecnico.js
│       │   └── dados/          requisitos.js (mapa RF/RNF)
│       └── img/logo.svg
├── server/
│   ├── index.js                ponto de entrada (lê .env, conecta, inicia jobs)
│   ├── app.js                  aplicação Express (sem I/O próprio)
│   ├── container.js            injeção de dependências (serviços ← repositórios)
│   ├── config/                 variáveis de ambiente validadas
│   ├── domain/                 REGRAS DE NEGÓCIO puras: status, previsão, sentido, localização,
│   │                           classificador, diálogo, respostas, validação, formatos Traccar, avaliação
│   ├── repositories/           SQL parametrizado (PostgreSQL + PostGIS)
│   ├── services/               casos de uso: posição, estado, conversa, avisos, pontos, auth, métricas, simulador, cenários
│   ├── controllers/ routes/    HTTP
│   ├── middleware/             segurança (token, acesso interno, login, JSON, CSP), registro, erros
│   ├── db/                     pool, transação, tradução de erros do banco
│   ├── jobs/                   recálculo do status (30 s) e limpeza de sessões (10 min)
│   └── utils/
├── database/                   schema.sql · seed-demo.sql · drop.sql · rota-oficial.exemplo.sql · docker/
├── simulator/simulador_traccar.py
├── scripts/                    db.js · criar-admin.js · gerar-segredos.js
├── tests/                      unit/ · integration/ · helpers/ (dublês em memória)
└── docs/RELATORIO.md           o que foi implementado, corrigido e o que está pendente
```

**Fluxo de uma posição:** `POST /api/posicao` → token → normalização do formato → validação → transação
(PostGIS localiza a posição na rota e calcula o progresso → grava `posicao_veiculo` → atualiza `estado_veiculo`)
→ status recalculado e gravado.

## 6. Regras de negócio (Seção 4 do planejamento)

- **Previsão (RF03).** O PostGIS calcula o *progresso* (metros desde o início do trajeto) do ônibus e de cada ponto
  com `ST_LineLocatePoint` + `ST_LineSubstring` + `::geography`. A distância restante é a diferença entre os dois.
  Ponto com progresso menor que o do ônibus (além de 50 m) aparece como **“já passou” naquele sentido**.
  A velocidade é a **média das posições dos últimos 5 minutos**, com mínimo de 10 km/h. A resposta é aproximada
  (“cerca de N minutos”) e **sempre com o horário da última atualização**.
- **Sentido.** Cada rota tem um sentido (`ida`/`volta`). A rota de cada posição é escolhida entre as
  próximas do ponto, mantendo o sentido enquanto o progresso avança e trocando quando ele retrocede.
- **Status (RF02/RNF06).** Ordem: *Fora de operação* (aviso de interrupção vigente ou fora da grade) →
  *Sem dados* (última posição com mais de 3 min; **nenhuma previsão é calculada**) → *Parado* (velocidade
  ≤ 3 km/h há mais de 5 min com o rastreador enviando) → *Em circulação*. É calculado sempre que alguém consulta, a cada 30 s e após cada posição.
- **Assistente (RF05/RF06).** Um classificador local e determinístico devolve **apenas a intenção** (7 possíveis).
  Respostas numéricas são interpretadas pela etapa guardada na sessão. Intenção desconhecida ou classificação
  acima de 2 s mostra o **menu numerado**. Os números da resposta vêm sempre do estado calculado.
- **Sessões (LGPD).** Uma sessão por usuário, identificada por HMAC-SHA-256 do identificador. Ela guarda etapa e
  ponto e **expira 24 h após a criação**, quando é excluída.

Os valores iniciais (3 min, 5 min, 10 km/h, 2 s, 24 h etc.) podem ser calibrados no `.env`.

## 7. API

| Método e caminho | Proteção | Função |
|---|---|---|
| `POST /api/posicao` | token do dispositivo (`X-Device-Token`, `Authorization: Bearer` ou `?token=`) | recebe posição (JSON do simulador, JSON do Traccar Client ou parâmetros OsmAnd) |
| `GET /api/estado` | interno: loopback, rede privada (opcional), `X-Internal-Token` ou equipe logada | status, posição, previsões por ponto e avisos |
| `GET /api/rota` | interno | trajeto em GeoJSON |
| `POST /api/conversa/simulador` | interno | assistente (simulação local) |
| `POST /webhook/whatsapp` | — | **501**: integração com a Meta fora do escopo |
| `POST /admin/login` · `/admin/logout` · `GET /admin/sessao` | — / sessão | autenticação |
| `GET/POST /admin/avisos` · `PUT/DELETE /admin/avisos/:id` · `PATCH /admin/avisos/:id/ativo` | login | avisos |
| `GET/POST /admin/pontos` · `PUT /admin/pontos/:id` · `PATCH /admin/pontos/:id/ativo` | login | pontos de embarque |
| `GET /admin/rotas` | login | rotas e horários (somente leitura) |
| `/api/tecnico/*` | login | inspetor das tabelas, logs, endpoints, indicadores |
| `/api/demo/*` | `DEMO_MODE=true` (+ login para o simulador) | cenários e simulador |
| `GET /api/saude` | pública | servidor e banco |

Erros sempre têm o formato `{ "erro": { "codigo", "mensagem", "detalhes"? } }`. Banco fora do ar → `503`.

## 8. Segurança

- Nenhum segredo no código: tudo vem do `.env` (gerado por `npm run configurar`). O servidor **não inicia** com
  variáveis ausentes ou com os valores de exemplo.
- Senhas da equipe com **bcrypt** (`bcryptjs`, implementação em JavaScript puro, sem compilação nativa no Windows).
- Sessão em cookie **HttpOnly + SameSite=Strict**, assinado com HMAC. Use `COOKIE_SECURE=true` atrás de HTTPS.
- Rotas administrativas protegidas **no servidor**. Há limite de 5 tentativas de login a cada 15 min por IP e e-mail.
- SQL sempre parametrizado; atualizações parciais só em colunas de uma lista fixa.
- Frontend sem `innerHTML` para dados: todo texto entra como nó de texto. CSP sem `unsafe-inline`.
- Escrita exige `Content-Type: application/json`, o que impede envio por formulário de outro site (CSRF).
- Logs mascaram tokens; o texto das mensagens livres fica só em memória (para avaliação manual), nunca em disco.

## 9. Dados demonstrativos

Marcados com `demonstrativa`/`demonstrativo = TRUE`. Para substituir pelos dados reais (Seção 6 do planejamento):

1. **Pontos:** cadastre os oficiais em `/admin` → Pontos de embarque. O servidor recusa pontos a mais de 100 m do
   trajeto. Depois, desative os demonstrativos.
2. **Trajeto e horários:** copie `database/rota-oficial.exemplo.sql`, preencha e execute com `psql`. O arquivo explica
   como montar o trajeto a partir de uma viagem real gravada.

As coordenadas do protótipo anterior não batiam com as distâncias que ele exibia: ele mostrava 4,5 km, mas as
coordenadas somam cerca de 2,56 km. Agora a extensão é calculada pelo PostGIS a partir da geometria.

## 10. Critérios de sucesso (Seção 8)

A área técnica mostra os 5 indicadores **apenas com valores medidos**. Sem dados, o indicador aparece como “Ainda não aferido”.

- Respostas em até 5 s: tempo medido de cada resposta do assistente (hoje, pelo simulador local).
- Erro médio da previsão: reprocessa o histórico de `posicao_veiculo`, detecta viagens e compara a chegada real
  com a previsão que o sistema teria dado. Exige 10 viagens e marca quando todas são simuladas.
- Mensagens livres entendidas: avaliação manual (certo/errado) das mensagens recebidas.
- Previsões com dado vencido: contagem das previsões emitidas (deve ser 0) e dos bloqueios.
- Teste com estudantes: registro anônimo de participantes por turno.

As contagens ficam em `data/metricas.json` (ignorado pelo Git).

## 11. Integrações futuras (fora do escopo desta etapa)

- **WhatsApp Cloud API:** implementar `POST /webhook/whatsapp` (hoje 501) validando a assinatura da Meta e chamando
  `conversaService.processar({ canal: 'whatsapp', identificador: <número>, mensagem })`. O número é pseudonimizado no serviço.
- **Classificação por LLM:** passar outro `classificador` para `criarConversaService`, com a mesma interface
  `(texto, { etapa, pontos }) → { intencao, ponto_id }`. O limite de 2 s e o menu de reserva já envolvem qualquer classificador.
- **Traccar Client no ônibus:** configurar a URL `http://<servidor>:3000/api/posicao?token=<DEVICE_TOKEN>`, o identificador igual a `TRACKER_DEVICE_IDS`
  e a frequência de 30 s. As unidades (nós no OsmAnd, m/s no JSON) e o envio do token na URL precisam ser conferidos no teste de campo.
- **Hospedagem:** `HOST`, `COOKIE_SECURE`, `DATABASE_URL` e `INTERNAL_API_TOKEN` já permitem publicar sem mudar o código.

## 12. Solução de problemas

| Sintoma | Causa provável |
|---|---|
| “Configuração inválida: … ausentes” | falta o `.env` → `npm run configurar` |
| Página mostra “banco de dados não está respondendo” | `docker compose up -d` e aguarde o *healthcheck* |
| `function st_linelocatepoint does not exist` | PostGIS não instalado no banco usado |
| Status sempre “Fora de operação” | horário fora da grade cadastrada, ou aviso de interrupção ativo |
| Simulador recebe 401/403 | `DEVICE_TOKEN` ou `TRACKER_DEVICE_IDS` diferentes do `.env` do servidor |
| `/api/estado` retorna 403 em outro aparelho | ative `INTERNAL_ALLOW_PRIVATE_NETWORK=true` e `HOST=0.0.0.0` |
