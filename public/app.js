// =====================================================================
// Página do Mini Discord
// Conversa com o servidor pelo Socket.IO (tempo real).
// Cada ação daqui vira um comando CQL no Cassandra, lá no servidor.
// =====================================================================

const socket = io();

const EMOJIS = ['👍', '❤️', '😂', '🔥'];
const CORES_AVATAR = ['#5865F2', '#EB459E', '#57F287', '#ED4245', '#F0B232', '#3BA55D', '#9B59B6', '#1ABC9C'];

const estado = {
  nome: '',
  canalAtual: null,
  bucketAtual: null,
  canais: [],
  mensagens: new Map(), // id -> mensagem
  timersTemporarias: new Map(), // id -> intervalo do contador
  colunaFixada: false, // a coluna "fixada" existe? (só depois do ALTER TABLE)
};

// ---------- Elementos da página ----------
const el = (id) => document.getElementById(id);
const telaEntrada = el('entrada');
const telaApp = el('app');
const listaCanais = el('lista-canais');
const areaMensagens = el('mensagens');
const formMensagem = el('form-mensagem');
const campoMensagem = el('campo-mensagem');
const campoTemporaria = el('campo-temporaria');
const listaCql = el('lista-cql');

// ---------- Funções de apoio ----------
function corDoNome(nome) {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + letra.codePointAt(0)) >>> 0;
  return CORES_AVATAR[soma % CORES_AVATAR.length];
}

function criarAvatar(nome, pequeno) {
  const avatar = document.createElement('div');
  avatar.className = pequeno ? 'avatar pequeno' : 'avatar';
  avatar.style.background = corDoNome(nome);
  avatar.textContent = (nome.trim()[0] || '?').toUpperCase();
  return avatar;
}

function formatarHora(iso) {
  const data = new Date(iso);
  const hoje = new Date();
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (data.toDateString() === hoje.toDateString()) return `Hoje às ${hora}`;
  return `${data.toLocaleDateString('pt-BR')} às ${hora}`;
}

function mostrarAviso(texto) {
  const aviso = el('aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(mostrarAviso.timer);
  mostrarAviso.timer = setTimeout(() => { aviso.hidden = true; }, 3500);
}

// Envia um evento ao servidor e devolve a resposta como Promise
function pedir(evento, dados) {
  return new Promise((resolve) => {
    socket.emit(evento, dados, (resposta) => {
      if (!resposta || !resposta.ok) mostrarAviso((resposta && resposta.erro) || 'Algo deu errado.');
      resolve(resposta || { ok: false });
    });
  });
}

function ehMinha(msg) {
  return msg.autor === estado.nome;
}

function referencia(msg) {
  return { canal: msg.canal, bucket: msg.bucket, id: msg.id };
}

// ---------- Entrada ----------
function lerNomeSalvo() {
  try { return localStorage.getItem('chat-nome') || ''; } catch (e) { return ''; }
}

function salvarNome(nome) {
  try { localStorage.setItem('chat-nome', nome); } catch (e) { /* sem problema */ }
}

el('campo-nome').value = lerNomeSalvo();

el('form-entrada').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const nome = el('campo-nome').value.trim();
  if (!nome) return;
  estado.nome = nome;
  salvarNome(nome);
  el('nome-usuario').textContent = nome;
  const avatar = el('avatar-usuario');
  avatar.textContent = nome[0].toUpperCase();
  avatar.style.background = corDoNome(nome);
  telaEntrada.hidden = true;
  telaApp.hidden = false;
  if (!estado.canalAtual && estado.canais.length) abrirCanal(estado.canais[0].id);
  campoMensagem.focus();
});

// ---------- Canais ----------
function desenharCanais() {
  listaCanais.innerHTML = '';
  for (const canal of estado.canais) {
    const item = document.createElement('li');
    item.textContent = canal.nome;
    item.title = canal.descricao || '';
    if (canal.id === estado.canalAtual) item.className = 'ativo';
    item.addEventListener('click', () => abrirCanal(canal.id));
    listaCanais.appendChild(item);
  }
}

// R - Read: abre o canal e carrega as mensagens do banco
async function abrirCanal(canalId) {
  const resposta = await pedir('entrar_canal', { canal: canalId });
  if (!resposta.ok) return;

  estado.canalAtual = canalId;
  estado.bucketAtual = resposta.bucket;
  limparMensagens();

  el('nome-canal').textContent = resposta.canal.nome;
  el('descricao-canal').textContent = resposta.canal.descricao || '';
  el('info-particao').textContent = `partição: ('${canalId}', ${resposta.bucket})`;
  campoMensagem.placeholder = `Conversar em #${resposta.canal.nome}`;
  desenharCanais();

  for (const msg of resposta.mensagens) adicionarMensagem(msg, false);
  atualizarVazio();
  rolarParaBaixo();
}

// ---------- Mensagens ----------
function limparMensagens() {
  for (const timer of estado.timersTemporarias.values()) clearInterval(timer);
  estado.timersTemporarias.clear();
  estado.mensagens.clear();
  areaMensagens.innerHTML = '';
}

function atualizarVazio() {
  const vazio = areaMensagens.querySelector('.vazio');
  if (estado.mensagens.size === 0 && !vazio) {
    const aviso = document.createElement('p');
    aviso.className = 'vazio';
    aviso.textContent = 'Nenhuma mensagem neste canal ainda. Mande a primeira!';
    areaMensagens.appendChild(aviso);
  } else if (estado.mensagens.size > 0 && vazio) {
    vazio.remove();
  }
}

function rolarParaBaixo() {
  areaMensagens.scrollTop = areaMensagens.scrollHeight;
}

function montarMensagem(msg) {
  const minha = ehMinha(msg);
  const fixada = estado.colunaFixada && msg.fixada;
  const bloco = document.createElement('div');
  bloco.className = 'mensagem' + (msg.ttl ? ' temporaria' : '') + (minha ? ' minha' : '') + (fixada ? ' fixada' : '');
  bloco.dataset.id = msg.id;
  bloco.tabIndex = 0;

  // Uma linha criada por UPDATE (upsert) no cqlsh pode não ter autor
  const nomeAutor = msg.autor || '(sem autor)';
  bloco.appendChild(criarAvatar(nomeAutor));

  const corpo = document.createElement('div');
  corpo.className = 'corpo';

  const cabecalho = document.createElement('div');
  cabecalho.className = 'cabecalho';
  const autor = document.createElement('span');
  autor.className = 'autor';
  autor.textContent = nomeAutor;
  const hora = document.createElement('span');
  hora.className = 'hora';
  hora.textContent = formatarHora(msg.criadaEm);
  cabecalho.append(autor);
  if (fixada) {
    const marca = document.createElement('span');
    marca.className = 'marca-fixada';
    marca.textContent = '📌 fixada';
    cabecalho.appendChild(marca);
  }
  if (minha) {
    const voce = document.createElement('span');
    voce.className = 'voce';
    voce.textContent = 'você';
    cabecalho.appendChild(voce);
  }
  cabecalho.appendChild(hora);
  if (msg.editada) {
    const editada = document.createElement('span');
    editada.className = 'editada';
    editada.textContent = '(editada)';
    cabecalho.appendChild(editada);
  }
  if (msg.ttl) {
    const contagem = document.createElement('span');
    contagem.className = 'contagem';
    contagem.textContent = `⏳ some em ${msg.ttl} s`;
    cabecalho.appendChild(contagem);
  }
  corpo.appendChild(cabecalho);

  const texto = document.createElement('div');
  texto.className = 'texto';
  texto.textContent = msg.texto;
  corpo.appendChild(texto);

  const reacoes = document.createElement('div');
  reacoes.className = 'reacoes';
  for (const [emoji, total] of Object.entries(msg.reacoes || {})) {
    if (!total) continue;
    const botao = document.createElement('button');
    botao.className = 'reacao';
    botao.type = 'button';
    botao.textContent = `${emoji} ${total}`;
    botao.title = 'Reagir também';
    botao.addEventListener('click', () => reagir(msg.id, emoji));
    reacoes.appendChild(botao);
  }
  corpo.appendChild(reacoes);
  bloco.appendChild(corpo);

  // Barra de ações (aparece ao passar o mouse)
  const acoes = document.createElement('div');
  acoes.className = 'acoes';
  for (const emoji of EMOJIS) {
    acoes.appendChild(criarBotaoAcao(emoji, `Reagir com ${emoji}`, () => reagir(msg.id, emoji)));
  }
  // Fixar: o botão só existe depois do ALTER TABLE criar a coluna "fixada"
  if (estado.colunaFixada) {
    const botaoFixar = criarBotaoAcao('📌', fixada ? 'Desafixar mensagem' : 'Fixar mensagem', () => fixar(msg.id));
    if (fixada) botaoFixar.classList.add('ativo');
    acoes.appendChild(botaoFixar);
  }
  // Só quem mandou pode editar ou apagar
  if (minha) {
    acoes.appendChild(criarBotaoAcao('✏️', 'Editar mensagem', () => comecarEdicao(msg.id)));
    const apagar = criarBotaoAcao('🗑️', 'Apagar mensagem', () => apagarMensagem(msg.id));
    apagar.classList.add('perigo');
    acoes.appendChild(apagar);
  }
  bloco.appendChild(acoes);

  return bloco;
}

function criarBotaoAcao(rotulo, titulo, aoClicar) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = rotulo;
  botao.title = titulo;
  botao.setAttribute('aria-label', titulo);
  botao.addEventListener('click', aoClicar);
  return botao;
}

function adicionarMensagem(msg, rolar) {
  if (msg.canal !== estado.canalAtual || estado.mensagens.has(msg.id)) return;
  estado.mensagens.set(msg.id, msg);
  areaMensagens.appendChild(montarMensagem(msg));
  iniciarContagem(msg);
  atualizarVazio();
  if (rolar) rolarParaBaixo();
}

function substituirMensagem(msg) {
  if (msg.canal !== estado.canalAtual || !estado.mensagens.has(msg.id)) return;
  estado.mensagens.set(msg.id, msg);
  const antigo = areaMensagens.querySelector(`[data-id="${msg.id}"]`);
  if (antigo) antigo.replaceWith(montarMensagem(msg));
  iniciarContagem(msg);
}

function removerMensagem(id) {
  estado.mensagens.delete(id);
  const timer = estado.timersTemporarias.get(id);
  if (timer) clearInterval(timer);
  estado.timersTemporarias.delete(id);
  const bloco = areaMensagens.querySelector(`[data-id="${id}"]`);
  if (bloco) bloco.remove();
  atualizarVazio();
}

// Mensagem temporária: o Cassandra apaga sozinho pelo TTL.
// Aqui só mostramos a contagem e tiramos da tela quando o tempo acaba.
function iniciarContagem(msg) {
  const anterior = estado.timersTemporarias.get(msg.id);
  if (anterior) clearInterval(anterior);
  estado.timersTemporarias.delete(msg.id);
  if (!msg.ttl) return;

  const fim = Date.now() + msg.ttl * 1000;
  const timer = setInterval(() => {
    const restante = Math.ceil((fim - Date.now()) / 1000);
    const bloco = areaMensagens.querySelector(`[data-id="${msg.id}"] .contagem`);
    if (restante <= 0) {
      removerMensagem(msg.id);
      return;
    }
    if (bloco) bloco.textContent = `⏳ some em ${restante} s`;
  }, 1000);
  estado.timersTemporarias.set(msg.id, timer);
}

// ---------- Ações (CRUD) ----------

// C - Create: enviar
formMensagem.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const texto = campoMensagem.value.trim();
  if (!texto || !estado.canalAtual) return;
  campoMensagem.value = '';
  const resposta = await pedir('enviar', {
    canal: estado.canalAtual,
    autor: estado.nome,
    texto,
    temporaria: campoTemporaria.checked,
  });
  if (!resposta.ok) campoMensagem.value = texto;
  campoMensagem.focus();
});

// U - Update (atualização): editar o texto
function comecarEdicao(id) {
  const msg = estado.mensagens.get(id);
  const bloco = areaMensagens.querySelector(`[data-id="${id}"]`);
  if (!msg || !bloco || bloco.querySelector('.edicao')) return;

  const texto = bloco.querySelector('.texto');
  const edicao = document.createElement('div');
  edicao.className = 'edicao';
  const campo = document.createElement('input');
  campo.type = 'text';
  campo.maxLength = 2000;
  campo.value = msg.texto;
  const dica = document.createElement('small');
  dica.textContent = 'Enter para salvar · Esc para cancelar';
  edicao.append(campo, dica);
  texto.replaceWith(edicao);
  campo.focus();
  campo.select();

  const cancelar = () => edicao.replaceWith(texto);
  campo.addEventListener('keydown', async (evento) => {
    if (evento.key === 'Escape') cancelar();
    if (evento.key === 'Enter') {
      evento.preventDefault();
      const novo = campo.value.trim();
      if (!novo || novo === msg.texto) { cancelar(); return; }
      campo.disabled = true;
      const resposta = await pedir('editar', { ...referencia(msg), autor: estado.nome, texto: novo });
      if (!resposta.ok) { campo.disabled = false; campo.focus(); }
    }
  });
}

// Extra: reagir (UPDATE na coluna map). Não é uma das 4 operações pedidas.
function reagir(id, emoji) {
  const msg = estado.mensagens.get(id);
  if (msg) pedir('reagir', { ...referencia(msg), emoji });
}

// Fixar / desafixar: UPDATE na coluna criada pelo ALTER TABLE
function fixar(id) {
  const msg = estado.mensagens.get(id);
  if (msg) pedir('fixar', { ...referencia(msg), fixada: !msg.fixada });
}

// D - Delete: apagar
function apagarMensagem(id) {
  const msg = estado.mensagens.get(id);
  if (msg && confirm('Apagar esta mensagem do banco?')) pedir('apagar', { ...referencia(msg), autor: estado.nome });
}

// ---------- Eventos que chegam do servidor (tempo real) ----------
socket.on('connect', () => {
  el('status-conexao').className = 'status conectado';
  el('status-conexao').title = 'Conectado';
  if (estado.canalAtual) abrirCanal(estado.canalAtual);
});

socket.on('disconnect', () => {
  el('status-conexao').className = 'status desconectado';
  el('status-conexao').title = 'Desconectado';
});

socket.on('canais', (canais) => {
  estado.canais = canais;
  desenharCanais();
  if (!estado.canalAtual && estado.nome && canais.length) abrirCanal(canais[0].id);
});

socket.on('nova_mensagem', (msg) => adicionarMensagem(msg, true));
socket.on('mensagem_atualizada', (msg) => substituirMensagem(msg));
socket.on('mensagem_apagada', ({ canal, id }) => {
  if (canal === estado.canalAtual) removerMensagem(id);
});

// Console do Cassandra: mostra o CQL que o servidor executou
socket.on('cql', (registro) => {
  const item = document.createElement('li');
  const rotulo = document.createElement('div');
  rotulo.className = 'rotulo';
  const op = document.createElement('span');
  op.className = `op ${registro.operacao}`;
  op.textContent = registro.operacao;
  const tempo = document.createElement('span');
  tempo.className = 'tempo';
  tempo.textContent = `${new Date(registro.hora).toLocaleTimeString('pt-BR')} · ${registro.ms} ms`;
  rotulo.append(op, tempo);
  const codigo = document.createElement('code');
  codigo.textContent = registro.cql + ';';
  item.append(rotulo, codigo);
  listaCql.prepend(item);
  while (listaCql.children.length > 60) listaCql.lastChild.remove();
});

el('limpar-console').addEventListener('click', () => { listaCql.innerHTML = ''; });

// ---------- Alteração: ALTER TABLE ----------
const NOMES_PAPEL = { partition_key: 'partição', clustering: 'clustering' };
const botaoAlter = el('botao-alter');
let estrutura = null;

// Mostra as colunas da tabela, lidas do catálogo do Cassandra
socket.on('estrutura', (dados) => {
  const novaColuna = estrutura && !estrutura.temColunaAlteracao && dados.temColunaAlteracao;
  estrutura = dados;

  // A coluna "fixada" apareceu ou sumiu: redesenha as mensagens para o botão 📌
  // aparecer ou sumir. Logo depois do ADD a coluna está vazia (null) em todas;
  // depois do DROP, os valores somem junto com a coluna.
  if (estado.colunaFixada !== dados.temColunaAlteracao) {
    estado.colunaFixada = dados.temColunaAlteracao;
    for (const msg of estado.mensagens.values()) {
      if (!estado.colunaFixada) msg.fixada = false;
      substituirMensagem(msg);
    }
  }
  el('nome-tabela').textContent = dados.tabela;

  const lista = el('lista-colunas');
  lista.innerHTML = '';
  for (const coluna of dados.colunas) {
    const item = document.createElement('li');
    if (coluna.nome === dados.colunaAlteracao.nome) item.className = novaColuna ? 'alterada nova' : 'alterada';
    const nome = document.createElement('span');
    nome.className = 'coluna-nome';
    nome.textContent = coluna.nome;
    const tipo = document.createElement('span');
    tipo.className = 'coluna-tipo';
    tipo.textContent = coluna.tipo + (NOMES_PAPEL[coluna.papel] ? ` · ${NOMES_PAPEL[coluna.papel]}` : '');
    item.append(nome, tipo);
    lista.appendChild(item);
  }

  const { nome, tipo } = dados.colunaAlteracao;
  botaoAlter.disabled = false;
  botaoAlter.textContent = dados.temColunaAlteracao
    ? `ALTER TABLE … DROP ${nome}`
    : `ALTER TABLE … ADD ${nome} ${tipo}`;
  botaoAlter.title = dados.temColunaAlteracao
    ? 'Remove a coluna (para ensaiar a demo de novo)'
    : 'Adiciona uma coluna nova na tabela de mensagens';
  botaoAlter.classList.toggle('remover', dados.temColunaAlteracao);
});

botaoAlter.addEventListener('click', async () => {
  if (!estrutura) return;
  botaoAlter.disabled = true;
  await pedir('alterar_tabela', { acao: estrutura.temColunaAlteracao ? 'remover' : 'adicionar' });
  botaoAlter.disabled = false;
});
