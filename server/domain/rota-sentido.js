'use strict';

/**
 * Escolha da rota (e, portanto, do sentido) que o ônibus está percorrendo.
 *
 * Os candidatos já chegam filtrados pelo PostGIS (rotas ativas a até `toleranciaRotaM`
 * metros da posição) com o progresso calculado ao longo de cada trajeto.
 * Esta função decide qual deles usar, respeitando o sentido de deslocamento:
 *  1. prefere rotas dentro da grade de horários no momento;
 *  2. mantém a rota anterior enquanto o progresso não retrocede além da tolerância;
 *  3. se o progresso retrocede (ex.: o ônibus iniciou o sentido oposto pelas mesmas ruas),
 *     troca para outra rota candidata, quando houver;
 *  4. sem histórico, usa a rota mais próxima.
 *
 * @param {object} p
 * @param {Array<{rota_id, sentido, distancia_m, progresso_m}>} p.candidatos
 * @param {{rota_id, progresso_m}|null} p.anterior
 * @param {Set<number>} p.idsNaGrade
 * @param {{toleranciaRetrocessoM:number}} p.parametros
 * @returns {{candidato: object|null, nova_viagem: boolean}}
 */
function escolherRota({ candidatos, anterior, idsNaGrade, parametros }) {
  if (!candidatos || candidatos.length === 0) return { candidato: null, nova_viagem: false };

  const naGrade = candidatos.filter((c) => idsNaGrade && idsNaGrade.has(c.rota_id));
  const conjunto = naGrade.length > 0 ? naGrade : candidatos;
  const maisProxima = (lista) => [...lista].sort((a, b) => a.distancia_m - b.distancia_m || a.rota_id - b.rota_id)[0];

  if (anterior && anterior.rota_id !== null && anterior.rota_id !== undefined) {
    const mesma = conjunto.find((c) => c.rota_id === anterior.rota_id);
    const progressoAnterior = Number(anterior.progresso_m);
    if (mesma && (!Number.isFinite(progressoAnterior)
        || mesma.progresso_m >= progressoAnterior - parametros.toleranciaRetrocessoM)) {
      return { candidato: mesma, nova_viagem: false };
    }
    const outras = conjunto.filter((c) => c.rota_id !== anterior.rota_id);
    if (outras.length > 0) return { candidato: maisProxima(outras), nova_viagem: true };
    if (mesma) return { candidato: mesma, nova_viagem: true }; // recomeçou o mesmo trajeto
  }

  return { candidato: maisProxima(conjunto), nova_viagem: true };
}

module.exports = { escolherRota };
