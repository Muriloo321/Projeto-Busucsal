'use strict';

/**
 * Dublês de teste em memória com a MESMA interface dos repositórios PostgreSQL.
 * Permitem testar serviços e regras sem banco. A geometria aqui é uma aproximação plana
 * (equirretangular) apenas para os testes; em produção a distância ao longo da rota é do PostGIS.
 */

const RAIO = 6371000;
const rad = (g) => (g * Math.PI) / 180;

function haversine([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return RAIO * 2 * Math.asin(Math.sqrt(a));
}

function geometria(coords) {
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const kx = Math.cos(rad(lat0));
  const xy = ([lon, lat]) => [rad(lon) * kx * RAIO, rad(lat) * RAIO];
  const pts = coords.map(xy);
  const segs = [];
  let acumulado = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const comp = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, comp, inicio: acumulado, i });
    acumulado += comp;
  }
  return {
    extensao: acumulado,
    localizar(lonlat) {
      const [px, py] = xy(lonlat);
      let melhor = null;
      for (const s of segs) {
        const t = s.comp > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * (s.bx - s.ax) + (py - s.ay) * (s.by - s.ay)) / (s.comp ** 2))) : 0;
        const qx = s.ax + t * (s.bx - s.ax);
        const qy = s.ay + t * (s.by - s.ay);
        const d = Math.hypot(px - qx, py - qy);
        if (!melhor || d < melhor.distancia - 1e-9) melhor = { distancia: d, progresso: s.inicio + t * s.comp };
      }
      return melhor;
    },
    interpolar(metros) {
      const m = Math.max(0, Math.min(acumulado, metros));
      for (const s of segs) {
        if (m <= s.inicio + s.comp) {
          const t = s.comp > 0 ? (m - s.inicio) / s.comp : 0;
          const a = coords[s.i - 1];
          const b = coords[s.i];
          return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        }
      }
      return coords[coords.length - 1];
    },
  };
}

const copia = (o) => (o ? { ...o } : null);

function criarReposMemoria({ relogio = { agora: () => new Date() }, rotas = [], pontos = [] } = {}) {
  const dados = {
    rotas: rotas.map((r, i) => ({ id: r.id ?? i + 1, ativa: true, demonstrativa: false, turno: 'M/N', ...r })),
    pontos: [],
    avisos: [],
    posicoes: [],
    estados: new Map(),
    sessoes: new Map(),
    admins: [],
  };
  const seq = { ponto: 0, aviso: 0, posicao: 0, admin: 0 };
  const geo = new Map();
  const geoDe = (rota) => {
    if (!geo.has(rota.id)) geo.set(rota.id, geometria(rota.coordenadas));
    return geo.get(rota.id);
  };
  const rotaPublica = (r) => ({
    id: r.id, nome: r.nome, sentido: r.sentido, horario_inicio: r.horario_inicio, horario_fim: r.horario_fim,
    turno: r.turno, ativa: r.ativa, demonstrativa: r.demonstrativa, extensao_m: geoDe(r).extensao,
  });
  const conflito = () => Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

  const ponto = {
    async listar({ incluirInativos = false } = {}) {
      return dados.pontos.filter((p) => incluirInativos || p.ativo).sort((a, b) => a.sentido.localeCompare(b.sentido) || a.ordem_na_rota - b.ordem_na_rota).map(copia);
    },
    async obter(id) { return copia(dados.pontos.find((p) => p.id === id)); },
    async criar(d) {
      if (d.ativo !== false && dados.pontos.some((p) => p.ativo && p.sentido === d.sentido && p.ordem_na_rota === d.ordem_na_rota)) throw conflito();
      const agora = relogio.agora();
      const novo = { demonstrativo: false, referencia: null, turnos: 'M/N', ativo: true, ...d, id: ++seq.ponto, criado_em: agora, atualizado_em: agora };
      dados.pontos.push(novo);
      return copia(novo);
    },
    async atualizar(id, campos) {
      const p = dados.pontos.find((x) => x.id === id);
      if (!p) return null;
      const final = { ...p, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) };
      if (final.ativo && dados.pontos.some((x) => x.id !== id && x.ativo && x.sentido === final.sentido && x.ordem_na_rota === final.ordem_na_rota)) throw conflito();
      Object.assign(p, final, { demonstrativo: false, atualizado_em: relogio.agora() });
      return copia(p);
    },
  };
  for (const p of pontos) {
    dados.pontos.push({ referencia: null, turnos: 'M/N', ativo: true, demonstrativo: false, criado_em: new Date(0), atualizado_em: new Date(0), ...p, id: p.id ?? ++seq.ponto });
    seq.ponto = Math.max(seq.ponto, dados.pontos[dados.pontos.length - 1].id);
  }

  const rota = {
    async listarAtivas() { return dados.rotas.filter((r) => r.ativa).map(rotaPublica); },
    async listarTodas() { return dados.rotas.map(rotaPublica); },
    async listarComTrajeto() {
      return dados.rotas.filter((r) => r.ativa).map((r) => ({ ...rotaPublica(r), trajeto_geojson: { type: 'LineString', coordinates: r.coordenadas } }));
    },
    async candidatosParaPosicao({ longitude, latitude, toleranciaM }) {
      return dados.rotas.filter((r) => r.ativa).map((r) => {
        const g = geoDe(r);
        const loc = g.localizar([longitude, latitude]);
        return { rota_id: r.id, sentido: r.sentido, distancia_m: loc.distancia, progresso_m: loc.progresso, extensao_m: g.extensao };
      }).filter((c) => c.distancia_m <= toleranciaM).sort((a, b) => a.distancia_m - b.distancia_m || a.rota_id - b.rota_id);
    },
    async pontosComProgresso(rotaId, onibus = null) {
      const r = dados.rotas.find((x) => x.id === rotaId);
      if (!r) return [];
      const g = geoDe(r);
      return dados.pontos.filter((p) => p.ativo && p.sentido === r.sentido).sort((a, b) => a.ordem_na_rota - b.ordem_na_rota).map((p) => {
        const loc = g.localizar([p.longitude, p.latitude]);
        return {
          id: p.id,
          progresso_m: loc.progresso,
          distancia_trajeto_m: loc.distancia,
          distancia_reta_m: onibus ? haversine([p.longitude, p.latitude], [onibus.longitude, onibus.latitude]) : null,
        };
      });
    },
    async coordenadaNaDistancia(rotaId, metros) {
      const r = dados.rotas.find((x) => x.id === rotaId);
      if (!r) return null;
      const [longitude, latitude] = geoDe(r).interpolar(metros);
      return { latitude, longitude, extensao_m: geoDe(r).extensao };
    },
    async distanciaAteRotas({ longitude, latitude, sentido }) {
      const candidatas = dados.rotas.filter((r) => r.ativa && r.sentido === sentido);
      if (!candidatas.length) return { distancia_m: null, rotas: 0 };
      return { distancia_m: Math.min(...candidatas.map((r) => geoDe(r).localizar([longitude, latitude]).distancia)), rotas: candidatas.length };
    },
  };

  const comAutor = (a) => {
    if (!a) return null;
    const autor = dados.admins.find((u) => u.id === a.criado_por);
    return { ...a, criado_por_nome: autor ? autor.nome : null };
  };
  const aviso = {
    async listar() { return [...dados.avisos].sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.inicio - a.inicio).map(comAutor); },
    async listarVigentes(agora) {
      return dados.avisos.filter((a) => a.ativo && a.inicio <= agora && a.fim > agora).sort((a, b) => Number(b.interrompe_operacao) - Number(a.interrompe_operacao)).map(comAutor);
    },
    async obter(id) { return comAutor(dados.avisos.find((a) => a.id === id)); },
    async criar(d) {
      const agora = relogio.agora();
      const novo = { ...d, demonstrativo: Boolean(d.demonstrativo), criado_por: d.criado_por || null, id: ++seq.aviso, criado_em: agora, atualizado_em: agora };
      dados.avisos.push(novo);
      return comAutor(novo);
    },
    async atualizar(id, campos) {
      const a = dados.avisos.find((x) => x.id === id);
      if (!a) return null;
      for (const [k, v] of Object.entries(campos)) if (v !== undefined && ['texto', 'inicio', 'fim', 'ativo', 'interrompe_operacao'].includes(k)) a[k] = v;
      a.atualizado_em = relogio.agora();
      return comAutor(a);
    },
    async excluir(id) {
      const antes = dados.avisos.length;
      dados.avisos = dados.avisos.filter((a) => a.id !== id);
      return dados.avisos.length < antes;
    },
    async excluirDemonstrativos() {
      const antes = dados.avisos.length;
      dados.avisos = dados.avisos.filter((a) => !a.demonstrativo);
      return antes - dados.avisos.length;
    },
  };

  const posicao = {
    async inserir(p) {
      const t = new Date(p.registrado_em).getTime();
      if (dados.posicoes.some((x) => x.dispositivo_id === p.dispositivo_id && x.registrado_em.getTime() === t)) return null;
      const nova = { ...p, registrado_em: new Date(t), recebido_em: relogio.agora(), id: ++seq.posicao };
      dados.posicoes.push(nova);
      return nova.id;
    },
    async recentes(disp, desde) {
      return dados.posicoes.filter((p) => p.dispositivo_id === disp && p.registrado_em > desde).sort((a, b) => a.registrado_em - b.registrado_em)
        .map((p) => ({ registrado_em: p.registrado_em, velocidade_kmh: p.velocidade_kmh }));
    },
    async historico(disp, limite = 30) {
      return dados.posicoes.filter((p) => p.dispositivo_id === disp).sort((a, b) => b.registrado_em - a.registrado_em).slice(0, limite).map(copia);
    },
    async paraAvaliacao(disp, fontes) {
      return dados.posicoes.filter((p) => p.dispositivo_id === disp && fontes.includes(p.fonte)).sort((a, b) => a.registrado_em - b.registrado_em)
        .map((p) => ({ registrado_em: p.registrado_em, velocidade_kmh: p.velocidade_kmh, fonte: p.fonte, rota_id: p.rota_id, progresso_m: p.progresso_m }));
    },
    async excluirNaoReais(disp) {
      const antes = dados.posicoes.length;
      dados.posicoes = dados.posicoes.filter((p) => !(p.dispositivo_id === disp && p.fonte !== 'rastreador'));
      for (const e of dados.estados.values()) if (!dados.posicoes.some((p) => p.id === e.ultima_posicao_id)) e.ultima_posicao_id = null;
      return antes - dados.posicoes.length;
    },
    async ultimaReal(disp) {
      return copia(dados.posicoes.filter((p) => p.dispositivo_id === disp && p.fonte === 'rastreador').sort((a, b) => b.registrado_em - a.registrado_em)[0]);
    },
  };

  const estadoVazio = (disp) => ({
    dispositivo_id: disp, ultima_posicao_id: null, latitude: null, longitude: null, ultima_atualizacao: null, velocidade_kmh: null,
    rota_id: null, progresso_m: null, distancia_rota_m: null, parado_desde: null, status: 'sem_dados', status_calculado_em: null,
    proximo_ponto_id: null, atualizado_em: relogio.agora(),
  });
  const estado = {
    async obter(disp) { return copia(dados.estados.get(disp)); },
    async travar(cliente, disp) {
      if (!dados.estados.has(disp)) dados.estados.set(disp, estadoVazio(disp));
      return copia(dados.estados.get(disp));
    },
    async atualizarPosicao(cliente, disp, d) {
      const e = dados.estados.get(disp) || estadoVazio(disp);
      Object.assign(e, {
        ultima_posicao_id: d.ultima_posicao_id, latitude: d.latitude, longitude: d.longitude, ultima_atualizacao: new Date(d.ultima_atualizacao),
        velocidade_kmh: d.velocidade_kmh, rota_id: d.rota_id, progresso_m: d.progresso_m, distancia_rota_m: d.distancia_rota_m,
        parado_desde: d.parado_desde ? new Date(d.parado_desde) : null, atualizado_em: relogio.agora(),
      });
      dados.estados.set(disp, e);
    },
    async salvarStatus(disp, { status, calculadoEm, proximoPontoId }) {
      const e = dados.estados.get(disp);
      if (e) Object.assign(e, { status, status_calculado_em: calculadoEm, proximo_ponto_id: proximoPontoId });
    },
    async redefinir(cliente, disp, pos) {
      if (!pos) { dados.estados.delete(disp); return; }
      dados.estados.set(disp, estadoVazio(disp));
      await estado.atualizarPosicao(cliente, disp, {
        ultima_posicao_id: pos.id, latitude: pos.latitude, longitude: pos.longitude, ultima_atualizacao: pos.registrado_em,
        velocidade_kmh: pos.velocidade_kmh, rota_id: pos.rota_id, progresso_m: pos.progresso_m, distancia_rota_m: pos.distancia_rota_m, parado_desde: null,
      });
    },
  };

  const sessao = {
    async obterValida(hash, agora) {
      const s = dados.sessoes.get(hash);
      return s && s.expira_em > agora ? copia(s) : null;
    },
    async salvar({ usuarioHash, canal, etapa, pontoId, agora, validadeH }) {
      const existente = dados.sessoes.get(usuarioHash);
      const s = existente
        ? { ...existente, etapa_do_dialogo: etapa, ponto_id: pontoId, atualizado_em: agora }
        : { usuario_hash: usuarioHash, canal, etapa_do_dialogo: etapa, ponto_id: pontoId, criado_em: agora, atualizado_em: agora, expira_em: new Date(agora.getTime() + validadeH * 3600 * 1000) };
      dados.sessoes.set(usuarioHash, s);
      return copia(s);
    },
    async excluir(hash) { return dados.sessoes.delete(hash); },
    async excluirExpiradas(agora) {
      let n = 0;
      for (const [k, s] of dados.sessoes) if (s.expira_em <= agora) { dados.sessoes.delete(k); n += 1; }
      return n;
    },
  };

  const admin = {
    async obterPorEmail(email) { return copia(dados.admins.find((u) => u.email === email)); },
    async obterPorId(id) {
      const u = dados.admins.find((x) => x.id === id);
      return u ? { id: u.id, nome: u.nome, email: u.email, ativo: u.ativo } : null;
    },
    async registrarLogin(id, agora) { const u = dados.admins.find((x) => x.id === id); if (u) u.ultimo_login_em = agora; },
    async criarOuAtualizar({ nome, email, senhaHash }) {
      let u = dados.admins.find((x) => x.email === email);
      if (u) Object.assign(u, { nome, senha_hash: senhaHash, ativo: true });
      else { u = { id: ++seq.admin, nome, email, senha_hash: senhaHash, ativo: true, criado_em: relogio.agora() }; dados.admins.push(u); }
      return { id: u.id, nome: u.nome, email: u.email, ativo: u.ativo };
    },
  };

  const tabelas = {
    posicao_veiculo: () => dados.posicoes,
    estado_veiculo: () => [...dados.estados.values()],
    ponto_embarque: () => dados.pontos,
    rota: () => dados.rotas.map(rotaPublica),
    aviso: () => dados.avisos,
    sessao_conversa: () => [...dados.sessoes.values()].map((s) => ({ ...s, usuario_hash: `${s.usuario_hash.slice(0, 12)}…` })),
    usuario_admin: () => dados.admins.map(({ senha_hash: h, ...u }) => ({ ...u, senha_hash: `${h.slice(0, 7)}…` })),
  };
  const inspetor = {
    tabelasConhecidas: () => Object.keys(tabelas),
    async resumo() { return Object.entries(tabelas).map(([nome, f]) => ({ nome, descricao: `(memória) ${nome}`, registros: f().length })); },
    async linhas(nome, limite) {
      if (!tabelas[nome]) return null;
      const linhas = tabelas[nome]().slice(0, limite).map(copia);
      return { nome, descricao: `(memória) ${nome}`, colunas: linhas[0] ? Object.keys(linhas[0]) : [], linhas };
    },
    async infoBanco() { return { postgres: 'memória (teste)', postgis: 'não usado', banco: 'memoria' }; },
  };

  return {
    rota, ponto, aviso, posicao, estado, sessao, admin, inspetor,
    transacao: async (fn) => fn(null),
    ping: async () => {},
    _dados: dados,
  };
}

module.exports = { criarReposMemoria, haversine, geometria };
