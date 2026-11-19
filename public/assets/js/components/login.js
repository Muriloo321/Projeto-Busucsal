import { el, substituir } from '../dom.js';
import { api, ErroApi } from '../api.js';
import { validarLogin, mostrarErros } from '../validacao.js';

/** Sessão atual da equipe (cookie HttpOnly). Retorna o usuário ou null. */
export async function sessaoAtual() {
  try {
    const r = await api.get('/admin/sessao');
    return r.usuario;
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 401) return null;
    throw erro;
  }
}

export async function sair() {
  await api.post('/admin/logout', {});
}

/** Formulário de login compartilhado pelo painel da equipe e pela página técnica. */
export function montarLogin(alvo, { titulo, descricao, aoEntrar }) {
  const aviso = el('div', { role: 'alert' });
  const botao = el('button', { class: 'botao', type: 'submit' }, 'Entrar');
  const formulario = el('form', { class: 'painel grade-form', novalidate: true },
    el('div', { class: 'campo' },
      el('label', { for: 'login-email' }, 'E-mail'),
      el('input', { class: 'entrada', id: 'login-email', name: 'email', type: 'email', autocomplete: 'username', required: true })),
    el('div', { class: 'campo' },
      el('label', { for: 'login-senha' }, 'Senha'),
      el('input', { class: 'entrada', id: 'login-senha', name: 'senha', type: 'password', autocomplete: 'current-password', required: true })),
    aviso,
    botao);

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = { email: formulario.email.value.trim(), senha: formulario.senha.value };
    substituir(aviso);
    if (!mostrarErros(formulario, validarLogin(dados))) return;
    botao.setAttribute('aria-busy', 'true');
    botao.disabled = true;
    try {
      const r = await api.post('/admin/login', dados);
      formulario.senha.value = '';
      aoEntrar(r.usuario);
    } catch (erro) {
      substituir(aviso, el('div', { class: 'alerta alerta--erro' }, erro.message));
      formulario.senha.select();
    } finally {
      botao.removeAttribute('aria-busy');
      botao.disabled = false;
    }
  });

  substituir(alvo, el('section', { class: 'login', 'aria-labelledby': 'login-titulo' },
    el('div', { class: 'login__cabeca' }, el('h1', { id: 'login-titulo' }, titulo), el('p', {}, descricao)),
    formulario,
    el('p', { class: 'suave pequeno' }, 'Ainda não tem acesso? Um membro da equipe cria seu usuário com o comando npm run admin:criar.')));
  formulario.email.focus();
}
