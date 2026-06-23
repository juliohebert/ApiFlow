# ApiFlow

Cliente HTTP visual para testar, organizar e documentar APIs REST — rodando inteiramente no navegador, sem conta, sem nuvem.

---

## Funcionalidades — v1

| Área | O que faz |
|---|---|
| **Builder** | Monta requisições HTTP (GET, POST, PUT, PATCH, DELETE) com método, URL, headers, auth e body JSON |
| **Autenticação** | Bearer token, Basic Auth, API Key (header/query), campos custom (Auth-token, X-Chave-Key, X-Secret-Key) |
| **Variáveis de ambiente** | Substitui `{{variavel}}` e `{{base-url}}` (com hífen) na URL, headers e body; bloqueia envio se variável não estiver definida |
| **Importar cURL** | Cola um comando cURL e preenche automaticamente método, URL, headers, auth e body; abre a aba mais relevante |
| **Swagger / OpenAPI** | Importa especificação via URL; lista todos os endpoints com filtro por método; path params `{id}` convertidos para `{{id}}` |
| **Response** | Exibe Body (JSON com syntax highlight, busca e visão tabular), Headers e Cookies; abas acessíveis mesmo em respostas 4xx/5xx |
| **Requisições salvas** | Salva, busca, duplica e exclui requisições; agrupamento por Coleção |
| **Coleções** | Cria, renomeia (Enter ou clique fora para confirmar, Escape para cancelar) e exclui coleções; move requisições entre coleções |
| **Histórico** | Registra todas as execuções (sucesso e erro) com status, tempo e ambiente; botão Carregar restaura a requisição no Builder |
| **Ambientes** | Define conjuntos de variáveis (ex.: local, staging, produção); ambiente ativo selecionado no header |
| **Geração de código** | Gera código equivalente em cURL, JavaScript (fetch), Python (requests) e Axios |
| **Paginação** | Campo "Pages" aceita página única (`2`), lista (`1,3,5`) ou intervalo (`1-5`); resultados consolidados em array |

---

## Instalação

**Pré-requisito:** Node.js 18 ou superior.

```bash
# 1. Clone ou copie o projeto para uma pasta local
# 2. Instale as dependências
npm install
```

Não é necessário configurar nenhuma variável de ambiente para uso básico.

---

## Como rodar

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000) no navegador.

O comando inicia o servidor Express (proxy de requisições) junto com o Vite em modo desenvolvimento.

### Build de produção

```bash
npm run build
npm start
```

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Ícones | lucide-react |
| Build | Vite 6 |
| Servidor/proxy | Express 4 (Node.js) |
| Runtime dev | tsx |

O proxy Express (`server.ts`) é necessário para contornar CORS ao chamar APIs externas diretamente do navegador.

---

## Armazenamento local

Todos os dados são persistidos no **localStorage** do navegador, sem envio a servidores externos:

| Chave | Conteúdo |
|---|---|
| `savedRequests` | Requisições salvas (nome, método, URL, auth, headers, body) |
| `collections` | Coleções criadas |
| `environments` | Ambientes e variáveis |
| `requestHistory` | Histórico de execuções (máx. 100 entradas) |
| `savedApis` | APIs Swagger importadas e salvas |
| `activeEnvId` | ID do ambiente selecionado |

**Consequências práticas:**
- Limpar o cache/dados do navegador apaga tudo.
- Os dados não sincronizam entre dispositivos ou navegadores diferentes.
- Não há exportação/importação de dados nesta versão.

---

## Limitações conhecidas — v1

1. **Sem suporte a multipart/form-data** — uploads de arquivo não são suportados; somente JSON.
2. **Cookies frágeis** — o header `Set-Cookie` é separado por vírgula; valores de cookie que contenham vírgulas podem ser parseados incorretamente.
3. **Sidebar sem drawer em mobile** — a sidebar colapsada (64 px) permanece sempre visível; em telas abaixo de ~380 px o conteúdo pode ficar estreito.
4. **Path params do Swagger** — convertidos para `{{param}}` na URL, mas precisam ser preenchidos manualmente nos Ambientes ou diretamente na URL antes de enviar.
5. **Sem autenticação OAuth 2.0** — fluxos de autorização com redirect não são suportados.
6. **localStorage sem criptografia** — tokens e credenciais ficam em texto claro no armazenamento do navegador; não use em máquinas compartilhadas.
7. **Proxy local obrigatório** — o servidor Express precisa estar rodando; não funciona como SPA estática pura (CORS).

---

## Roadmap pós-v1

- [ ] Exportar/importar coleções em formato JSON
- [ ] Suporte a multipart/form-data e upload de arquivos
- [ ] Autenticação OAuth 2.0 (Authorization Code Flow)
- [ ] WebSocket e Server-Sent Events
- [ ] Variáveis de ambiente a nível de coleção
- [ ] Testes automatizados de endpoints (assertions sobre response)
- [ ] Sidebar como drawer/overlay em mobile
- [ ] Tema escuro
- [ ] Histórico com replay e diff de respostas
- [ ] Compartilhamento de coleções via arquivo ou URL
