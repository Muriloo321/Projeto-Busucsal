# Relatório da refatoração — BusUCSAL 2.0

## 1. O que foi implementado

- **Estrutura modular.** O HTML monolítico virou três páginas separadas: apresentação, painel da equipe e área técnica.
  Cada uma tem CSS e JavaScript próprios em módulos, sem frameworks e sem nenhum recurso de CDN.
- **Backend Node.js + Express executável.** O backend tem camadas separadas: configuração, domínio, repositórios,
  serviços, controladores, rotas e middlewares. O tratamento de erros é centralizado.
- **PostgreSQL + PostGIS.**
  - As 7 tabelas do planejamento têm tipos geométricos (SRID 4326).
  - A geometria dos pontos e das posições é derivada da latitude e da longitude por coluna gerada.
  - Há chaves estrangeiras, CHECKs, índice único parcial (ordem por sentido) e índices GiST.
  - Os dados demonstrativos ficam em arquivo separado, e há um modelo para carregar o trajeto oficial.
- **`POST /api/posicao`.**
  - Exige token e aceita três formatos (simulador, JSON do Traccar Client e OsmAnd).
  - Valida coordenadas, velocidade, instante, dispositivo e fonte.
  - Grava o histórico e o estado na mesma transação.
  - Ignora reenvios duplicados e não deixa uma posição antiga sobrescrever o estado.
- **`GET /api/estado`.** Devolve status, posição, rota/sentido, progresso, previsão por ponto (com distância pela
  rota e em linha reta), localização em texto e avisos vigentes. A proteção é “interna”.
- **Regras da Seção 4 no backend.**
  - Previsão ao longo da rota pelo PostGIS, considerando o sentido e o ponto já ultrapassado.
  - Velocidade média dos últimos 5 min, com velocidade mínima.
  - Bloqueio da previsão quando a posição está vencida.
  - Status automático, com o aviso de interrupção considerado no cálculo.
- **Assistente.**
  - Classificador local determinístico com as 7 intenções e resposta numérica contextual.
  - Menu numerado quando a intenção é desconhecida ou a classificação passa de 2 s.
  - Sessão por usuário, com identificador em HMAC e expiração/exclusão em 24 h.
- **Painel da equipe.**
  - Login com bcrypt, cookie HttpOnly assinado e limite de tentativas.
  - Avisos: criar, editar, ativar/desativar, excluir e filtrar por situação.
  - Pontos: consultar, cadastrar e editar (com conferência da distância até o trajeto no PostGIS) e ativar/desativar.
  - Rotas e horários: somente consulta.
- **Área técnica.**
  - Status da API e do banco, e os parâmetros das regras.
  - Estado do veículo, com mapa e comparação entre rota e linha reta.
  - Simulador GPS controlável (30 s ou acelerado identificado), com perda de sinal e veículo parado.
  - 8 cenários de teste e inspetor das 7 tabelas.
  - Logs reais das requisições com desempenho por rota (média, p95, máximo).
  - Catálogo de endpoints, indicadores da Seção 8 e mapa de requisitos.
- **Simulador Python.** Usa só a biblioteca padrão, segue o trajeto do backend e tem modos normal, parado, sem sinal,
  OsmAnd e acelerado.
- **Indicadores da Seção 8.** Só mostram valores medidos e aparecem como “Ainda não aferido” enquanto não há dados.
  O erro da previsão é medido reprocessando as viagens gravadas.

## 2. O que foi corrigido em relação ao protótipo

| Protótipo | Agora |
|---|---|
| Backend exibido como texto num modal | Servidor Express real, com banco real |
| Status escolhido por botões | Status calculado pelas regras; os botões viraram cenários que gravam dados |
| Distância = `km_rota` fixo de cada ponto (1,8 / 3,2 / 4,5 km) | Progresso calculado pelo PostGIS a partir da geometria. As coordenadas do protótipo somam ≈ 2,56 km, não 4,5 km |
| Mapa com curvas desenhadas à mão e posição interpolada entre âncoras fixas | Desenho a partir das coordenadas cadastradas, com o selo “coordenadas demonstrativas” |
| Uma única `sessao_conversa` global para todos | Uma sessão por usuário, com hash e expiração de 24 h |
| Tabela `aviso` sem `interrompe_operacao`, que a interface usava | Campo no schema e usado no cálculo do status |
| “Ponto 2” sempre usado quando o ponto era desconhecido | Pergunta o ponto; não supõe nenhum |
| Login que só escondia elementos da tela | Middleware no servidor e cookie assinado |
| Senha e token no código (`ucsal2026transporte`, `ucsal-secret-token-2026`) | Somente no `.env`; o servidor recusa valores de exemplo |
| `innerHTML` com textos de avisos e mensagens (injeção de HTML) | Construção de elementos por nós de texto; CSP sem `unsafe-inline` |
| Métricas fixas (“100%”, “0”) | Valores medidos ou “Ainda não aferido” |
| Hash LGPD de exemplo fixo (`9f86d0…`) | HMAC-SHA-256 com segredo do servidor |
| Selo de “Conta oficial Meta” e aparência de WhatsApp | O simulador é apresentado como simulação local |
| Simulador Python dependente de `requests` e com token no código | Biblioteca padrão; token do `.env` |

## 3. Verificação realizada neste ambiente

O ambiente de desenvolvimento **não tinha acesso à internet para instalar pacotes**, **não tinha PostGIS** e
**não tinha o Docker em execução**. Diante disso:

| Verificação | Resultado |
|---|---|
| Testes unitários (`npm test`) | **102 aprovados**; 1 ignorado, porque depende do `bcryptjs` instalado |
| Testes de integração (`npm run test:integracao`) | **não executados** (sem `express`, `pg`, `bcryptjs` e PostGIS); são ignorados com o motivo explícito |
| `schema.sql`, `seed-demo.sql`, `drop.sql` | executados no **PostgreSQL 16 real**, com funções provisórias no lugar do PostGIS: estrutura, restrições, idempotência do seed e reset |
| Todas as 54 consultas dos repositórios | preparadas e executadas no PostgreSQL 16 real com as mesmas funções provisórias: **0 erros**. Isso confere a sintaxe e os nomes de colunas, mas **não** os resultados geométricos do PostGIS |
| Páginas e fluxos no navegador (Chromium) | as três páginas, todos os cenários, o assistente, o login, o CRUD de avisos e pontos, o simulador e o inspetor funcionaram com o código real de rotas, controladores e serviços. Isso foi feito com um substituto mínimo do Express e repositórios em memória, ambos só para a verificação e fora do ZIP. Sem erros de JavaScript nem de CSP |
| Layout responsivo | revisado em 1366 px, 1440 px e 390 px (celular) |
| `server/index.js` | inicialização, recusa de configuração ausente ou de exemplo, respostas 503 com o banco fora do ar e encerramento por SIGTERM |
| Simulador Python | formatos JSON e OsmAnd, modo sem sinal e token inválido testados contra o servidor |

## 4. Pendências

- **Rodar `npm install` e `npm run test:integracao`** numa máquina com Docker. Essa execução gera o
  `package-lock.json` (que não pôde ser gerado aqui sem acesso ao npm) e valida as consultas geométricas no PostGIS real.
- **Dados oficiais.** Pontos de embarque (Seção 6), trajeto e grade de horários reais continuam a ser levantados.
- **Calibração.** Os valores iniciais (velocidade mínima de 10 km/h, limiar de 3 km/h, raio de 50 m e tolerâncias)
  precisam ser calibrados com as viagens reais (Semana 10).
- **Fora do escopo, com a arquitetura preparada:** WhatsApp Cloud API (webhook responde 501), classificação por LLM,
  Traccar Client instalado no ônibus e hospedagem.
- **Requisitos sem descrição nos documentos:** RF01, RF07 e RNF01 aparecem no protótipo, mas não foram mapeados.
- **Métricas.** As contagens ficam num arquivo JSON local, e o texto das mensagens livres só em memória (reinicia com o servidor).
  Para o teste de campo com estudantes, avalie se é preciso guardá-las por mais tempo, considerando a LGPD.
