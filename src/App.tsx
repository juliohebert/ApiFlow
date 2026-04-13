/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import { Terminal, History, Folder, Layers, Settings, Plus, Search, Bell, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';

interface OpenAPIEndpoint {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  parameters?: any[];
  requestBody?: any;
  security?: any[];
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<'dashboard' | 'builder' | 'environments' | 'saved' | 'swagger'>('swagger');
  const [curlInput, setCurlInput] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [xChaveKey, setXChaveKey] = useState('');
  const [xSecretKey, setXSecretKey] = useState('');
  const [pages, setPages] = useState('1');
  const [body, setBody] = useState('');
  const [requestName, setRequestName] = useState('');
  const [responseData, setResponseData] = useState<any>(null);
  const [filterField, setFilterField] = useState('');
  const [filterText, setFilterText] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [savedRequests, setSavedRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Estados para Swagger/OpenAPI
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [swaggerSpec, setSwaggerSpec] = useState<any>(null);
  const [swaggerEndpoints, setSwaggerEndpoints] = useState<OpenAPIEndpoint[]>([]);
  const [swaggerBaseUrl, setSwaggerBaseUrl] = useState('');
  const [isLoadingSwagger, setIsLoadingSwagger] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<OpenAPIEndpoint | null>(null);

  const handleSaveRequest = () => {
    const newRequest = {
      id: Date.now(),
      name: requestName || `Requisição ${savedRequests.length + 1}`,
      method,
      url,
      authToken,
      xChaveKey,
      xSecretKey,
      pages,
      body
    };
    setSavedRequests([...savedRequests, newRequest]);
    setRequestName('');
    alert('Requisição salva com sucesso!');
  };

  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'json' | 'table'>('json');

  // Parsear especificação OpenAPI/Swagger
  const parseOpenAPISpec = (spec: any) => {
    const endpoints: OpenAPIEndpoint[] = [];
    
    // Determinar a base URL
    let baseUrl = '';
    if (spec.servers && spec.servers.length > 0) {
      baseUrl = spec.servers[0].url;
    } else if (spec.host) {
      // Prioriza HTTPS se disponível nos schemes
      let scheme = 'https';
      if (spec.schemes && Array.isArray(spec.schemes)) {
        scheme = spec.schemes.includes('https') ? 'https' : spec.schemes[0];
      }
      baseUrl = `${scheme}://${spec.host}${spec.basePath || ''}`;
    }
    
    // Se ainda não tem protocolo, tenta usar o da URL do Swagger
    if (baseUrl && !baseUrl.startsWith('http')) {
      const swaggerProtocol = swaggerUrl.startsWith('https') ? 'https' : 'http';
      baseUrl = `${swaggerProtocol}://${baseUrl}`;
    }
    
    setSwaggerBaseUrl(baseUrl);
    
    // Extrair endpoints
    const paths = spec.paths || {};
    Object.keys(paths).forEach(path => {
      const pathItem = paths[path];
      ['get', 'post', 'put', 'delete', 'patch'].forEach(method => {
        if (pathItem[method]) {
          const operation = pathItem[method];
          endpoints.push({
            path,
            method: method.toUpperCase(),
            summary: operation.summary || '',
            description: operation.description || '',
            parameters: operation.parameters || [],
            requestBody: operation.requestBody,
            security: operation.security || spec.security || [],
          });
        }
      });
    });
    
    setSwaggerEndpoints(endpoints);
    return endpoints;
  };

  // Importar Swagger
  const handleSwaggerImport = async () => {
    if (!swaggerUrl.trim()) {
      alert('Por favor, insira a URL do Swagger');
      return;
    }
    
    setIsLoadingSwagger(true);
    try {
      const res = await fetch('/api/fetch-swagger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: swaggerUrl }),
      });
      
      const result = await res.json();
      
      if (result.success) {
        setSwaggerSpec(result.data);
        const endpoints = parseOpenAPISpec(result.data);
        alert(`✅ Swagger importado com sucesso! ${endpoints.length} endpoints encontrados.`);
      } else {
        alert(`❌ Erro: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ Erro ao importar Swagger: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingSwagger(false);
    }
  };

  // Aplicar endpoint selecionado ao formulário
  const applyEndpoint = (endpoint: OpenAPIEndpoint) => {
    setSelectedEndpoint(endpoint);
    setMethod(endpoint.method);
    
    // Construir URL completa (remove barras duplicadas)
    const baseUrl = swaggerBaseUrl.replace(/\/$/, ''); // Remove barra no final da base URL
    const path = endpoint.path.startsWith('/') ? endpoint.path : '/' + endpoint.path;
    let fullUrl = baseUrl + path;
    
    // Se tem parâmetros de path, substituir
    const pathParams = endpoint.parameters?.filter(p => p.in === 'path') || [];
    pathParams.forEach(param => {
      fullUrl = fullUrl.replace(`{${param.name}}`, `{${param.name}}`);
    });
    
    setUrl(fullUrl);
    setRequestName(endpoint.summary || `${endpoint.method} ${endpoint.path}`);
    
    // Se tem requestBody, gerar exemplo
    if (endpoint.requestBody) {
      const content = endpoint.requestBody.content;
      if (content && content['application/json']) {
        const schema = content['application/json'].schema;
        const example = generateExampleFromSchema(schema);
        setBody(JSON.stringify(example, null, 2));
      }
    } else {
      setBody('');
    }
  };

  // Gerar exemplo a partir de schema
  const generateExampleFromSchema = (schema: any): any => {
    if (!schema) return {};
    
    if (schema.example) return schema.example;
    
    if (schema.properties) {
      const example: any = {};
      Object.keys(schema.properties).forEach(key => {
        const prop = schema.properties[key];
        if (prop.example !== undefined) {
          example[key] = prop.example;
        } else if (prop.type === 'string') {
          example[key] = prop.default || 'string';
        } else if (prop.type === 'number' || prop.type === 'integer') {
          example[key] = prop.default || 0;
        } else if (prop.type === 'boolean') {
          example[key] = prop.default || false;
        } else if (prop.type === 'array') {
          example[key] = [];
        } else if (prop.type === 'object') {
          example[key] = prop.properties ? generateExampleFromSchema(prop) : {};
        }
      });
      return example;
    }
    
    return {};
  };

  useEffect(() => {
    if (responseData) {
      const allData = responseData.flatMap((res: any) => {
        let data = res.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
            if (arrayKey) data = data[arrayKey];
        }
        return Array.isArray(data) ? data : [];
      });
      setFilteredData(allData.filter((item: any) => {
        if (!filterField || !filterText) return true;
        return String(item[filterField] || '').toLowerCase().includes(filterText.toLowerCase());
      }));
    }
  }, [responseData, filterText, filterField]);

  const handleCurlImport = () => {
    // Parsing básico
    if (curlInput.includes('POST')) setMethod('POST');
    else if (curlInput.includes('DELETE')) setMethod('DELETE');
    else setMethod('GET');
    
    const urlMatch = curlInput.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        const urlString = urlMatch[0].replace(/"/g, '');
        setUrl(urlString);
        
        // Tenta extrair a página da URL
        const pageMatch = urlString.match(/page=(\d+)/);
        if (pageMatch) setPages(pageMatch[1]);
    }
    
    const tokenMatch = curlInput.match(/-H "Auth-token: ([^"]+)"/);
    if (tokenMatch) setAuthToken(tokenMatch[1]);
  };

  const handleSendRequest = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setResponse('Enviando...');
    setFilterText('');
    setFilterField('');
    
    // Parsing simples de páginas (ex: "1,2,3" ou "1-3")
    let pageList: number[] = [];
    if (pages.includes('-')) {
        const [start, end] = pages.split('-').map(Number);
        for (let i = start; i <= end; i++) pageList.push(i);
    } else {
        pageList = pages.split(',').map(Number);
    }

    try {
      const results = [];
      for (const page of pageList) {
          const pageUrl = url.replace(/page=\d+/, `page=${page}`);
          const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: pageUrl, 
              method,
              headers: { 
                'Auth-token': authToken,
                'X-Chave-Key': xChaveKey,
                'X-Secret-Key': xSecretKey
              },
              body: body ? JSON.parse(body) : undefined
            }),
          });
          const data = await res.json();
          results.push({ page, status: data.status, data: data.data });
          await new Promise(resolve => setTimeout(resolve, 500)); // Delay de 500ms
      }
      setResponseData(results);
      setResponse(JSON.stringify(results, null, 2));
    } catch (error) {
      setResponse(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1326] text-[#dae2fd] font-sans flex">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-16'} bg-[#0b1326] border-r border-[#131b2e] flex flex-col transition-all duration-300`}>
        <div className="p-6 flex items-center justify-between">
          {isSidebarOpen && (
            <div>
              <h1 className="text-xl font-bold text-[#7bd0ff] tracking-widest">API Forge</h1>
              <p className="text-[10px] text-gray-500 font-mono">v2.4.0-stable</p>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-gray-400 hover:text-white">
            {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
        
        {isSidebarOpen && (
          <>
            <button 
              onClick={() => {
                console.log('Botão Nova Requisição clicado');
                setActiveScreen('builder');
              }}
              className="mx-4 mb-8 py-2.5 px-4 rounded bg-gradient-to-r from-[#7bd0ff] to-[#008abb] text-[#001e2c] font-bold text-sm flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Nova Requisição
            </button>
            <nav className="flex-1 space-y-1 px-4">
              {[
                { id: 'swagger', name: 'Importar Swagger', icon: Layers },
                { id: 'builder', name: 'Nova Requisição', icon: Plus },
                { id: 'saved', name: 'Requisições Salvas', icon: History },
                { id: 'dashboard', name: 'Área de Trabalho', icon: Terminal },
                { id: 'history', name: 'Histórico', icon: History },
                { id: 'collections', name: 'Coleções', icon: Folder },
                { id: 'environments', name: 'Ambientes', icon: Layers },
                { id: 'settings', name: 'Configurações', icon: Settings },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveScreen(item.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm rounded ${
                    activeScreen === item.id ? 'bg-[#131b2e] text-[#7bd0ff] border-r-2 border-[#7bd0ff]' : 'text-gray-400 hover:text-white hover:bg-[#222a3d]'
                  }`}
                >
                  <item.icon size={18} />
                  {item.name}
                </button>
              ))}
            </nav>
          </>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <header className="h-16 border-b border-[#131b2e] flex items-center justify-between px-6">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input className="w-full bg-[#131b2e] border-none rounded py-2 pl-10 pr-4 text-xs" placeholder="Buscar..." />
          </div>
          <div className="flex items-center gap-4">
            <Bell size={18} className="text-gray-400" />
            <HelpCircle size={18} className="text-gray-400" />
            <button className="bg-[#131b2e] text-[#7bd0ff] px-4 py-1.5 rounded font-bold text-xs border border-[#7bd0ff]/20">Executar</button>
          </div>
        </header>
        <div className="flex-1 p-8">
          <div className="mb-4 text-xs text-gray-500">Estado atual: {activeScreen}</div>
          {activeScreen === 'dashboard' && <div className="p-4 bg-[#131b2e] rounded">Conteúdo do Painel</div>}
          
          {/* Tela de Importação Swagger */}
          {activeScreen === 'swagger' && (
            <div className="p-6 bg-[#131b2e] rounded border border-[#7bd0ff]">
              <h2 className="text-2xl font-bold mb-2 text-[#7bd0ff]">🚀 Importar API via Swagger/OpenAPI</h2>
              <p className="text-sm text-gray-400 mb-6">Cole a URL do Swagger UI da sua API e importe todos os endpoints automaticamente!</p>
              
              {/* Importação Swagger */}
              <div className="mb-6 p-6 bg-[#0b1326] rounded border-2 border-[#7bd0ff] shadow-lg">
                <h3 className="text-base font-bold text-[#7bd0ff] mb-4 flex items-center gap-2">
                  <Layers size={20} />
                  URL do Swagger UI
                </h3>
                <div className="flex gap-3">
                  <input 
                    className="flex-1 bg-[#131b2e] border-2 border-[#7bd0ff]/30 rounded-lg p-3 text-sm font-mono focus:border-[#7bd0ff] focus:outline-none" 
                    placeholder="Ex: https://api.quark.tec.br/clinic/ext/swagger-ui.html#/"
                    value={swaggerUrl}
                    onChange={(e) => setSwaggerUrl(e.target.value)}
                  />
                  <button 
                    onClick={handleSwaggerImport}
                    disabled={isLoadingSwagger}
                    className="bg-gradient-to-r from-[#7bd0ff] to-[#008abb] text-[#001e2c] px-8 py-3 rounded-lg font-bold text-sm disabled:opacity-50 hover:shadow-xl transition-all"
                  >
                    {isLoadingSwagger ? '⏳ Carregando...' : '✨ Importar API'}
                  </button>
                </div>
                
                {/* Lista de endpoints */}
                {swaggerEndpoints.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-bold text-[#7bd0ff]">
                        ✅ {swaggerEndpoints.length} endpoints encontrados
                      </div>
                      <div className="text-xs text-gray-400 font-mono">
                        Base URL: {swaggerBaseUrl}
                      </div>
                    </div>
                    <div className="bg-[#131b2e] rounded-lg p-4 border border-[#7bd0ff]/20">
                      <div className="text-xs text-gray-400 mb-3">Clique em um endpoint para usar:</div>
                      <div className="max-h-96 overflow-y-auto space-y-2">
                        {swaggerEndpoints.map((endpoint, idx) => (
                          <div 
                            key={idx}
                            onClick={() => {
                              applyEndpoint(endpoint);
                              setActiveScreen('builder');
                            }}
                            className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 transition-all ${
                              selectedEndpoint === endpoint 
                                ? 'bg-[#222a3d] border-2 border-[#7bd0ff] shadow-md' 
                                : 'bg-[#0b1326] border border-[#131b2e] hover:bg-[#222a3d] hover:border-[#7bd0ff]/50'
                            }`}
                          >
                            <span className={`px-3 py-1 rounded-md text-xs font-bold min-w-[70px] text-center ${
                              endpoint.method === 'GET' ? 'bg-green-900/50 text-green-300 border border-green-600' :
                              endpoint.method === 'POST' ? 'bg-blue-900/50 text-blue-300 border border-blue-600' :
                              endpoint.method === 'PUT' ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-600' :
                              endpoint.method === 'DELETE' ? 'bg-red-900/50 text-red-300 border border-red-600' :
                              'bg-gray-900/50 text-gray-300 border border-gray-600'
                            }`}>
                              {endpoint.method}
                            </span>
                            <span className="text-sm font-mono flex-1 text-[#7bd0ff]">{endpoint.path}</span>
                            <span className="text-xs text-gray-400 max-w-xs truncate">{endpoint.summary}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-6 p-4 bg-[#0b1326] rounded border border-gray-700">
                <h4 className="text-sm font-bold mb-2">💡 Como funciona:</h4>
                <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                  <li>Cole a URL do Swagger UI da sua API</li>
                  <li>O sistema busca automaticamente a especificação OpenAPI</li>
                  <li>Todos os endpoints são listados com seus métodos e descrições</li>
                  <li>Clique em um endpoint para carregar automaticamente no construtor</li>
                  <li>Faça requisições sem precisar configurar manualmente!</li>
                </ul>
              </div>
            </div>
          )}
          
          {activeScreen === 'saved' && (
            <div className="p-6 bg-[#131b2e] rounded border border-[#7bd0ff]">
              <h2 className="text-lg font-bold text-[#7bd0ff] mb-4">Requisições Salvas</h2>
              <div className="space-y-2">
                {savedRequests.map((req) => (
                  <div key={req.id} className="p-3 bg-[#0b1326] rounded flex justify-between items-center">
                    <div>
                      <div className="font-bold text-sm">{req.name}</div>
                      <div className="text-xs text-gray-500">{req.method} {req.url}</div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setMethod(req.method);
                          setUrl(req.url);
                          setAuthToken(req.authToken);
                          setXChaveKey(req.xChaveKey);
                          setXSecretKey(req.xSecretKey);
                          setPages(req.pages);
                          setBody(req.body);
                          setRequestName(req.name);
                          setActiveScreen('builder');
                        }}
                        className="bg-[#131b2e] text-[#7bd0ff] px-3 py-1 rounded border border-[#7bd0ff]/20 text-xs font-bold hover:bg-[#222a3d]"
                      >
                        Carregar
                      </button>
                      <button 
                        onClick={() => setSavedRequests(savedRequests.filter(r => r.id !== req.id))}
                        className="bg-red-900/20 text-red-500 px-3 py-1 rounded border border-red-900/50 text-xs font-bold hover:bg-red-900/40"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeScreen === 'builder' && (
            <div className="p-6 bg-[#131b2e] rounded border border-[#7bd0ff]">
              <h2 className="text-lg font-bold mb-4">Construtor de Requisições</h2>
              
              {/* Importação Swagger */}
              <div className="mb-6 p-4 bg-[#0b1326] rounded border border-[#7bd0ff]/40">
                <h3 className="text-sm font-bold text-[#7bd0ff] mb-3 flex items-center gap-2">
                  <Layers size={16} />
                  Importar API via Swagger/OpenAPI
                </h3>
                <div className="flex gap-2">
                  <input 
                    className="flex-1 bg-[#131b2e] border border-[#7bd0ff]/20 rounded p-2 text-sm" 
                    placeholder="Cole a URL do Swagger UI (ex: https://api.exemplo.com/swagger-ui.html)"
                    value={swaggerUrl}
                    onChange={(e) => setSwaggerUrl(e.target.value)}
                  />
                  <button 
                    onClick={handleSwaggerImport}
                    disabled={isLoadingSwagger}
                    className="bg-gradient-to-r from-[#7bd0ff] to-[#008abb] text-[#001e2c] px-4 py-2 rounded font-bold text-sm disabled:opacity-50"
                  >
                    {isLoadingSwagger ? 'Carregando...' : 'Importar'}
                  </button>
                </div>
                
                {/* Lista de endpoints */}
                {swaggerEndpoints.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-400 mb-2">
                      {swaggerEndpoints.length} endpoints encontrados - Base URL: {swaggerBaseUrl}
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {swaggerEndpoints.map((endpoint, idx) => (
                        <div 
                          key={idx}
                          onClick={() => applyEndpoint(endpoint)}
                          className={`p-2 rounded cursor-pointer flex items-center gap-2 hover:bg-[#222a3d] ${
                            selectedEndpoint === endpoint ? 'bg-[#222a3d] border border-[#7bd0ff]/40' : 'bg-[#131b2e]'
                          }`}
                        >
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            endpoint.method === 'GET' ? 'bg-green-900/40 text-green-400' :
                            endpoint.method === 'POST' ? 'bg-blue-900/40 text-blue-400' :
                            endpoint.method === 'PUT' ? 'bg-yellow-900/40 text-yellow-400' :
                            endpoint.method === 'DELETE' ? 'bg-red-900/40 text-red-400' :
                            'bg-gray-900/40 text-gray-400'
                          }`}>
                            {endpoint.method}
                          </span>
                          <span className="text-xs flex-1">{endpoint.path}</span>
                          <span className="text-xs text-gray-500">{endpoint.summary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mb-4">
                <textarea 
                  className="w-full bg-[#0b1326] border border-[#131b2e] rounded p-2 text-xs font-mono" 
                  placeholder="Cole seu comando cURL aqui..."
                  rows={3}
                  value={curlInput}
                  onChange={(e) => setCurlInput(e.target.value)}
                />
                <button 
                  onClick={handleCurlImport}
                  className="mt-2 bg-[#131b2e] text-[#7bd0ff] px-3 py-1 rounded text-xs border border-[#7bd0ff]/20"
                >
                  Importar cURL
                </button>
              </div>

              <div className="mb-4">
                <textarea 
                  className="w-full bg-[#0b1326] border border-[#131b2e] rounded p-2 text-xs font-mono" 
                  placeholder="Corpo da requisição (JSON)..."
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Método</label>
                  <select 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">URL</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="URL da API" 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Auth-token</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="Auth-token" 
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">X-Chave-Key</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="X-Chave-Key" 
                    value={xChaveKey}
                    onChange={(e) => setXChaveKey(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">X-Secret-Key</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="X-Secret-Key" 
                    value={xSecretKey}
                    onChange={(e) => setXSecretKey(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Nome da Requisição</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm w-40" 
                    placeholder="Ex: Minha API" 
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Páginas</label>
                  <input 
                    className="bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm w-20" 
                    placeholder="Páginas" 
                    value={pages}
                    onChange={(e) => setPages(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">&nbsp;</label>
                  <div className="flex gap-2">
                    <button 
                      type="button"
                      onClick={handleSendRequest}
                      disabled={isLoading}
                      className="bg-[#7bd0ff] text-[#001e2c] px-4 py-2 rounded font-bold text-sm disabled:opacity-50"
                    >
                      {isLoading ? 'Enviando...' : 'Enviar'}
                    </button>
                    <button 
                      type="button"
                      onClick={handleSaveRequest}
                      className="bg-[#131b2e] text-[#7bd0ff] px-4 py-2 rounded font-bold text-sm border border-[#7bd0ff]/20"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
              
              {responseData && (
                <div className="mt-4 flex gap-2">
                  <input 
                    className="w-1/3 bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="Campo (ex: id, nome)..." 
                    value={filterField}
                    onChange={(e) => setFilterField(e.target.value)}
                  />
                  <input 
                    className="flex-1 bg-[#0b1326] border border-[#131b2e] rounded p-2 text-sm" 
                    placeholder="Valor do filtro..." 
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                  />
                </div>
              )}

              {responseData && (
                <div className="mt-4">
                  <div className="flex gap-2 mb-2">
                    <button 
                      onClick={() => setViewMode('json')}
                      className={`px-3 py-1 text-xs rounded ${viewMode === 'json' ? 'bg-[#7bd0ff] text-[#001e2c]' : 'bg-[#131b2e] text-gray-400'}`}
                    >
                      JSON
                    </button>
                    <button 
                      onClick={() => setViewMode('table')}
                      className={`px-3 py-1 text-xs rounded ${viewMode === 'table' ? 'bg-[#7bd0ff] text-[#001e2c]' : 'bg-[#131b2e] text-gray-400'}`}
                    >
                      Tabela
                    </button>
                  </div>
                  
                  {viewMode === 'table' ? (
                    <div className="p-4 bg-[#0b1326] rounded border border-[#131b2e] overflow-auto max-h-96">
                      <table className="w-full text-xs text-left text-gray-300">
                        <thead className="text-gray-500 uppercase">
                          <tr>
                            <th className="px-2 py-1">ID</th>
                            <th className="px-2 py-1">Nome</th>
                            <th className="px-2 py-1">Tipo</th>
                            <th className="px-2 py-1">Data Criação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredData.map((item: any) => (
                            <tr key={item.id} className="border-t border-[#131b2e]">
                              <td className="px-2 py-1">{item.id}</td>
                              <td className="px-2 py-1">{item.nome}</td>
                              <td className="px-2 py-1">{item.tipoProcedimento}</td>
                              <td className="px-2 py-1">{item.dataCriacao}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 bg-[#0b1326] rounded border border-[#131b2e] text-xs font-mono overflow-auto max-h-96">
                      <pre className="whitespace-pre-wrap break-words">{JSON.stringify(filteredData, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {activeScreen === 'environments' && <div className="p-4 bg-[#131b2e] rounded">Conteúdo do Gerenciador de Ambientes</div>}
        </div>
      </main>
    </div>
  );
}
