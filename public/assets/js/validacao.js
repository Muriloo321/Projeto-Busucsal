/**
 * Validação no navegador (feedback imediato). O backend valida novamente com as mesmas regras.
 * Retorna um objeto { campo: mensagem } — vazio quando tudo está certo.
 */

export function validarLogin({ email, senha }) {
  const erros = {};
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) erros.email = 'Informe um e-mail válido.';
  if (!senha) erros.senha = 'Informe a senha.';
  return erros;
}

export function validarAviso({ texto, inicio, fim }) {
  const erros = {};
  const t = (texto || '').trim();
  if (t.length < 3) erros.texto = 'Escreva pelo menos 3 caracteres.';
  else if (t.length > 500) erros.texto = 'Use no máximo 500 caracteres.';
  if (!inicio) erros.inicio = 'Informe quando o aviso começa.';
  if (!fim) erros.fim = 'Informe quando o aviso termina.';
  if (inicio && fim && new Date(fim) <= new Date(inicio)) erros.fim = 'O fim precisa ser depois do início.';
  return erros;
}

export function validarPonto({ nome, latitude, longitude, ordem_na_rota: ordem }) {
  const erros = {};
  if (!nome || nome.trim().length < 2) erros.nome = 'Informe o nome do ponto.';
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (latitude === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) erros.latitude = 'Latitude entre -90 e 90 (ex.: -12.9598).';
  if (longitude === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) erros.longitude = 'Longitude entre -180 e 180 (ex.: -38.4148).';
  const o = Number(ordem);
  if (!Number.isInteger(o) || o < 1 || o > 99) erros.ordem_na_rota = 'Ordem inteira entre 1 e 99.';
  return erros;
}

/** Mostra as mensagens de erro nos campos do formulário (atributo data-campo). */
export function mostrarErros(formulario, erros) {
  for (const campo of formulario.querySelectorAll('.campo')) {
    campo.classList.remove('campo--erro');
    const msg = campo.querySelector('.campo__erro');
    if (msg) msg.remove();
  }
  for (const [nome, mensagem] of Object.entries(erros)) {
    const entrada = formulario.querySelector(`[name="${nome}"]`);
    const campo = entrada ? entrada.closest('.campo') : null;
    if (!campo) continue;
    campo.classList.add('campo--erro');
    const p = document.createElement('p');
    p.className = 'campo__erro';
    p.textContent = mensagem;
    campo.append(p);
  }
  const primeiro = Object.keys(erros)[0];
  if (primeiro) formulario.querySelector(`[name="${primeiro}"]`)?.focus();
  return Object.keys(erros).length === 0;
}

/** Converte detalhes de erro da API ([{campo, mensagem}]) para o formato de mostrarErros. */
export function errosDaApi(detalhes) {
  const r = {};
  for (const d of detalhes || []) if (d && d.campo && !r[d.campo]) r[d.campo] = d.mensagem;
  return r;
}
