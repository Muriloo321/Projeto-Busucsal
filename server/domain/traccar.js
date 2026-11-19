'use strict';

/**
 * Normalização dos formatos de posição aceitos por POST /api/posicao.
 *
 *  - busucsal_json: formato do simulador local
 *      { dispositivo_id, latitude, longitude, velocidade_kmh, registrado_em, precisao_m, fonte }
 *  - traccar_json: formato JSON do Traccar Client (versões recentes)
 *      { device_id, location: { timestamp, coords: { latitude, longitude, speed (m/s), accuracy } } }
 *  - osmand: parâmetros do protocolo OsmAnd usado pelo Traccar Client (query string ou formulário)
 *      id, lat, lon, speed (nós), timestamp (Unix s/ms ou ISO), accuracy
 *
 * A integração com um aparelho real está fora do escopo desta etapa; as conversões de unidade
 * (m/s e nós → km/h) seguem a documentação desses formatos e devem ser conferidas no teste de campo.
 */

const NOS_PARA_KMH = 1.852;
const MS_PARA_KMH = 3.6;

function presente(v) {
  return v !== undefined && v !== null && v !== '';
}

function primeiro(...valores) {
  return valores.find(presente);
}

function converter(valor, fator) {
  if (!presente(valor)) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor; // mantém o valor original para a validação acusar o erro
  return n < 0 ? null : Math.round(n * fator * 100) / 100; // velocidade negativa = desconhecida no Android
}

/** Interpreta instantes Unix (s ou ms) e ISO 8601. Retorna `null` se ausente ou Date inválida se ilegível. */
function interpretarInstante(valor) {
  if (!presente(valor)) return null;
  if (typeof valor === 'number' || /^\d+(\.\d+)?$/.test(String(valor).trim())) {
    const n = Number(valor);
    return new Date(n > 1e12 ? n : n * 1000);
  }
  const t = Date.parse(String(valor));
  return Number.isNaN(t) ? new Date(NaN) : new Date(t);
}

function normalizarPayloadPosicao({ body, query }) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const q = query && typeof query === 'object' ? query : {};

  if (b.location && typeof b.location === 'object' && b.location.coords && typeof b.location.coords === 'object') {
    const c = b.location.coords;
    return {
      formato: 'traccar_json',
      dispositivo_id: primeiro(b.device_id, b.deviceId, q.id),
      latitude: c.latitude,
      longitude: c.longitude,
      velocidade_kmh: converter(c.speed, MS_PARA_KMH),
      registrado_em: interpretarInstante(b.location.timestamp),
      precisao_m: presente(c.accuracy) ? c.accuracy : null,
      fonte: primeiro(b.fonte, q.fonte),
    };
  }

  if (presente(b.latitude) || presente(b.longitude)) {
    return {
      formato: 'busucsal_json',
      dispositivo_id: b.dispositivo_id,
      latitude: b.latitude,
      longitude: b.longitude,
      velocidade_kmh: presente(b.velocidade_kmh) ? b.velocidade_kmh : primeiro(b.velocidade, null),
      registrado_em: interpretarInstante(b.registrado_em),
      precisao_m: primeiro(b.precisao_m, null),
      fonte: b.fonte,
    };
  }

  const p = { ...q, ...b };
  if (presente(p.lat) || presente(p.lon)) {
    return {
      formato: 'osmand',
      dispositivo_id: primeiro(p.id, p.deviceid),
      latitude: p.lat,
      longitude: primeiro(p.lon, p.lng),
      velocidade_kmh: converter(p.speed, NOS_PARA_KMH),
      registrado_em: interpretarInstante(p.timestamp),
      precisao_m: primeiro(p.accuracy, null),
      fonte: p.fonte,
    };
  }

  return { formato: 'desconhecido' };
}

module.exports = { normalizarPayloadPosicao, interpretarInstante, NOS_PARA_KMH, MS_PARA_KMH };
