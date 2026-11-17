# Mini Discord com Apache Cassandra

Chat em tempo real feito para o **Projeto 3 de Bancos de Dados NoSQL**.

- **Paradigma:** orientado a coluna (wide column store)
- **Banco:** Apache Cassandra 5.0
- **Servidor:** Node.js + Express + Socket.IO (tempo real)
- **Página:** HTML, CSS e JavaScript puro, com visual parecido com o Discord

Suas mensagens aparecem **à direita, em azul, com a etiqueta "VOCÊ"**. As dos outros ficam à esquerda. Só quem mandou a mensagem pode editar ou apagar; reagir, todo mundo pode. Os canais já começam com mensagens de boas-vindas do "Bot do Cassandra".

Cada ação no chat vira um comando no Cassandra, e a página mostra esse comando ao vivo no painel **Console do Cassandra** (lado direito). Assim o professor vê o CRUD acontecendo no banco.

As 4 operações que o enunciado pede:

| No chat | Comando no Cassandra | Operação |
|---|---|---|
| Enviar mensagem | `INSERT` | Inserção |
| Editar mensagem (✏️) | `UPDATE` do texto | Atualização |
| Botão **ALTER TABLE** no painel "Estrutura da tabela" | `ALTER TABLE ... ADD fixada boolean` | Alteração |
| Apagar mensagem (🗑️) | `DELETE` | Exclusão |

Além delas, abrir um canal faz a leitura (`SELECT`) que mostra o resultado. Existem também dois extras, que não fazem parte do que o enunciado pede: reagir (👍, um `UPDATE` na coluna `reacoes`) e mensagem temporária (⏳, `INSERT ... USING TTL 60`).

---

## 1. O que instalar (só uma vez)

Vocês só precisam do **Docker Desktop**. Ele baixa e roda o Cassandra e o chat sozinho, sem instalar mais nada.

1. Baixe o Docker Desktop no site oficial: <https://docs.docker.com/get-started/get-docker/>
2. Instale e **abra o Docker Desktop**. Espere aparecer "Engine running" (a baleia fica parada, sem animação).
3. No Windows, se o instalador pedir para ativar o **WSL 2**, aceite e reinicie o computador.

> O Cassandra usa bastante memória. Feche programas pesados antes de rodar. O ideal é o computador ter pelo menos 8 GB de RAM.

---

## 2. Como rodar o chat

1. Baixe o projeto (`git clone` do repositório, ou o ZIP do GitHub descompactado) num lugar fácil, por exemplo a Área de Trabalho. A pasta se chama `projeto3-nosql`.
2. Abra um terminal **dentro da pasta**:
   - **Windows:** abra a pasta no Explorador de Arquivos, clique na barra de endereço, digite `cmd` e aperte Enter.
   - **Mac:** clique com o botão direito na pasta e escolha "Novo Terminal na Pasta".
   - **Linux:** clique com o botão direito dentro da pasta e escolha "Abrir no terminal".
3. Digite este comando e aperte Enter:

   ```bash
   docker compose up --build
   ```

4. **Espere.** Na primeira vez ele baixa o Cassandra (uns 2 a 5 minutos, depende da internet). Depois, o Cassandra ainda leva cerca de 1 minuto para ligar.
5. Quando aparecer esta linha no terminal, está pronto:

   ```text
   🚀 Chat rodando em http://localhost:3000
   ```

6. Abra o navegador em **<http://localhost:3000>**, digite seu nome e entre.

> **Deixe esse terminal aberto** enquanto usa o chat. Se fechar, o chat para.

---

## 3. Testar o "tempo real"

- Abra o chat em **duas janelas** do navegador lado a lado (uma delas pode ser **aba anônima**), com nomes diferentes. Mande uma mensagem em uma e veja aparecer na outra na hora.
- Para outros colegas entrarem pelo celular ou notebook **na mesma rede Wi-Fi**: descubra o IP do computador que está rodando o chat (Windows: `ipconfig`; Mac/Linux: `ip a` ou Configurações de Rede) e acessem `http://SEU-IP:3000` (exemplo: `http://192.168.0.15:3000`). Se não abrir, o firewall do computador pode estar bloqueando a porta 3000.

---

## 4. Roteiro da demo na apresentação

**Antes da aula** (o Cassandra demora para ligar): rode o `docker compose up` uns 5 minutos antes e deixe a página aberta.

Na hora, com o **Console do Cassandra** visível do lado direito:

0. **Leitura:** clique no canal `#nosql`. No console aparece o `SELECT ... WHERE canal_id = 'nosql' AND bucket = ...`. Explique: a consulta usa a chave de partição, então o Cassandra vai direto na "gaveta" certa. A etiqueta no topo, `partição: ('nosql', 202611)`, mostra essa chave.
1. **Inserção:** mande uma mensagem. Aparece o `INSERT`.
2. **Atualização:** passe o mouse numa mensagem **sua**, clique em ✏️, mude o texto e aperte Enter. Aparece o `UPDATE ... SET texto = ...`, e a mensagem ganha "(editada)".
3. **Alteração:** no painel **Estrutura da tabela** (à direita), clique em **ALTER TABLE … ADD fixada boolean**. Aparece o `ALTER TABLE chat.mensagens_por_canal ADD fixada boolean`, e a coluna `fixada` surge na lista de colunas. Explique: a estrutura mudou na hora, sem reescrever nenhuma mensagem; as que já existem ficam com a coluna vazia (`null`).
4. **Exclusão:** numa mensagem sua, clique em 🗑️ e confirme. Aparece o `DELETE`.

**Para ensaiar de novo:** depois da alteração, o mesmo botão vira **ALTER TABLE … DROP fixada**. Clique nele para tirar a coluna e deixar tudo pronto para a próxima vez. **Antes da apresentação, confira que o botão está mostrando `ADD fixada boolean`.**

---

## 5. Mostrar os dados direto no banco (plano B)

Se o professor quiser ver os dados no próprio Cassandra, abra **outro terminal** (deixe o primeiro rodando) e digite:

```bash
docker exec -it cassandra-chat cqlsh
```

Vai aparecer `cqlsh>`. Agora digite (troque `202611` pelo mês atual no formato AAAAMM, por exemplo dezembro de 2026 = `202612`):

```sql
USE chat;
SELECT autor, texto, editada, reacoes, toTimestamp(mensagem_id) AS enviada_em
FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611;
```

As mensagens mandadas pelo chat aparecem ali. O arquivo `cql/demo-crud.cql` tem o **CRUD completo para colar no cqlsh**, bloco por bloco, caso o chat dê algum problema na hora. As mensagens dele caem no canal `#nosql` e aparecem no chat também. Para sair do cqlsh, digite `exit`.

Para ensaiar o plano B inteiro de uma vez:

```bash
docker exec -i cassandra-chat cqlsh < cql/demo-crud.cql
```

---

## 6. Parar, atualizar e zerar

- **Atualizar para uma versão nova do projeto:** pare o chat (`Ctrl + C`), troque os arquivos da pasta pelos novos e rode `docker compose up --build` (com o `--build`, para ele montar o servidor de novo). As mensagens que já estavam no banco continuam lá.

- **Parar o chat:** no terminal onde ele está rodando, aperte `Ctrl + C`. Depois rode `docker compose down`.
- **Apagar todas as mensagens e começar do zero:** `docker compose down -v` (o `-v` apaga os dados do Cassandra).
- **Rodar de novo depois:** `docker compose up` (sem o `--build`, a não ser que vocês mudem o código).

---

## 7. Problemas comuns

| Problema | Solução |
|---|---|
| `docker: command not found` ou "cannot connect to the Docker daemon" | O Docker Desktop não está aberto. Abra e espere "Engine running". |
| `Conflict. The container name "/cassandra-chat" is already in use` | Já existe um Cassandra antigo com esse nome (por exemplo, de um `docker run` anterior). Rode `docker rm -f cassandra-chat` e tente de novo. |
| `port is already allocated` (porta 3000 ou 9042) | Outro programa está usando a porta. Feche-o, ou rode `docker ps` para ver se já existe outro container rodando e pare com `docker stop NOME`. |
| O terminal fica muito tempo em "waiting" / "Waiting for cassandra" | É normal o Cassandra levar 1 a 2 minutos. Se passar de 5 minutos, veja se o computador tem memória livre. |
| O Cassandra fecha sozinho (`exited with code 137`) | Faltou memória. Feche programas e aumente a memória do Docker em Docker Desktop › Settings › Resources. |
| A página abre, mas fica com a bolinha vermelha ao lado do nome | O servidor caiu. Olhe o terminal para ver a mensagem de erro. |

---

## 8. O que tem em cada arquivo

```text
projeto3-nosql/
├── docker-compose.yml   → sobe o Cassandra e o chat juntos
├── Dockerfile           → como montar o servidor do chat
├── package.json         → dependências do Node.js e comandos (start, test)
├── package-lock.json    → versões exatas das dependências
├── server.js            → servidor: conecta no Cassandra e faz o CRUD
├── public/
│   ├── index.html       → estrutura da página
│   ├── style.css        → visual (estilo Discord)
│   └── app.js           → lógica da página (tempo real, botões)
├── cql/
│   ├── schema.cql       → criação do keyspace e das tabelas
│   └── demo-crud.cql    → CRUD completo para colar no cqlsh (plano B)
└── test/
    ├── unit.test.js     → testes das funções (não precisa do Cassandra)
    └── e2e.test.js      → testa o CRUD inteiro com o chat rodando
```

### Modelo de dados

```sql
CREATE TABLE chat.mensagens_por_canal (
  canal_id    text,
  bucket      int,        -- mês, ex.: 202611
  mensagem_id timeuuid,   -- id que também guarda a hora
  autor       text,
  texto       text,
  editada     boolean,
  reacoes     map<text, int>,
  PRIMARY KEY ((canal_id, bucket), mensagem_id)
) WITH CLUSTERING ORDER BY (mensagem_id DESC);
```

- **Chave de partição `(canal_id, bucket)`:** cada canal, em cada mês, vira uma partição. O mês evita que um canal muito ativo forme uma partição gigante.
- **Clustering `mensagem_id DESC`:** dentro da partição, as mensagens já ficam ordenadas da mais nova para a mais antiga.
- **Sem JOIN:** a tabela foi desenhada para a consulta principal do chat, "mensagens do canal X, mais novas primeiro".

---

## 9. (Opcional) Rodar o chat sem Docker

Só se vocês quiserem mexer no código. Precisa do **Node.js 18 ou mais novo** (<https://nodejs.org>).

```bash
docker compose up -d cassandra   # sobe só o Cassandra, em segundo plano
npm install                      # instala as dependências (só na primeira vez)
npm start                        # liga o chat em http://localhost:3000
```

---

## 10. Testes automáticos

Precisa do Node.js 18+ e de um `npm install` na pasta.

```bash
npm test            # testa as funções do servidor (não precisa do Cassandra)
npm run test:e2e    # com o "docker compose up" rodando: testa o CRUD inteiro pelo chat
```

O `test:e2e` abre dois "navegadores" ao mesmo tempo e confere: mensagem chegando em tempo real no outro, edição e exclusão só pelo autor, o `ALTER TABLE` (e o desfaz no fim, deixando a tabela como estava), 20 reações simultâneas sem perder nenhuma, exclusão de verdade (um UPDATE depois não "ressuscita" a mensagem) e mensagem com TTL.

### Por que as reações passam por uma fila

Para somar uma reação, o servidor lê a contagem, soma 1 e grava (`reacoes = reacoes + {'👍': 3}`). No Cassandra esse "ler, somar e gravar" **não é atômico**: dois cliques ao mesmo tempo liam o mesmo número e um se perdia. O servidor agora faz uma reação por vez em cada mensagem. Num sistema de verdade, com vários servidores, o certo seria uma tabela com coluna `counter` (o Cassandra soma sozinho). É um exemplo do cuidado do slide 13: contadores precisam de tabelas extras.
