# Contexto da aplicacao - ApiFlow

Documento preparado em 18/06/2026 para contextualizar o estado atual da aplicacao, sua arquitetura, funcionalidades, limitacoes e recomendacoes tecnicas.

## 1. Resumo executivo

O projeto e uma aplicacao web chamada **ApiFlow**, voltada para exploracao, teste e organizacao de requisicoes HTTP. Na pratica, ela funciona como uma ferramenta interna semelhante a um Postman simplificado, com foco em:

- importar especificacoes Swagger/OpenAPI;
- listar e selecionar endpoints disponiveis;
- montar e executar requisicoes HTTP;
- configurar autenticacao e headers;
- testar paginacao simples;
- visualizar respostas em JSON ou tabela;
- salvar APIs e requisicoes no navegador;
- gerar exemplos de codigo em cURL, JavaScript, Axios e Python.

O produto esta em um estagio funcional de prototipo/MVP tecnico. A base compila e o build de producao foi validado, mas ainda ha pontos importantes de seguranca, persistencia, observabilidade e maturidade arquitetural antes de uso amplo em ambiente corporativo.

## 2. Objetivo do produto

A aplicacao busca reduzir o tempo de descoberta e validacao de APIs, principalmente quando existe uma especificacao Swagger/OpenAPI disponivel. O usuario pode informar uma URL de documentacao, importar os endpoints, escolher uma rota e executar chamadas sem precisar montar tudo manualmente.

O caso de uso mais evidente e apoiar times tecnicos e operacionais que precisam testar integracoes, validar payloads, consultar endpoints paginados e compartilhar modelos de requisicao.

## 3. Stack tecnica

- **Frontend:** React 19 com TypeScript.
- **Build e dev server:** Vite 6.
- **Estilizacao:** Tailwind CSS 4 via plugin do Vite.
- **Backend local:** Express 4 executado via `tsx`.
- **Runtime esperado:** Node.js.
- **Iconografia:** `lucide-react`.
- **Persistencia atual:** `localStorage` do navegador.
- **Scripts principais:**
  - `npm run dev`: inicia o servidor Express com Vite em modo middleware.
  - `npm run build`: gera build de producao no diretorio `dist`.
  - `npm run start`: inicia `server.ts`.
  - `npm run lint`: executa `tsc --noEmit`.

Observacao: o projeto possui dependencia `@google/genai` e variavel `GEMINI_API_KEY` no `.env.example`, mas o codigo atual nao utiliza chamadas Gemini. Isso parece ser heranca do template do Google AI Studio.

## 4. Arquitetura atual

A aplicacao esta concentrada em poucos arquivos:

- `src/App.tsx`: concentra praticamente toda a experiencia de produto, estado de tela, formularios, importacao Swagger, execucao de requisicoes, salvamento local e geracao de codigo.
- `src/main.tsx`: ponto de entrada React.
- `src/index.css`: importa Tailwind.
- `server.ts`: servidor Express que expoe APIs auxiliares e integra o Vite em desenvolvimento.
- `vite.config.ts`: configuracao de React, Tailwind, alias e injecao de `GEMINI_API_KEY` no build.

O backend nao possui banco de dados nem autenticacao propria. Ele existe principalmente para evitar limitacoes de CORS no navegador e permitir que a aplicacao execute chamadas HTTP para APIs externas por meio de um proxy controlado.

### Fluxo de execucao

1. O usuario acessa a interface React.
2. O usuario pode importar um Swagger/OpenAPI ou montar uma requisicao manualmente.
3. Quando uma requisicao e enviada, o frontend chama `POST /api/proxy`.
4. O Express valida protocolo e metodo HTTP, executa `fetch` contra a URL informada e devolve status e dados para o frontend.
5. O frontend exibe a resposta e, quando aplicavel, permite filtragem e visualizacao em tabela.

### Endpoints internos

#### `POST /api/proxy`

Recebe `url`, `method`, `headers` e `body`. Executa a chamada HTTP no servidor e retorna:

- `status`: status HTTP da API chamada;
- `data`: JSON parseado quando possivel, ou texto bruto encapsulado em `raw`.

Ha validacao basica de protocolo (`http` e `https`) e metodo (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).

#### `POST /api/fetch-swagger`

Recebe uma URL e tenta obter uma especificacao OpenAPI/Swagger. A rotina:

- testa a URL informada diretamente;
- se nao encontrar JSON, tenta caminhos comuns como `/v2/api-docs`, `/v3/api-docs`, `/swagger.json`, `/api-docs`, `/openapi.json` e `/swagger/v1/swagger.json`;
- retorna a especificacao encontrada e a URL efetiva.

## 5. Funcionalidades implementadas

### Importacao de Swagger/OpenAPI

O usuario informa uma URL de Swagger/OpenAPI. A aplicacao tenta localizar o JSON da especificacao, extrai endpoints de `paths` e identifica metodos como `GET`, `POST`, `PUT`, `PATCH` e `DELETE`.

Tambem calcula uma `baseUrl` a partir de `servers` no OpenAPI 3 ou de `host`, `schemes` e `basePath` no Swagger 2.

### Catalogo de endpoints

A tela de Swagger lista endpoints importados e permite filtrar por metodo HTTP. Ao selecionar um endpoint, a aplicacao preenche automaticamente:

- metodo;
- URL;
- nome da requisicao;
- exemplo de body, quando ha `requestBody` com schema JSON.

### Construtor de requisicoes

O usuario pode configurar:

- metodo HTTP;
- URL;
- nome da requisicao;
- paginas a executar;
- body JSON;
- autenticacao;
- headers customizados.

A aplicacao valida URL, paginas e JSON antes de enviar.

### Autenticacao e headers

Ha suporte no frontend para:

- nenhuma autenticacao;
- Bearer Token;
- Basic Auth;
- API Key via header ou query string;
- autenticacao customizada com `Auth-token`, `X-Chave-Key` e `X-Secret-Key`;
- headers customizados adicionais.

### Paginacao simples

O campo de paginas aceita formatos como:

- `1`;
- `1,2,3`;
- `1-3`.

Para cada pagina, a aplicacao substitui `page=<numero>` na URL e executa chamadas sequenciais com delay de 500ms entre elas.

### Visualizacao e filtro de resposta

As respostas sao exibidas em JSON. Quando a resposta tem estrutura compativel, a aplicacao agrega dados em array e permite:

- filtrar por campo e texto;
- alternar visualizacao entre JSON e tabela.

A tabela atual parece otimizada para dados com campos como `id`, `nome`, `tipoProcedimento` e `dataCriacao`, indicando um caso de uso especifico ja contemplado no prototipo.

### Salvamento local

A aplicacao salva no `localStorage`:

- APIs importadas;
- requisicoes configuradas.

Isso permite reuso no mesmo navegador, mas nao cria compartilhamento entre usuarios, historico centralizado ou governanca.

### Geracao de codigo

A aplicacao gera exemplos equivalentes da requisicao atual em:

- cURL;
- JavaScript `fetch`;
- Axios;
- Python `requests`.

Tambem permite copiar o codigo gerado para a area de transferencia.

## 6. Estado atual de maturidade

O projeto esta funcional como ferramenta local ou MVP interno. A validacao tecnica executada neste repositorio indicou:

- `npm run lint`: passou;
- `npm run build`: passou;
- build gerado em `dist`.

Ao mesmo tempo, a implementacao ainda esta bastante concentrada em um unico componente React grande (`src/App.tsx`), com estado, regras de negocio e interface misturados. Isso e aceitavel para prototipo, mas tende a dificultar manutencao conforme o produto crescer.

## 7. Limitacoes e riscos

### Seguranca do proxy

O endpoint `/api/proxy` aceita uma URL enviada pelo cliente e faz a requisicao a partir do servidor. Mesmo com validacao basica de protocolo e metodo, isso pode abrir risco de SSRF caso seja exposto em rede sem controles adicionais.

Recomendacoes:

- restringir dominios permitidos por allowlist;
- bloquear IPs privados, localhost, metadata services e ranges internos;
- adicionar autenticacao no acesso ao app;
- registrar auditoria das chamadas;
- aplicar rate limiting e timeout;
- limitar tamanho de payload e resposta.

### Segredos no navegador

Tokens e chaves sao digitados e mantidos no estado do frontend. Alguns dados podem ser salvos em `localStorage` junto com requisicoes. Isso nao e adequado para segredos sensiveis em ambiente compartilhado ou corporativo.

Recomendacoes:

- evitar persistir tokens por padrao;
- criptografar ou armazenar segredos em backend seguro, se necessario;
- adicionar aviso claro de sensibilidade;
- implementar limpeza de credenciais;
- avaliar integracao com cofre de segredos ou identidade corporativa.

### Persistencia limitada

O uso de `localStorage` torna os dados locais ao navegador. Nao ha:

- usuarios;
- times;
- permissoes;
- historico centralizado;
- sincronizacao;
- backup;
- auditoria.

### Observabilidade limitada

Atualmente ha `console.log` no servidor, mas nao ha logging estruturado, metricas, tracing, correlation IDs ou monitoramento de erros.

### Escalabilidade de codigo

O componente principal esta grande e acumula responsabilidades. Para evoluir, seria recomendavel separar:

- componentes de tela;
- hooks de estado;
- servicos de API;
- parsing de Swagger;
- geracao de codigo;
- validacoes;
- tipos compartilhados.

### Funcionalidades incompletas

Algumas telas existem no menu, mas ainda estao como placeholders:

- dashboard;
- historico de execucoes;
- colecoes;
- ambientes;
- configuracoes.

### Template e configuracao herdados

O README e parte da configuracao ainda mencionam Google AI Studio e Gemini, mas a aplicacao atual nao usa IA. Isso pode gerar confusao para onboarding, deploy e revisao tecnica.

## 8. Recomendacoes para evolucao

### Curto prazo

- Atualizar README com instrucoes reais da aplicacao.
- Remover dependencias e variaveis nao utilizadas, especialmente Gemini, se nao houver plano de IA.
- Separar o `App.tsx` em componentes menores.
- Adicionar allowlist de dominios no proxy.
- Adicionar timeout nas chamadas externas.
- Impedir persistencia acidental de tokens no `localStorage`.
- Criar testes unitarios para parsing de paginas, parsing de body, Swagger e geracao de codigo.

### Medio prazo

- Implementar autenticacao de usuarios.
- Criar persistencia backend para APIs, requisicoes, colecoes e ambientes.
- Adicionar historico real de execucoes.
- Adicionar ambientes com variaveis, por exemplo desenvolvimento, homologacao e producao.
- Criar modelo de permissoes por equipe.
- Introduzir logging estruturado e auditoria.
- Melhorar suporte a OpenAPI, incluindo parametros de path/query/header e schemas com `$ref`.

### Longo prazo

- Transformar a ferramenta em uma plataforma interna de governanca e teste de APIs.
- Integrar com CI/CD para validacao automatica de contratos.
- Adicionar compartilhamento de colecoes por time.
- Suportar mocks, testes automatizados e monitores.
- Avaliar integracao com identidade corporativa e cofre de segredos.

## 9. Consideracoes de deploy

O servidor Express ja serve o frontend em producao a partir de `dist`, e no desenvolvimento usa o Vite em modo middleware. Um deploy simples pode rodar:

```bash
npm install
npm run build
npm run start
```

Antes de expor fora de ambiente local, e importante enderecar os controles de seguranca do proxy, autenticacao e gestao de segredos.

## 10. Conclusao

ApiFlow e uma boa base de MVP para uma ferramenta interna de exploracao e teste de APIs. Ela ja resolve fluxos praticos de importacao Swagger, execucao de chamadas, autenticacao, paginacao, salvamento local e geracao de codigo.

O principal ponto de atencao para CTO nao e a viabilidade tecnica do produto, mas a maturidade necessaria para operar com seguranca em ambiente corporativo. O caminho recomendado e tratar a versao atual como prototipo funcional e priorizar hardening do proxy, autenticacao, persistencia, organizacao do codigo e observabilidade antes de expandir o uso.
