/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef } from 'react';
import { Terminal, History, Folder, Layers, Settings, Plus, Search, Bell, HelpCircle, ChevronLeft, ChevronRight, ChevronDown, Trash2, Code, Copy, Check, X, Eye, EyeOff, Pencil } from 'lucide-react';

interface OpenAPIEndpoint {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  parameters?: any[];
  requestBody?: any;
  security?: any[];
}

type ActiveScreen = 'dashboard' | 'builder' | 'environments' | 'saved' | 'swagger' | 'history' | 'collections' | 'settings';
type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey' | 'custom';
type ApiKeyLocation = 'header' | 'query';
type RequestConfigTab = 'params' | 'headers' | 'auth' | 'body';
type ResponseMeta = {
  status: number | null;
  elapsedMs: number | null;
  sizeBytes: number | null;
  error?: string;
};

type EnvVariable = { id: number; name: string; value: string };
type Environment = { id: string; name: string; variables: EnvVariable[] };

type HistoryEntry = {
  id: number;
  method: string;
  url: string;
  status: number | null;
  elapsedMs: number | null;
  executedAt: string;
  envName: string | null;
  success: boolean;
  error?: string;
  requestSnapshot: {
    method: string;
    url: string;
    authType: string;
    authToken: string;
    xChaveKey: string;
    xSecretKey: string;
    basicUsername: string;
    basicPassword: string;
    apiKeyName: string;
    apiKeyValue: string;
    apiKeyLocation: string;
    pages: string;
    body: string;
    customHeaders: { key: string; value: string }[];
  };
};

type Collection = { id: string; name: string };

const DEFAULT_ENVIRONMENTS: Environment[] = [
  { id: 'local', name: 'Local', variables: [] },
  { id: 'qa', name: 'QA', variables: [] },
  { id: 'homologacao', name: 'Homologação', variables: [] },
  { id: 'producao', name: 'Produção', variables: [] },
];

const parseJsonBody = (value: string) => {
  if (!value.trim()) return { ok: true as const, data: undefined };

  try {
    return { ok: true as const, data: JSON.parse(value) };
  } catch (error) {
    return {
      ok: false as const,
      message: `JSON invalido no corpo da requisicao: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const parsePages = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, pages: [1] };

  const pages = trimmed.includes('-')
    ? (() => {
        const [start, end] = trimmed.split('-').map(Number);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
        return Array.from({ length: end - start + 1 }, (_, index) => start + index);
      })()
    : trimmed.split(',').map((page) => Number(page.trim()));

  if (!pages || pages.some((page) => !Number.isInteger(page) || page < 1)) {
    return { ok: false as const, message: 'Informe paginas validas. Exemplos: 1, 1,2,3 ou 1-3.' };
  }

  return { ok: true as const, pages };
};

type ParsedCurlCommand = {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
  basicAuth?: { username: string; password: string };
};

const tokenizeCurlCommand = (value: string) => {
  const normalized = value
    .replace(/\\\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ');
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
};

const parseHeaderValue = (value: string) => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) return null;

  const key = value.slice(0, separatorIndex).trim();
  const headerValue = value.slice(separatorIndex + 1).trim();
  if (!key) return null;

  return { key, value: headerValue };
};

const parseCurlCommand = (value: string): ParsedCurlCommand => {
  const tokens = tokenizeCurlCommand(value).filter(Boolean);
  const parsed: ParsedCurlCommand = {
    method: '',
    url: '',
    headers: [],
    body: '',
  };

  const readNext = (index: number) => tokens[index + 1] || '';

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lowerToken = token.toLowerCase();

    if (lowerToken === 'curl') continue;

    if (token === '-X' || lowerToken === '--request') {
      parsed.method = readNext(index).toUpperCase();
      index += 1;
      continue;
    }

    if (token.startsWith('-X') && token.length > 2) {
      parsed.method = token.slice(2).toUpperCase();
      continue;
    }

    if (lowerToken.startsWith('--request=')) {
      parsed.method = token.slice(token.indexOf('=') + 1).toUpperCase();
      continue;
    }

    if (lowerToken === '--url') {
      parsed.url = readNext(index);
      index += 1;
      continue;
    }

    if (lowerToken.startsWith('--url=')) {
      parsed.url = token.slice(token.indexOf('=') + 1);
      continue;
    }

    if (token === '-H' || lowerToken === '--header') {
      const header = parseHeaderValue(readNext(index));
      if (header) parsed.headers.push(header);
      index += 1;
      continue;
    }

    if (lowerToken.startsWith('--header=')) {
      const header = parseHeaderValue(token.slice(token.indexOf('=') + 1));
      if (header) parsed.headers.push(header);
      continue;
    }

    if (token.startsWith('-H') && token.length > 2) {
      const header = parseHeaderValue(token.slice(2));
      if (header) parsed.headers.push(header);
      continue;
    }

    if (
      token === '-d' ||
      lowerToken === '--data' ||
      lowerToken === '--data-raw' ||
      lowerToken === '--data-binary' ||
      lowerToken === '--data-ascii' ||
      lowerToken === '--data-urlencode'
    ) {
      parsed.body = readNext(index);
      index += 1;
      continue;
    }

    if (lowerToken.startsWith('--data=')) {
      parsed.body = token.slice(token.indexOf('=') + 1);
      continue;
    }

    if (token.startsWith('-d') && token.length > 2) {
      parsed.body = token.slice(2);
      continue;
    }

    if (token === '-u' || lowerToken === '--user') {
      const [username = '', password = ''] = readNext(index).split(':');
      parsed.basicAuth = { username, password };
      index += 1;
      continue;
    }

    if (lowerToken.startsWith('--user=')) {
      const [username = '', password = ''] = token.slice(token.indexOf('=') + 1).split(':');
      parsed.basicAuth = { username, password };
      continue;
    }

    if (!token.startsWith('-') && /^https?:\/\//i.test(token)) {
      parsed.url = token;
    }
  }

  if (!parsed.method) parsed.method = parsed.body ? 'POST' : 'GET';
  return parsed;
};

const renderHighlightedJson = (value: string) => {
  const tokenPattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    const token = match[0];
    const isKey = token.startsWith('"') && /"\s*$/.test(token) && value.slice(match.index + token.length).trimStart().startsWith(':');
    const className = isKey
      ? 'text-[#2563EB]'
      : token.startsWith('"')
        ? 'text-[#047857]'
        : /^-?\d/.test(token)
          ? 'text-[#C2410C]'
          : 'text-[#7C3AED]';

    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>
    );
    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getStatusTone = (status: number | null) => {
  if (!status) return 'bg-gray-100 text-[#6B7280] border-gray-200';
  if (status >= 200 && status < 300) return 'bg-green-50 text-green-700 border-green-200';
  if (status >= 300 && status < 400) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status >= 400 && status < 500) return 'bg-orange-50 text-orange-700 border-orange-200';
  return 'bg-red-50 text-red-700 border-red-200';
};

const formatTableCellValue = (value: any) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const flattenTableRow = (value: any, prefix = ''): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { [prefix || 'valor']: formatTableCellValue(value) };
  }

  return Object.entries(value).reduce<Record<string, string>>((acc, [key, entryValue]) => {
    const columnKey = prefix ? `${prefix}.${key}` : key;

    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
      Object.assign(acc, flattenTableRow(entryValue, columnKey));
    } else {
      acc[columnKey] = formatTableCellValue(entryValue);
    }

    return acc;
  }, {});
};

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('swagger');
  const [curlInput, setCurlInput] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('custom');
  const [authToken, setAuthToken] = useState('');
  const [xChaveKey, setXChaveKey] = useState('');
  const [xSecretKey, setXSecretKey] = useState('');
  const [basicUsername, setBasicUsername] = useState('');
  const [basicPassword, setBasicPassword] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyLocation, setApiKeyLocation] = useState<ApiKeyLocation>('header');
  const [showCustomSecrets, setShowCustomSecrets] = useState(false);
  const [pages, setPages] = useState('1');
  const [body, setBody] = useState('');
  const [requestName, setRequestName] = useState('');
  const [responseData, setResponseData] = useState<any>(null);
  const [filterField, setFilterField] = useState('');
  const [filterText, setFilterText] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [responseMeta, setResponseMeta] = useState<ResponseMeta | null>(null);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [savedRequests, setSavedRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [requestConfigTab, setRequestConfigTab] = useState<RequestConfigTab>('params');
  const [curlImportMessage, setCurlImportMessage] = useState('');
  
  // Estados para Swagger/OpenAPI
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [swaggerSpec, setSwaggerSpec] = useState<any>(null);
  const [swaggerEndpoints, setSwaggerEndpoints] = useState<OpenAPIEndpoint[]>([]);
  const [swaggerBaseUrl, setSwaggerBaseUrl] = useState('');
  const [isLoadingSwagger, setIsLoadingSwagger] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<OpenAPIEndpoint | null>(null);
  
  // Headers customizáveis
  const [customHeaders, setCustomHeaders] = useState<{key: string, value: string}[]>([]);
  
  // Geração de código
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<'curl' | 'javascript' | 'python' | 'axios'>('curl');
  const [copiedCode, setCopiedCode] = useState(false);
  
  // APIs salvas
  const [savedApis, setSavedApis] = useState<any[]>([]);
  
  // Filtro de método
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [savedSearch, setSavedSearch] = useState('');
  const [loadedRequestId, setLoadedRequestId] = useState<number | null>(null);
  const [responseTab, setResponseTab] = useState<'body' | 'headers' | 'cookies'>('body');
  const [jsonSearch, setJsonSearch] = useState('');
  const [lastResponseHeaders, setLastResponseHeaders] = useState<Record<string, string>>({});
  const [environments, setEnvironments] = useState<Environment[]>(DEFAULT_ENVIRONMENTS);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [editingEnvId, setEditingEnvId] = useState<string>('local');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set(['__none__']));
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const cancellingRenameRef = useRef(false);
  const [savedRequestFeedback, setSavedRequestFeedback] = useState(false);
  const [swaggerFeedback, setSwaggerFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  
  // Carregar APIs e requisicoes salvas do localStorage
  useEffect(() => {
    const stored = localStorage.getItem('savedApis');
    if (stored) {
      try {
        setSavedApis(JSON.parse(stored));
      } catch (e) {
        console.error('Erro ao carregar APIs salvas:', e);
      }
    }

    const storedRequests = localStorage.getItem('savedRequests');
    if (storedRequests) {
      try {
        setSavedRequests(JSON.parse(storedRequests));
      } catch (e) {
        console.error('Erro ao carregar requisicoes salvas:', e);
      }
    }

    const storedEnvs = localStorage.getItem('environments');
    if (storedEnvs) {
      try {
        setEnvironments(JSON.parse(storedEnvs));
      } catch (e) {
        console.error('Erro ao carregar ambientes:', e);
      }
    }
    const storedActiveEnv = localStorage.getItem('activeEnvId');
    if (storedActiveEnv) setActiveEnvId(storedActiveEnv);

    const storedHistory = localStorage.getItem('requestHistory');
    if (storedHistory) {
      try {
        setHistory(JSON.parse(storedHistory));
      } catch (e) {
        console.error('Erro ao carregar histórico:', e);
      }
    }

    const storedCollections = localStorage.getItem('collections');
    if (storedCollections) {
      try {
        const parsed: Collection[] = JSON.parse(storedCollections);
        setCollections(parsed);
        setExpandedCollections(new Set(['__none__', ...parsed.map(c => c.id)]));
      } catch (e) {
        console.error('Erro ao carregar coleções:', e);
      }
    }
  }, []);

  const resetRequestBuilder = () => {
    setCurlInput('');
    setMethod('GET');
    setUrl('');
    setAuthType('custom');
    setAuthToken('');
    setXChaveKey('');
    setXSecretKey('');
    setBasicUsername('');
    setBasicPassword('');
    setApiKeyName('');
    setApiKeyValue('');
    setApiKeyLocation('header');
    setShowCustomSecrets(false);
    setPages('1');
    setBody('');
    setRequestName('');
    setCustomHeaders([]);
    setSelectedEndpoint(null);
    setRequestConfigTab('auth');
    setCurlImportMessage('');
  };

  const openNewRequest = () => {
    resetRequestBuilder();
    setLoadedRequestId(null);
    setActiveScreen('builder');
  };

  const handleSaveRequest = () => {
    const newRequest = {
      id: Date.now(),
      name: requestName || `Requisição ${savedRequests.length + 1}`,
      method,
      url,
      authType,
      authToken,
      xChaveKey,
      xSecretKey,
      basicUsername,
      basicPassword,
      apiKeyName,
      apiKeyValue,
      apiKeyLocation,
      pages,
      body,
      lastExecutedAt: null as string | null,
      collectionId: null as string | null,
    };
    const updated = [...savedRequests, newRequest];
    setSavedRequests(updated);
    localStorage.setItem('savedRequests', JSON.stringify(updated));
    setRequestName('');
    setSavedRequestFeedback(true);
    setTimeout(() => setSavedRequestFeedback(false), 3000);
  };

  // Filtrar endpoints por método
  const deleteSavedRequest = (id: number) => {
    if (!window.confirm('Remover esta requisição salva?')) return;
    const updated = savedRequests.filter((request) => request.id !== id);
    setSavedRequests(updated);
    localStorage.setItem('savedRequests', JSON.stringify(updated));
  };

  const duplicateSavedRequest = (req: any) => {
    const duplicate = { ...req, id: Date.now(), name: `${req.name} (cópia)`, lastExecutedAt: null };
    const updated = [...savedRequests, duplicate];
    setSavedRequests(updated);
    localStorage.setItem('savedRequests', JSON.stringify(updated));
  };

  const moveRequestToCollection = (reqId: number, colId: string | null) => {
    const updated = savedRequests.map(r => r.id === reqId ? { ...r, collectionId: colId } : r);
    setSavedRequests(updated);
    localStorage.setItem('savedRequests', JSON.stringify(updated));
  };

  const createCollection = () => {
    const newCol: Collection = { id: `col_${Date.now()}`, name: 'Nova Coleção' };
    const updated = [...collections, newCol];
    setCollections(updated);
    localStorage.setItem('collections', JSON.stringify(updated));
    setExpandedCollections(prev => new Set([...prev, newCol.id]));
    setEditingCollectionId(newCol.id);
    setEditingCollectionName(newCol.name);
  };

  const startRenameCollection = (col: Collection) => {
    setEditingCollectionId(col.id);
    setEditingCollectionName(col.name);
  };

  const confirmRenameCollection = () => {
    if (!editingCollectionId) return;
    const trimmed = editingCollectionName.trim();
    if (!trimmed) return;
    const updated = collections.map(c => c.id === editingCollectionId ? { ...c, name: trimmed } : c);
    setCollections(updated);
    localStorage.setItem('collections', JSON.stringify(updated));
    setEditingCollectionId(null);
  };

  const deleteCollection = (colId: string) => {
    if (!window.confirm('Excluir esta coleção? As requisições serão movidas para "Sem coleção".')) return;
    const updatedCols = collections.filter(c => c.id !== colId);
    setCollections(updatedCols);
    localStorage.setItem('collections', JSON.stringify(updatedCols));
    const updatedReqs = savedRequests.map(r => r.collectionId === colId ? { ...r, collectionId: null } : r);
    setSavedRequests(updatedReqs);
    localStorage.setItem('savedRequests', JSON.stringify(updatedReqs));
  };

  const toggleCollection = (id: string) => {
    setExpandedCollections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredEndpoints = methodFilter === 'ALL' 
    ? swaggerEndpoints 
    : swaggerEndpoints.filter((endpoint: OpenAPIEndpoint) => endpoint.method === methodFilter);

  // Extrair métodos únicos dos endpoints disponíveis
  const availableMethods = ['ALL', ...Array.from(new Set(swaggerEndpoints.map((endpoint: OpenAPIEndpoint) => endpoint.method))).sort()];

  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'json' | 'table'>('json');

  // Funções para headers customizáveis
  const addCustomHeader = () => {
    setCustomHeaders([...customHeaders, { key: '', value: '' }]);
  };

  const removeCustomHeader = (index: number) => {
    setCustomHeaders(customHeaders.filter((_: any, i: number) => i !== index));
  };

  const updateCustomHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...customHeaders];
    updated[index][field] = value;
    setCustomHeaders(updated);
  };

  // Função para gerar código
  const getAuthHeaders = () => {
    const headers: Record<string, string> = {};

    if (authType === 'bearer' && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    if (authType === 'basic' && (basicUsername || basicPassword)) {
      headers.Authorization = `Basic ${btoa(`${basicUsername}:${basicPassword}`)}`;
    }

    if (authType === 'apiKey' && apiKeyLocation === 'header' && apiKeyName && apiKeyValue) {
      headers[apiKeyName] = apiKeyValue;
    }

    if (authType === 'custom') {
      if (authToken) headers['Auth-token'] = authToken;
      if (xChaveKey) headers['X-Chave-Key'] = xChaveKey;
      if (xSecretKey) headers['X-Secret-Key'] = xSecretKey;
    }

    return headers;
  };

  const applyAuthToUrl = (rawUrl: string) => {
    if (authType !== 'apiKey' || apiKeyLocation !== 'query' || !apiKeyName || !apiKeyValue) {
      return rawUrl;
    }
    try {
      const requestUrl = new URL(rawUrl);
      requestUrl.searchParams.set(apiKeyName, apiKeyValue);
      return requestUrl.toString();
    } catch {
      return rawUrl;
    }
  };

  const getRequestHeaders = () => {
    const requestHeaders: Record<string, string> = {
      ...getAuthHeaders(),
    };

    customHeaders.forEach((h: any) => {
      if (h.key && h.value) {
        requestHeaders[h.key] = h.value;
      }
    });

    return requestHeaders;
  };

  const applyEnvVars = (text: string): string => {
    if (!activeEnvId || !text) return text;
    const env = environments.find(e => e.id === activeEnvId);
    if (!env) return text;
    return text.replace(/\{\{([\w-]+)\}\}/g, (_, name) => {
      const variable = env.variables.find(v => v.name === name);
      return variable !== undefined ? variable.value : `{{${name}}}`;
    });
  };

  const saveEnvironments = (updated: Environment[]) => {
    setEnvironments(updated);
    localStorage.setItem('environments', JSON.stringify(updated));
  };

  const setActiveEnvironment = (id: string | null) => {
    setActiveEnvId(id);
    localStorage.setItem('activeEnvId', id || '');
  };

  const addEnvVariable = (envId: string) => {
    const updated = environments.map(env =>
      env.id === envId
        ? { ...env, variables: [...env.variables, { id: Date.now(), name: '', value: '' }] }
        : env
    );
    saveEnvironments(updated);
  };

  const updateEnvVariable = (envId: string, varId: number, field: 'name' | 'value', val: string) => {
    const updated = environments.map(env =>
      env.id === envId
        ? { ...env, variables: env.variables.map(v => v.id === varId ? { ...v, [field]: val } : v) }
        : env
    );
    saveEnvironments(updated);
  };

  const removeEnvVariable = (envId: string, varId: number) => {
    const updated = environments.map(env =>
      env.id === envId
        ? { ...env, variables: env.variables.filter(v => v.id !== varId) }
        : env
    );
    saveEnvironments(updated);
  };

  const saveHistoryEntry = (entry: HistoryEntry) => {
    setHistory(prev => {
      const updated = [entry, ...prev].slice(0, 100);
      localStorage.setItem('requestHistory', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteHistoryEntry = (id: number) => {
    setHistory(prev => {
      const updated = prev.filter(e => e.id !== id);
      localStorage.setItem('requestHistory', JSON.stringify(updated));
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('requestHistory');
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    const snap = entry.requestSnapshot;
    setMethod(snap.method);
    setUrl(snap.url);
    setAuthType(snap.authType as AuthType);
    setAuthToken(snap.authToken);
    setXChaveKey(snap.xChaveKey);
    setXSecretKey(snap.xSecretKey);
    setBasicUsername(snap.basicUsername);
    setBasicPassword(snap.basicPassword);
    setApiKeyName(snap.apiKeyName);
    setApiKeyValue(snap.apiKeyValue);
    setApiKeyLocation(snap.apiKeyLocation as ApiKeyLocation);
    setPages(snap.pages);
    setBody(snap.body);
    setCustomHeaders(snap.customHeaders);
    setLoadedRequestId(null);
    setActiveScreen('builder');
  };

  const generateCode = () => {
    const requestUrl = applyAuthToUrl(url);
    const headers: any = {
      'Content-Type': 'application/json',
      ...getRequestHeaders(),
    };

    const parsedBody = parseJsonBody(body);
    const bodyData = parsedBody.ok ? parsedBody.data : undefined;

    switch (codeLanguage) {
      case 'curl':
        let curl = `curl -X ${method} "${requestUrl}"`;
        Object.keys(headers).forEach(key => {
          curl += ` \\\n  -H "${key}: ${headers[key]}"`;
        });
        if (bodyData && method !== 'GET') {
          curl += ` \\\n  -d '${JSON.stringify(bodyData)}'`;
        }
        return curl;

      case 'javascript':
        return `fetch("${requestUrl}", {
  method: "${method}",
  headers: ${JSON.stringify(headers, null, 2)}${bodyData && method !== 'GET' ? ',\n  body: JSON.stringify(' + JSON.stringify(bodyData, null, 2) + ')' : ''}
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`;

      case 'axios':
        return `axios({
  method: "${method.toLowerCase()}",
  url: "${requestUrl}",
  headers: ${JSON.stringify(headers, null, 2)}${bodyData && method !== 'GET' ? ',\n  data: ' + JSON.stringify(bodyData, null, 2) : ''}
})
  .then(response => console.log(response.data))
  .catch(error => console.error('Error:', error));`;

      case 'python':
        return `import requests
import json

url = "${requestUrl}"
headers = ${JSON.stringify(headers, null, 2).replace(/"/g, "'")}${bodyData && method !== 'GET' ? `\ndata = ${JSON.stringify(bodyData, null, 2).replace(/"/g, "'")}` : ''}

response = requests.${method.toLowerCase()}(url, headers=headers${bodyData && method !== 'GET' ? ', json=data' : ''})
print(response.json())`;

      default:
        return '';
    }
  };

  // Copiar código gerado
  const copyCode = () => {
    const parsedBody = parseJsonBody(body);
    if (!parsedBody.ok) {
      alert(parsedBody.message);
      return;
    }

    const code = generateCode();
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Salvar API atual
  const saveCurrentApi = () => {
    const apiToSave = {
      id: Date.now(),
      name: swaggerUrl || `API ${savedApis.length + 1}`,
      url: swaggerUrl,
      baseUrl: swaggerBaseUrl,
      endpoints: swaggerEndpoints,
      spec: swaggerSpec,
      savedAt: new Date().toISOString(),
    };
    
    const updated = [...savedApis, apiToSave];
    setSavedApis(updated);
    localStorage.setItem('savedApis', JSON.stringify(updated));
    alert('✅ API salva com sucesso!');
  };

  // Carregar API salva
  const loadSavedApi = (api: any) => {
    setSwaggerUrl(api.url);
    setSwaggerBaseUrl(api.baseUrl);
    setSwaggerEndpoints(api.endpoints);
    setSwaggerSpec(api.spec);
    setActiveScreen('swagger');
  };

  // Deletar API salva
  const deleteSavedApi = (id: number) => {
    const updated = savedApis.filter((api: any) => api.id !== id);
    setSavedApis(updated);
    localStorage.setItem('savedApis', JSON.stringify(updated));
  };

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
      setSwaggerFeedback({ ok: false, message: 'Insira a URL do Swagger antes de importar.' });
      return;
    }

    setSwaggerFeedback(null);
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
        setSwaggerFeedback({ ok: true, message: `${endpoints.length} endpoints importados com sucesso.` });
        setTimeout(() => setSwaggerFeedback(null), 5000);
      } else {
        setSwaggerFeedback({ ok: false, message: result.error });
      }
    } catch (error) {
      setSwaggerFeedback({ ok: false, message: error instanceof Error ? error.message : String(error) });
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
    
    // Converter path params {id} → {{id}} para o sistema de variáveis de ambiente
    const pathParams = endpoint.parameters?.filter(p => p.in === 'path') || [];
    pathParams.forEach(param => {
      fullUrl = fullUrl.replace(`{${param.name}}`, `{{${param.name}}}`);
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
        return Array.isArray(data) ? data : data ? [data] : [];
      });
      setFilteredData(allData.filter((item: any) => {
        if (!filterField || !filterText) return true;
        const flattenedItem = flattenTableRow(item);
        return String(flattenedItem[filterField] || '').toLowerCase().includes(filterText.toLowerCase());
      }));
    }
  }, [responseData, filterText, filterField]);

  const handleCurlImport = () => {
    if (!curlInput.trim()) return;

    const parsedCurl = parseCurlCommand(curlInput);
    const nextHeaders: { key: string; value: string }[] = [];
    let nextAuthType: AuthType = 'none';
    let nextAuthToken = '';
    let nextXChaveKey = '';
    let nextXSecretKey = '';
    let nextBasicUsername = '';
    let nextBasicPassword = '';
    let nextApiKeyName = '';
    let nextApiKeyValue = '';
    let hasAuth = false;

    parsedCurl.headers.forEach((header) => {
      const headerName = header.key.toLowerCase();

      // Content-Type é gerenciado pelo proxy — descartar
      if (headerName === 'content-type') return;

      if (headerName === 'authorization') {
        const bearerMatch = header.value.match(/^Bearer\s+(.+)$/i);
        const basicMatch  = header.value.match(/^Basic\s+(.+)$/i);
        const tokenMatch  = header.value.match(/^Token\s+(.+)$/i);
        const apiKeyMatch = header.value.match(/^ApiKey\s+(.+)$/i);

        if (bearerMatch) {
          nextAuthType = 'bearer';
          nextAuthToken = bearerMatch[1].trim();
          hasAuth = true;
          return;
        }

        if (basicMatch) {
          nextAuthType = 'basic';
          try {
            const decoded = atob(basicMatch[1].trim());
            const colonIdx = decoded.indexOf(':');
            nextBasicUsername = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
            nextBasicPassword = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
          } catch {
            nextBasicUsername = '';
            nextBasicPassword = '';
          }
          hasAuth = true;
          return;
        }

        if (tokenMatch) {
          // "Token xxx" → trata como Bearer
          nextAuthType = 'bearer';
          nextAuthToken = tokenMatch[1].trim();
          hasAuth = true;
          return;
        }

        if (apiKeyMatch) {
          nextAuthType = 'apiKey';
          nextApiKeyName = 'Authorization';
          nextApiKeyValue = apiKeyMatch[1].trim();
          hasAuth = true;
          return;
        }

        // Esquema desconhecido → mantém como header customizado
        nextHeaders.push(header);
        return;
      }

      if (headerName === 'auth-token') {
        nextAuthType = 'custom';
        nextAuthToken = header.value;
        hasAuth = true;
        return;
      }

      if (headerName === 'x-chave-key') {
        nextAuthType = 'custom';
        nextXChaveKey = header.value;
        hasAuth = true;
        return;
      }

      if (headerName === 'x-secret-key') {
        nextAuthType = 'custom';
        nextXSecretKey = header.value;
        hasAuth = true;
        return;
      }

      nextHeaders.push(header);
    });

    // -u / --user sobrescreve Authorization: Basic
    if (parsedCurl.basicAuth) {
      nextAuthType = 'basic';
      nextBasicUsername = parsedCurl.basicAuth.username;
      nextBasicPassword = parsedCurl.basicAuth.password;
      hasAuth = true;
    }

    // Pretty-print body JSON quando possível
    let formattedBody = parsedCurl.body;
    if (formattedBody) {
      try {
        formattedBody = JSON.stringify(JSON.parse(formattedBody), null, 2);
      } catch {
        // não é JSON válido — mantém original
      }
    }

    const hasBody = Boolean(formattedBody);

    // Aplicar todos os campos
    setMethod(parsedCurl.method || 'GET');

    if (parsedCurl.url) {
      setUrl(parsedCurl.url);
      try {
        const importedUrl = new URL(parsedCurl.url);
        const pageParam = importedUrl.searchParams.get('page');
        if (pageParam) setPages(pageParam);
      } catch {
        const pageMatch = parsedCurl.url.match(/[?&]page=(\d+)/);
        if (pageMatch) setPages(pageMatch[1]);
      }
    }

    setBody(formattedBody);
    setCustomHeaders(nextHeaders);
    setAuthType(nextAuthType);
    setAuthToken(nextAuthToken);
    setXChaveKey(nextXChaveKey);
    setXSecretKey(nextXSecretKey);
    setBasicUsername(nextBasicUsername);
    setBasicPassword(nextBasicPassword);

    if (nextApiKeyValue) {
      setApiKeyName(nextApiKeyName);
      setApiKeyValue(nextApiKeyValue);
      setApiKeyLocation('header');
    }

    // Abrir Builder na aba mais relevante
    setActiveScreen('builder');
    if (hasAuth) {
      setRequestConfigTab('auth');
    } else if (hasBody) {
      setRequestConfigTab('body');
    } else if (nextHeaders.length > 0) {
      setRequestConfigTab('headers');
    } else {
      setRequestConfigTab('params');
    }

    // Mensagem de resumo
    const detected: string[] = [];
    if (hasAuth) detected.push(`auth (${nextAuthType})`);
    if (hasBody) detected.push('body');
    if (nextHeaders.length > 0) detected.push(`${nextHeaders.length} header(s)`);
    if (parsedCurl.url) {
      try {
        const u = new URL(parsedCurl.url);
        const paramCount = Array.from(u.searchParams.keys()).length;
        if (paramCount > 0) detected.push(`${paramCount} query param(s)`);
      } catch { /* ignore */ }
    }

    const method = parsedCurl.method || 'GET';
    const urlLabel = parsedCurl.url || '(sem URL)';
    setCurlImportMessage(
      `${method} ${urlLabel}${detected.length ? ' · ' + detected.join(', ') : ''}`
    );
  };

  const handleSendRequest = async () => {
    if (isLoading) return;

    let resolvedUrl: string;
    try {
      resolvedUrl = applyEnvVars(url);
      new URL(resolvedUrl);
    } catch {
      setResponse('Erro: informe uma URL valida antes de enviar.');
      setResponseMeta({ status: null, elapsedMs: null, sizeBytes: null, error: 'Informe uma URL valida antes de enviar.' });
      return;
    }

    const unresolvedVar = resolvedUrl.match(/\{\{[\w-]+\}\}/);
    if (unresolvedVar) {
      const msg = `Variável de ambiente não definida: ${unresolvedVar[0]}. Configure-a em Ambientes ou substitua na URL.`;
      setResponse(`Erro: ${msg}`);
      setResponseMeta({ status: null, elapsedMs: null, sizeBytes: null, error: msg });
      return;
    }

    const parsedPages = parsePages(pages);
    if (!parsedPages.ok) {
      setResponse(`Erro: ${parsedPages.message}`);
      setResponseMeta({ status: null, elapsedMs: null, sizeBytes: null, error: parsedPages.message });
      return;
    }

    const parsedBody = parseJsonBody(applyEnvVars(body));
    if (!parsedBody.ok) {
      setResponse(`Erro: ${parsedBody.message}`);
      setResponseMeta({ status: null, elapsedMs: null, sizeBytes: null, error: parsedBody.message });
      return;
    }

    setIsLoading(true);
    setResponseData(null);
    setLastResponseHeaders({});
    setResponse('Enviando...');
    setResponseMeta(null);
    setFilterText('');
    setFilterField('');
    const startedAt = performance.now();
    
    // Parsing simples de páginas (ex: "1,2,3" ou "1-3")
    try {
      const results = [];
      for (const page of parsedPages.pages) {
          const pageUrl = applyAuthToUrl(resolvedUrl.replace(/page=\d+/, `page=${page}`));
          
          // Montar headers incluindo customizáveis (apenas se preenchidos)
          const requestHeaders: any = getRequestHeaders();
          
          if (authType === 'custom' && authToken) requestHeaders['Auth-token'] = applyEnvVars(authToken);
          if (authType === 'custom' && xChaveKey) requestHeaders['X-Chave-Key'] = applyEnvVars(xChaveKey);
          if (authType === 'custom' && xSecretKey) requestHeaders['X-Secret-Key'] = applyEnvVars(xSecretKey);

          // Adicionar headers customizáveis
          customHeaders.forEach((h: any) => {
            if (h.key && h.value) {
              requestHeaders[applyEnvVars(h.key)] = applyEnvVars(h.value);
            }
          });
          
          const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: pageUrl, 
              method,
              headers: requestHeaders,
              body: parsedBody.data
            }),
          });
          const data = await res.json();
          results.push({ page, status: data.status, data: data.data });
          if (results.length === 1) setLastResponseHeaders(data.headers || {});
      }
      const responseText = JSON.stringify(results, null, 2);
      const statuses = Array.from(new Set(results.map((result: any) => result.status).filter(Boolean)));
      const elapsedMs = Math.round(performance.now() - startedAt);
      const finalStatus = statuses.length === 1 ? Number(statuses[0]) : null;
      setResponseData(results);
      setResponse(responseText);
      setResponseMeta({
        status: finalStatus,
        elapsedMs,
        sizeBytes: new Blob([responseText]).size,
      });
      saveHistoryEntry({
        id: Date.now(),
        method,
        url: resolvedUrl,
        status: finalStatus,
        elapsedMs,
        executedAt: new Date().toISOString(),
        envName: activeEnvId ? (environments.find(e => e.id === activeEnvId)?.name ?? null) : null,
        success: true,
        requestSnapshot: { method, url, authType, authToken, xChaveKey, xSecretKey, basicUsername, basicPassword, apiKeyName, apiKeyValue, apiKeyLocation, pages, body, customHeaders: [...customHeaders] },
      });
      if (loadedRequestId !== null) {
        setSavedRequests(prev => {
          const updated = prev.map(r => r.id === loadedRequestId ? { ...r, lastExecutedAt: new Date().toISOString() } : r);
          localStorage.setItem('savedRequests', JSON.stringify(updated));
          return updated;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const elapsedMs = Math.round(performance.now() - startedAt);
      setResponse(`Erro: ${message}`);
      setResponseMeta({
        status: null,
        elapsedMs,
        sizeBytes: null,
        error: message,
      });
      saveHistoryEntry({
        id: Date.now(),
        method,
        url: resolvedUrl,
        status: null,
        elapsedMs,
        executedAt: new Date().toISOString(),
        envName: activeEnvId ? (environments.find(e => e.id === activeEnvId)?.name ?? null) : null,
        success: false,
        error: message,
        requestSnapshot: { method, url, authType, authToken, xChaveKey, xSecretKey, basicUsername, basicPassword, apiKeyName, apiKeyValue, apiKeyLocation, pages, body, customHeaders: [...customHeaders] },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const hasActiveResponseFilter = Boolean(responseData && filterField && filterText);
  const displayedJsonResponse = hasActiveResponseFilter
    ? JSON.stringify(filteredData, null, 2)
    : response;

  const copyResponse = async () => {
    if (!displayedJsonResponse) return;

    try {
      await navigator.clipboard.writeText(displayedJsonResponse);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = displayedJsonResponse;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedResponse(true);
    window.setTimeout(() => setCopiedResponse(false), 1800);
  };

  const clearResponse = () => {
    setResponseData(null);
    setResponse(null);
    setResponseMeta(null);
    setFilterField('');
    setFilterText('');
    setFilteredData([]);
    setCopiedResponse(false);
    setLastResponseHeaders({});
    setResponseTab('body');
    setJsonSearch('');
  };

  const hasResponseContent = Boolean(response || responseData || responseMeta || isLoading);
  const tableRows: Record<string, string>[] = filteredData.map((item) => flattenTableRow(item));
  const tableColumns: string[] = Array.from(new Set<string>(tableRows.flatMap((row) => Object.keys(row))));
  const parsedCookies: [string, string][] = (() => {
    const raw = lastResponseHeaders['set-cookie'] || '';
    if (!raw) return [];
    return raw.split(',').map(c => {
      const first = c.trim().split(';')[0].trim();
      const idx = first.indexOf('=');
      if (idx === -1) return null;
      return [first.slice(0, idx).trim(), first.slice(idx + 1).trim()] as [string, string];
    }).filter((x): x is [string, string] => x !== null);
  })();

  const renderCollectionRequestRow = (req: any) => (
    <div key={req.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
      <span className={`px-2 py-0.5 rounded text-xs font-bold min-w-[58px] text-center shrink-0 border ${
        req.method === 'GET' ? 'bg-green-50 text-green-700 border-green-200' :
        req.method === 'POST' ? 'bg-blue-50 text-blue-700 border-blue-200' :
        req.method === 'PATCH' ? 'bg-purple-50 text-purple-700 border-purple-200' :
        req.method === 'PUT' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
        req.method === 'DELETE' ? 'bg-red-50 text-red-700 border-red-200' :
        'bg-gray-50 text-gray-700 border-gray-200'
      }`}>{req.method}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-[#111827] truncate">{req.name}</div>
        <div className="text-xs text-[#6B7280] font-mono truncate">{req.url}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={req.collectionId || ''}
          onChange={(e) => moveRequestToCollection(req.id, e.target.value || null)}
          className="h-8 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-2 text-xs text-[#6B7280] focus:border-[#2563EB] focus:outline-none cursor-pointer"
          title="Mover para coleção"
        >
          <option value="">Sem coleção</option>
          {collections.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setMethod(req.method);
            setUrl(req.url);
            setAuthType(req.authType || 'custom');
            setAuthToken(req.authToken || '');
            setXChaveKey(req.xChaveKey || '');
            setXSecretKey(req.xSecretKey || '');
            setBasicUsername(req.basicUsername || '');
            setBasicPassword(req.basicPassword || '');
            setApiKeyName(req.apiKeyName || '');
            setApiKeyValue(req.apiKeyValue || '');
            setApiKeyLocation(req.apiKeyLocation || 'header');
            setPages(req.pages || '1');
            setBody(req.body || '');
            setRequestName(req.name);
            setLoadedRequestId(req.id);
            setActiveScreen('builder');
          }}
          className="px-3 py-1.5 rounded-lg bg-[#EFF6FF] text-[#2563EB] text-xs font-bold border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
        >
          Carregar
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-[#111827] font-sans flex">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-60' : 'w-16'} bg-[#FFFFFF] border-r border-[#E5E7EB] flex flex-col transition-all duration-300 shadow-sm shrink-0`}>
        <div className={`flex items-center border-b border-[#E5E7EB] ${isSidebarOpen ? 'px-4 py-3 justify-between' : 'p-3 justify-center'}`}>
          {isSidebarOpen && (
            <div>
              <h1 className="text-base font-bold text-[#2563EB] tracking-wide">ApiFlow</h1>
              <p className="text-[10px] text-[#9CA3AF] font-mono">v2.4.0</p>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB]/40 hover:bg-[#F5F7FA] transition-colors shrink-0">
            {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>

        {isSidebarOpen ? (
          <>
            <button
              onClick={openNewRequest}
              className="mx-3 mt-3 mb-2 py-2.5 px-4 rounded-xl bg-[#2563EB] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm hover:bg-[#1D4ED8] transition-colors"
            >
              <Plus size={15} /> Nova Requisição
            </button>
            <nav className="flex-1 px-2 pb-4 overflow-y-auto">
              {/* Grupo 1: início e importação */}
              <div className="space-y-0.5">
                {[
                  { id: 'dashboard', name: 'Início', icon: Terminal },
                  { id: 'swagger', name: 'Importar Swagger', icon: Layers },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveScreen(item.id as ActiveScreen)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                      activeScreen === item.id
                        ? 'bg-[#EFF6FF] text-[#2563EB] font-semibold'
                        : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F7FA]'
                    }`}
                  >
                    <item.icon size={16} className="shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
              </div>
              {/* Grupo 2: organização */}
              <div className="mt-2 pt-2 border-t border-[#F3F4F6] space-y-0.5">
                {[
                  { id: 'saved', name: 'Req. Salvas', icon: History },
                  { id: 'collections', name: 'Coleções', icon: Folder },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveScreen(item.id as ActiveScreen)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                      activeScreen === item.id
                        ? 'bg-[#EFF6FF] text-[#2563EB] font-semibold'
                        : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F7FA]'
                    }`}
                  >
                    <item.icon size={16} className="shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
              </div>
              {/* Grupo 3: ferramentas */}
              <div className="mt-2 pt-2 border-t border-[#F3F4F6] space-y-0.5">
                {[
                  { id: 'history', name: 'Histórico', icon: History },
                  { id: 'environments', name: 'Ambientes', icon: Layers },
                  { id: 'settings', name: 'Configurações', icon: Settings },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveScreen(item.id as ActiveScreen)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                      activeScreen === item.id
                        ? 'bg-[#EFF6FF] text-[#2563EB] font-semibold'
                        : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F7FA]'
                    }`}
                  >
                    <item.icon size={16} className="shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
              </div>
            </nav>
          </>
        ) : (
          <nav className="flex-1 flex flex-col items-center py-3 px-1.5 overflow-y-auto">
            <button
              onClick={openNewRequest}
              className="w-10 h-10 rounded-xl bg-[#2563EB] text-white flex items-center justify-center shadow-sm hover:bg-[#1D4ED8] transition-colors mb-1"
              title="Nova Requisição"
            >
              <Plus size={18} />
            </button>
            {/* Grupo 1 */}
            <div className="flex flex-col items-center gap-1 mt-1">
              {[
                { id: 'dashboard', name: 'Início', icon: Terminal },
                { id: 'swagger', name: 'Importar Swagger', icon: Layers },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveScreen(item.id as ActiveScreen)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    activeScreen === item.id
                      ? 'bg-[#EFF6FF] text-[#2563EB]'
                      : 'text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F5F7FA]'
                  }`}
                  title={item.name}
                >
                  <item.icon size={18} />
                </button>
              ))}
            </div>
            {/* Grupo 2 */}
            <div className="flex flex-col items-center gap-1 mt-3 pt-3 border-t border-[#F3F4F6] w-full">
              {[
                { id: 'saved', name: 'Req. Salvas', icon: History },
                { id: 'collections', name: 'Coleções', icon: Folder },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveScreen(item.id as ActiveScreen)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    activeScreen === item.id
                      ? 'bg-[#EFF6FF] text-[#2563EB]'
                      : 'text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F5F7FA]'
                  }`}
                  title={item.name}
                >
                  <item.icon size={18} />
                </button>
              ))}
            </div>
            {/* Grupo 3 */}
            <div className="flex flex-col items-center gap-1 mt-3 pt-3 border-t border-[#F3F4F6] w-full">
              {[
                { id: 'history', name: 'Histórico', icon: History },
                { id: 'environments', name: 'Ambientes', icon: Layers },
                { id: 'settings', name: 'Configurações', icon: Settings },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveScreen(item.id as ActiveScreen)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    activeScreen === item.id
                      ? 'bg-[#EFF6FF] text-[#2563EB]'
                      : 'text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F5F7FA]'
                  }`}
                  title={item.name}
                >
                  <item.icon size={18} />
                </button>
              ))}
            </div>
          </nav>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-[#E5E7EB] bg-[#FFFFFF] flex items-center justify-between px-6 shadow-sm shrink-0">
          <div className="relative w-64 hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
            <input className="w-full bg-[#F5F7FA] border border-[#E5E7EB] rounded-lg py-2 pl-9 pr-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10" placeholder="Buscar..." />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#9CA3AF] font-medium hidden md:block">Ambiente:</span>
              <select
                value={activeEnvId || ''}
                onChange={(e) => setActiveEnvironment(e.target.value || null)}
                className="h-8 bg-[#F5F7FA] border border-[#E5E7EB] rounded-lg px-2.5 text-xs text-[#111827] focus:border-[#2563EB] focus:outline-none cursor-pointer"
              >
                <option value="">Nenhum</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
            <button className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB]/40 hover:bg-[#F5F7FA] transition-colors" title="Notificações">
              <Bell size={16} />
            </button>
            <button className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB]/40 hover:bg-[#F5F7FA] transition-colors" title="Ajuda">
              <HelpCircle size={16} />
            </button>
          </div>
        </header>
        <div className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-auto">
          {activeScreen === 'dashboard' && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#EFF6FF] flex items-center justify-center mb-5 shadow-sm">
                <Terminal size={36} className="text-[#2563EB]" />
              </div>
              <h2 className="text-xl font-bold text-[#111827]">Bem-vindo ao ApiFlow</h2>
              <p className="text-sm text-[#6B7280] mt-2 max-w-sm">Crie, teste e organize suas chamadas de API. Comece criando sua primeira requisição.</p>
              <button onClick={openNewRequest} className="mt-6 px-6 py-3 bg-[#2563EB] text-white rounded-xl text-sm font-bold hover:bg-[#1D4ED8] transition-colors shadow-md flex items-center gap-2">
                <Plus size={16} /> Nova Requisição
              </button>
            </div>
          )}
          
          {/* Tela de Importação Swagger */}
          {activeScreen === 'swagger' && (
            <div className="space-y-4 w-full">
              <div>
                <h2 className="text-xl font-bold text-[#111827] flex items-center gap-2">
                  <Layers size={20} className="text-[#2563EB]" /> Importar API via Swagger/OpenAPI
                </h2>
                <p className="text-sm text-[#6B7280] mt-1">Cole a URL do Swagger UI e importe todos os endpoints automaticamente.</p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm p-5">
                <label className="block text-[10px] text-[#6B7280] uppercase font-bold mb-2">URL do Swagger UI</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="flex-1 h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-4 text-sm font-mono text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                    placeholder="https://api.exemplo.com/swagger-ui.html"
                    value={swaggerUrl}
                    onChange={(e) => setSwaggerUrl(e.target.value)}
                  />
                  <button
                    onClick={handleSwaggerImport}
                    disabled={isLoadingSwagger}
                    className="h-11 px-6 bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:shadow-md active:scale-[0.98] transition-all shadow-sm shrink-0"
                  >
                    {isLoadingSwagger ? 'Carregando...' : 'Importar API'}
                  </button>
                </div>

                {swaggerFeedback && (
                  <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium ${
                    swaggerFeedback.ok
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}>
                    {swaggerFeedback.ok ? <Check size={13} className="mt-px shrink-0" /> : <X size={13} className="mt-px shrink-0" />}
                    {swaggerFeedback.message}
                  </div>
                )}

                {swaggerEndpoints.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-3 gap-4">
                      <span className="text-sm font-semibold text-[#111827] shrink-0">
                        {filteredEndpoints.length} endpoint(s){methodFilter !== 'ALL' && ` · ${methodFilter}`}
                      </span>
                      <span className="text-[11px] text-[#9CA3AF] font-mono truncate">{swaggerBaseUrl}</span>
                    </div>

                    <div className="mb-3 flex gap-1.5 flex-wrap">
                      {availableMethods.map((methodType) => (
                        <button
                          key={methodType}
                          onClick={() => setMethodFilter(methodType)}
                          className={`h-7 px-3 rounded-full text-xs font-bold transition-colors border ${
                            methodFilter === methodType
                              ? methodType === 'ALL' ? 'bg-[#2563EB] text-white border-[#2563EB]'
                              : methodType === 'GET' ? 'bg-green-600 text-white border-green-600'
                              : methodType === 'POST' ? 'bg-blue-600 text-white border-blue-600'
                              : methodType === 'PATCH' ? 'bg-purple-600 text-white border-purple-600'
                              : methodType === 'PUT' ? 'bg-yellow-500 text-white border-yellow-500'
                              : 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#2563EB] hover:text-[#2563EB]'
                          }`}
                        >
                          {methodType}
                        </button>
                      ))}
                    </div>

                    <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                      <div className="max-h-[32rem] overflow-y-auto divide-y divide-[#E5E7EB]">
                        {filteredEndpoints.map((endpoint, idx) => (
                          <div
                            key={idx}
                            onClick={() => { applyEndpoint(endpoint); setActiveScreen('builder'); }}
                            className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-colors ${
                              selectedEndpoint === endpoint
                                ? 'bg-[#EFF6FF]'
                                : 'bg-white hover:bg-[#F9FAFB]'
                            }`}
                          >
                            <span className={`px-2 py-0.5 rounded text-xs font-bold min-w-[58px] text-center border shrink-0 ${
                              endpoint.method === 'GET' ? 'bg-green-50 text-green-700 border-green-200' :
                              endpoint.method === 'POST' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              endpoint.method === 'PATCH' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                              endpoint.method === 'PUT' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                              endpoint.method === 'DELETE' ? 'bg-red-50 text-red-700 border-red-200' :
                              'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>{endpoint.method}</span>
                            <span className="text-sm font-mono flex-1 text-[#2563EB] truncate">{endpoint.path}</span>
                            <span className="text-xs text-[#9CA3AF] w-56 truncate hidden md:block text-right">{endpoint.summary}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {swaggerEndpoints.length > 0 && (
                <button
                  onClick={saveCurrentApi}
                  className="w-full h-10 bg-white border border-[#E5E7EB] rounded-xl font-bold text-sm text-[#374151] flex items-center justify-center gap-2 hover:bg-[#F9FAFB] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
                >
                  <Plus size={15} /> Salvar esta API
                </button>
              )}

              {savedApis.length > 0 && (
                <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#E5E7EB]">
                    <h3 className="text-sm font-bold text-[#111827]">APIs Salvas <span className="text-[#9CA3AF] font-normal">({savedApis.length})</span></h3>
                  </div>
                  <div className="divide-y divide-[#E5E7EB] max-h-64 overflow-y-auto">
                    {savedApis.map((api) => (
                      <div key={api.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-[#111827] truncate">{api.name}</div>
                          <div className="text-xs text-[#9CA3AF] truncate">{api.baseUrl} · {api.endpoints.length} endpoints</div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => loadSavedApi(api)}
                            className="h-8 px-3 rounded-lg bg-[#EFF6FF] text-[#2563EB] text-xs font-bold border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
                          >
                            Carregar
                          </button>
                          <button
                            onClick={() => deleteSavedApi(api.id)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg bg-white border border-[#E5E7EB] text-[#6B7280] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] p-4">
                <p className="text-xs font-semibold text-[#374151] mb-2">Como funciona</p>
                <ul className="text-xs text-[#6B7280] space-y-1.5">
                  <li>· Cole a URL do Swagger UI ou do JSON OpenAPI diretamente</li>
                  <li>· O sistema detecta e lista todos os endpoints com método e rota</li>
                  <li>· Clique em qualquer endpoint para abrir no Builder já preenchido</li>
                </ul>
              </div>
            </div>
          )}
          
          {activeScreen === 'saved' && (
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
                <div>
                  <h2 className="text-base font-bold text-[#111827]">Requisições Salvas</h2>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">{savedRequests.length} requisição(ões) · ordenadas pela última execução</p>
                </div>
                <button onClick={openNewRequest} className="h-8 px-3 rounded-lg bg-[#2563EB] text-white text-xs font-bold hover:bg-[#1D4ED8] transition-colors shadow-sm flex items-center gap-1.5">
                  <Plus size={13} /> Nova
                </button>
              </div>
              <div className="px-5 py-3 border-b border-[#E5E7EB]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
                  <input
                    className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg py-2 pl-9 pr-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                    placeholder="Buscar por nome ou URL..."
                    value={savedSearch}
                    onChange={(e) => setSavedSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="divide-y divide-[#E5E7EB]">
                {savedRequests.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mb-3">
                      <History size={24} className="text-[#9CA3AF]" />
                    </div>
                    <p className="text-sm font-semibold text-[#374151]">Nenhuma requisição salva</p>
                    <p className="text-xs text-[#9CA3AF] mt-1">Clique em "Salvar" no Builder para começar.</p>
                    <button onClick={openNewRequest} className="mt-4 h-8 px-4 bg-[#2563EB] text-white rounded-lg text-xs font-bold hover:bg-[#1D4ED8] transition-colors shadow-sm">
                      Nova Requisição
                    </button>
                  </div>
                )}
                {(() => {
                  const filtered = savedRequests.filter(req =>
                    !savedSearch ||
                    req.name.toLowerCase().includes(savedSearch.toLowerCase()) ||
                    req.url.toLowerCase().includes(savedSearch.toLowerCase())
                  );
                  const sorted = [...filtered].sort((a, b) => {
                    if (!a.lastExecutedAt && !b.lastExecutedAt) return 0;
                    if (!a.lastExecutedAt) return 1;
                    if (!b.lastExecutedAt) return -1;
                    return new Date(b.lastExecutedAt).getTime() - new Date(a.lastExecutedAt).getTime();
                  });
                  if (sorted.length === 0 && savedSearch) {
                    return (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Search size={24} className="text-[#D1D5DB] mb-3" />
                        <p className="text-sm font-semibold text-[#374151]">Nenhum resultado</p>
                        <p className="text-xs text-[#9CA3AF] mt-1">Tente um termo diferente.</p>
                      </div>
                    );
                  }
                  return sorted.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#F9FAFB] transition-colors">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold min-w-[58px] text-center shrink-0 border ${
                        req.method === 'GET' ? 'bg-green-50 text-green-700 border-green-200' :
                        req.method === 'POST' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        req.method === 'PATCH' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        req.method === 'PUT' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                        req.method === 'DELETE' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-gray-50 text-gray-700 border-gray-200'
                      }`}>{req.method}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-[#111827] truncate">{req.name}</div>
                        <div className="text-xs text-[#6B7280] font-mono truncate">{req.url}</div>
                        {req.lastExecutedAt && (
                          <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                            {new Date(req.lastExecutedAt).toLocaleString('pt-BR')}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            setMethod(req.method);
                            setUrl(req.url);
                            setAuthType(req.authType || 'custom');
                            setAuthToken(req.authToken);
                            setXChaveKey(req.xChaveKey);
                            setXSecretKey(req.xSecretKey);
                            setBasicUsername(req.basicUsername || '');
                            setBasicPassword(req.basicPassword || '');
                            setApiKeyName(req.apiKeyName || '');
                            setApiKeyValue(req.apiKeyValue || '');
                            setApiKeyLocation(req.apiKeyLocation || 'header');
                            setPages(req.pages);
                            setBody(req.body);
                            setRequestName(req.name);
                            setLoadedRequestId(req.id);
                            setActiveScreen('builder');
                          }}
                          className="h-8 px-3 rounded-lg bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE] text-xs font-bold hover:bg-[#DBEAFE] transition-colors"
                        >
                          Carregar
                        </button>
                        <button
                          onClick={() => duplicateSavedRequest(req)}
                          className="h-8 w-8 rounded-lg bg-white border border-[#E5E7EB] text-[#6B7280] flex items-center justify-center hover:bg-[#F5F7FA] hover:text-[#111827] transition-colors"
                          title="Duplicar"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          onClick={() => deleteSavedRequest(req.id)}
                          className="h-8 w-8 rounded-lg bg-white border border-[#E5E7EB] text-[#6B7280] flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                          title="Remover"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
          {activeScreen === 'builder' && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[#111827]">{loadedRequestId ? requestName || 'Requisição' : 'Nova Requisição'}</h2>
                    <p className="text-xs text-[#9CA3AF]">Monte e envie chamadas HTTP rapidamente.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {savedRequestFeedback && (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
                        <Check size={12} /> Salva!
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveRequest}
                      className="h-8 px-3 rounded-lg text-xs font-bold border border-[#E5E7EB] text-[#374151] bg-white hover:bg-[#F5F7FA] hover:border-[#2563EB]/40 hover:text-[#2563EB] transition-colors"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCodeModal(true)}
                      className="h-8 px-3 rounded-lg text-xs font-bold border border-[#E5E7EB] text-[#374151] bg-white hover:bg-[#F5F7FA] hover:border-[#2563EB]/40 hover:text-[#2563EB] transition-colors flex items-center gap-1.5"
                    >
                      <Code size={13} /> Código
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative w-full lg:w-36">
                    <select
                      className={`h-12 w-full appearance-none bg-[#F9FAFB] border rounded-xl py-0 pl-3 pr-10 text-sm font-bold focus:outline-none focus:ring-2 transition-colors ${
                        method === 'GET'    ? 'text-green-700  border-green-200  focus:border-green-400  focus:ring-green-100' :
                        method === 'POST'   ? 'text-blue-700   border-blue-200   focus:border-blue-400   focus:ring-blue-100' :
                        method === 'PATCH'  ? 'text-purple-700 border-purple-200 focus:border-purple-400 focus:ring-purple-100' :
                        method === 'PUT'    ? 'text-yellow-700 border-yellow-200 focus:border-yellow-400 focus:ring-yellow-100' :
                        method === 'DELETE' ? 'text-red-700    border-red-200    focus:border-red-400    focus:ring-red-100' :
                        'text-[#2563EB] border-[#E5E7EB] focus:border-[#2563EB] focus:ring-[#2563EB]/10'
                      }`}
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option>GET</option>
                      <option>POST</option>
                      <option>PATCH</option>
                      <option>PUT</option>
                      <option>DELETE</option>
                    </select>
                    <ChevronDown className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${
                      method === 'GET' ? 'text-green-700' : method === 'POST' ? 'text-blue-700' :
                      method === 'PATCH' ? 'text-purple-700' : method === 'PUT' ? 'text-yellow-700' :
                      method === 'DELETE' ? 'text-red-700' : 'text-[#2563EB]'
                    }`} size={14} />
                  </div>
                  <input
                    className="h-12 flex-1 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-4 text-sm font-mono text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                    name="apiflow_request_url"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="https://api.exemplo.com/recurso"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleSendRequest}
                    disabled={isLoading}
                    className="h-12 w-full lg:w-auto lg:min-w-[120px] bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white rounded-xl px-6 text-sm font-bold shadow-md hover:shadow-lg hover:from-[#1D4ED8] hover:to-[#1E40AF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Enviando...
                      </>
                    ) : 'Enviar'}
                  </button>
                </div>

                <div className="mt-4 max-w-md">
                  <label className="mb-1 block text-[10px] font-bold uppercase text-[#6B7280]">Nome da requisição</label>
                  <input
                    className="h-10 w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-xs text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                    name="apiflow_request_label"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Nome da requisicao"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                  />
                </div>
                <div className="mt-5 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
                  <div className="flex overflow-x-auto border-b border-[#E5E7EB] bg-[#F9FAFB] px-3">
                    {[
                      { id: 'auth', label: 'Auth' },
                      { id: 'headers', label: 'Headers' },
                      { id: 'params', label: 'Params' },
                      { id: 'body', label: 'Body' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setRequestConfigTab(tab.id as RequestConfigTab)}
                        className={`h-10 px-3 text-xs font-semibold border-b-2 transition-colors ${
                          requestConfigTab === tab.id
                            ? 'border-[#2563EB] text-[#2563EB]'
                            : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                <div className="p-4 pt-3">
                  {requestConfigTab === 'params' && (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr]">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-[#6B7280] uppercase font-bold">Paginas</label>
                        <input
                          className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                          name="apiflow_pages"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          placeholder="1 ou 1-3"
                          value={pages}
                          onChange={(e) => setPages(e.target.value)}
                        />
                        <p className="text-[11px] leading-4 text-[#6B7280]">
                          Use 1, 1,2,3 ou 1-3. A URL precisa ter o parametro page= para paginar; sem ele, a mesma URL sera chamada novamente.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-[#6B7280] uppercase font-bold">Importar cURL</label>
                        <div className="flex flex-col gap-3 md:flex-row md:items-start">
                          <textarea
                            className="min-h-24 flex-1 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 text-xs font-mono text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                            name="apiflow_curl_import"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            placeholder="Cole um comando cURL para preencher metodo, URL e autenticacao"
                            value={curlInput}
                            onChange={(e) => {
                              setCurlInput(e.target.value);
                              setCurlImportMessage('');
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleCurlImport}
                            className="h-9 shrink-0 self-start bg-[#EFF6FF] text-[#2563EB] px-4 rounded-lg text-xs font-bold border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
                          >
                            Importar
                          </button>
                        </div>
                        {curlImportMessage && (
                          <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
                            <Check size={14} className="mt-0.5 shrink-0" />
                            <span className="break-all">{curlImportMessage}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {requestConfigTab === 'headers' && (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={addCustomHeader}
                          className="h-8 bg-[#EFF6FF] text-[#2563EB] px-3 rounded-lg text-xs font-bold border border-[#BFDBFE] flex items-center gap-1.5 hover:bg-[#DBEAFE] transition-colors"
                        >
                          <Plus size={13} /> Header
                        </button>
                      </div>
                      <div className="space-y-2">
                        {customHeaders.map((header, index) => (
                          <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto] md:items-center">
                            <input
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name={`apiflow_header_key_${index}`}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="Nome"
                              value={header.key}
                              onChange={(e) => updateCustomHeader(index, 'key', e.target.value)}
                            />
                            <input
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name={`apiflow_header_value_${index}`}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="Valor"
                              value={header.value}
                              onChange={(e) => updateCustomHeader(index, 'value', e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => removeCustomHeader(index)}
                              className="h-11 w-11 flex items-center justify-center rounded-xl bg-white border border-[#E5E7EB] text-[#9CA3AF] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                              aria-label="Remover header"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                          {customHeaders.length === 0 && (
                          <div className="bg-[#F9FAFB] border border-dashed border-[#D1D5DB] rounded-xl py-8 text-center">
                            <p className="text-xs font-semibold text-[#374151]">Nenhum header adicionado</p>
                            <p className="text-[11px] text-[#9CA3AF] mt-0.5">Clique em "+ Header" para adicionar.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {requestConfigTab === 'auth' && (
                    <div className="w-full space-y-4">
                      <div className="flex w-fit flex-wrap gap-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
                        {[
                          { id: 'custom', label: 'Custom' },
                          { id: 'apiKey', label: 'API Key' },
                          { id: 'basic', label: 'Basic' },
                          { id: 'bearer', label: 'Bearer' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setAuthType(item.id as AuthType)}
                            className={`px-3 py-1.5 rounded text-xs font-bold ${
                              authType === item.id
                                ? 'bg-[#2563EB] text-white'
                                : 'text-[#6B7280] hover:text-[#111827] hover:bg-white'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {authType === 'none' && (
                        <div className="bg-[#F9FAFB] border border-dashed border-[#D1D5DB] rounded-xl px-5 py-6 flex items-center gap-3">
                          <EyeOff size={16} className="text-[#D1D5DB] shrink-0" />
                          <span className="text-xs text-[#6B7280]">Nenhuma autenticação será enviada nesta requisição.</span>
                        </div>
                      )}

                      {authType === 'bearer' && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-[#6B7280] uppercase font-bold">Bearer Token</label>
                          <input
                            type="password"
                            className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                            name="apiflow_bearer_secret"
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            placeholder="Token"
                            value={authToken}
                            onChange={(e) => setAuthToken(e.target.value)}
                          />
                        </div>
                      )}

                      {authType === 'basic' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[#6B7280] uppercase font-bold">Usuario</label>
                            <input
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name="apiflow_basic_user"
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="Usuario"
                              value={basicUsername}
                              onChange={(e) => setBasicUsername(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[#6B7280] uppercase font-bold">Senha</label>
                            <input
                              type="password"
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name="apiflow_basic_secret"
                              autoComplete="new-password"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="Senha"
                              value={basicPassword}
                              onChange={(e) => setBasicPassword(e.target.value)}
                            />
                          </div>
                        </div>
                      )}

                      {authType === 'apiKey' && (
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[#6B7280] uppercase font-bold">Nome</label>
                            <input
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name="apiflow_api_key_name"
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="X-API-Key"
                              value={apiKeyName}
                              onChange={(e) => setApiKeyName(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[#6B7280] uppercase font-bold">Valor</label>
                            <input
                              type="password"
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              name="apiflow_api_key_secret"
                              autoComplete="new-password"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="Valor"
                              value={apiKeyValue}
                              onChange={(e) => setApiKeyValue(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[#6B7280] uppercase font-bold">Local</label>
                            <select
                              className="h-11 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                              value={apiKeyLocation}
                              onChange={(e) => setApiKeyLocation(e.target.value as ApiKeyLocation)}
                            >
                              <option value="header">Header</option>
                              <option value="query">Query</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {authType === 'custom' && (
                        <div className="space-y-3">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setShowCustomSecrets((current) => !current)}
                              className="bg-[#EFF6FF] text-[#2563EB] px-3 py-1.5 rounded-lg text-xs border border-[#BFDBFE] flex items-center gap-1.5 hover:bg-[#DBEAFE]"
                            >
                              {showCustomSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
                              {showCustomSecrets ? 'Ocultar chaves' : 'Mostrar chaves'}
                            </button>
                          </div>
                          <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-[#6B7280] uppercase font-bold">Auth-token</label>
                              <input
                                type={showCustomSecrets ? 'text' : 'password'}
                                className="h-10 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm font-mono text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                                name="apiflow_custom_auth_token"
                                autoComplete="new-password"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder="Auth-token"
                                value={authToken}
                                onChange={(e) => setAuthToken(e.target.value)}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-[#6B7280] uppercase font-bold">X-Chave-Key</label>
                              <input
                                type={showCustomSecrets ? 'text' : 'password'}
                                className="h-10 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm font-mono text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                                name="apiflow_x_chave_key_secret"
                                autoComplete="new-password"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder="X-Chave-Key"
                                value={xChaveKey}
                                onChange={(e) => setXChaveKey(e.target.value)}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-[#6B7280] uppercase font-bold">X-Secret-Key</label>
                              <input
                                type={showCustomSecrets ? 'text' : 'password'}
                                className="h-10 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 text-sm font-mono text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                                name="apiflow_x_secret_key_secret"
                                autoComplete="new-password"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder="X-Secret-Key"
                                value={xSecretKey}
                                onChange={(e) => setXSecretKey(e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {requestConfigTab === 'body' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#6B7280] uppercase font-bold">Corpo JSON</label>
                        {body && <span className="text-[10px] text-[#9CA3AF]">{body.length} caracteres</span>}
                      </div>
                      <textarea
                        className="min-h-56 w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 text-xs font-mono text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10 resize-y"
                        name="apiflow_request_body"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder={'{\n  "chave": "valor"\n}'}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm">
                {/* Barra superior: título + badges de status + botões */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-[#E5E7EB]">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-[#111827]">Response</h2>
                      <p className="text-xs text-[#6B7280]">Status e corpo retornado pela API.</p>
                    </div>
                    {(isLoading || responseMeta) && (
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${isLoading ? 'bg-blue-50 text-blue-700 border-blue-200' : responseMeta?.error ? 'bg-red-50 text-red-700 border-red-200' : getStatusTone(responseMeta?.status ?? null)}`}>
                          {isLoading ? 'Enviando...' : responseMeta?.error ? 'Falha' : responseMeta?.status ? `HTTP ${responseMeta.status}` : 'HTTP múltiplo'}
                        </span>
                        {!isLoading && responseMeta && (
                          <>
                            <span className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-xs font-medium text-[#6B7280]">
                              {responseMeta.elapsedMs ?? '-'} ms
                            </span>
                            {responseMeta.sizeBytes !== null && (
                              <span className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-xs font-medium text-[#6B7280]">
                                {formatBytes(responseMeta.sizeBytes)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={copyResponse}
                      disabled={!displayedJsonResponse}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-xs font-bold text-[#2563EB] hover:bg-[#EFF6FF] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {copiedResponse ? <Check size={14} /> : <Copy size={14} />}
                      {copiedResponse ? 'Copiado' : 'Copiar'}
                    </button>
                    <button
                      type="button"
                      onClick={clearResponse}
                      disabled={!hasResponseContent}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-xs font-bold text-[#6B7280] hover:bg-[#F5F7FA] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      Limpar
                    </button>
                  </div>
                </div>

                {/* Barra de abas + controles (só quando há dados) */}
                {!isLoading && responseData && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-5">
                    <div className="flex">
                      {(['body', 'headers', 'cookies'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setResponseTab(tab)}
                          className={`h-10 px-4 text-xs font-semibold border-b-2 transition-colors ${
                            responseTab === tab
                              ? 'border-[#2563EB] text-[#2563EB]'
                              : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                          }`}
                        >
                          {tab === 'body' && 'Body'}
                          {tab === 'headers' && `Headers (${Object.keys(lastResponseHeaders).length})`}
                          {tab === 'cookies' && `Cookies (${parsedCookies.length})`}
                        </button>
                      ))}
                    </div>
                    {responseTab === 'body' && !responseMeta?.error && (
                      <div className="flex flex-wrap gap-2 items-center py-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" size={13} />
                          <input
                            className="h-8 w-44 bg-white border border-[#E5E7EB] rounded-lg pl-8 pr-3 text-xs text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none"
                            placeholder="Buscar no JSON..."
                            value={jsonSearch}
                            onChange={(e) => setJsonSearch(e.target.value)}
                          />
                        </div>
                        <input
                          className="h-8 w-28 bg-white border border-[#E5E7EB] rounded-lg px-2 text-xs text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none"
                          placeholder="Campo"
                          value={filterField}
                          onChange={(e) => setFilterField(e.target.value)}
                        />
                        <input
                          className="h-8 w-36 bg-white border border-[#E5E7EB] rounded-lg px-2 text-xs text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none"
                          placeholder="Filtro"
                          value={filterText}
                          onChange={(e) => setFilterText(e.target.value)}
                        />
                        <div className="flex gap-1 bg-white p-1 rounded-lg border border-[#E5E7EB]">
                          <button
                            type="button"
                            onClick={() => setViewMode('json')}
                            className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'json' ? 'bg-[#2563EB] text-white' : 'text-[#6B7280] hover:text-[#111827]'}`}
                          >
                            JSON
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'table' ? 'bg-[#2563EB] text-white' : 'text-[#6B7280] hover:text-[#111827]'}`}
                          >
                            Tabela
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Área de conteúdo */}
                {isLoading ? (
                  <div className="min-h-[360px] p-8 bg-[#F9FAFB] rounded-b-2xl flex flex-col items-center justify-center">
                    <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#BFDBFE] border-t-[#2563EB]" />
                    <div className="text-sm font-bold text-[#111827]">Enviando requisição...</div>
                    <div className="mt-1 text-xs text-[#6B7280]">Aguardando resposta da API.</div>
                  </div>
                ) : responseTab === 'body' && responseMeta?.error ? (
                  <div className="min-h-[360px] p-8 bg-red-50 rounded-b-2xl flex flex-col items-center justify-center border-t border-red-100">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-500 border border-red-200 shadow-sm">
                      <X size={26} />
                    </div>
                    <div className="text-sm font-bold text-red-800 mb-1">Não foi possível concluir a requisição</div>
                    <div className="mb-4 text-xs text-red-500 font-medium">
                      {responseMeta.status ? `HTTP ${responseMeta.status}` : 'Falha de conexão'}
                      {responseMeta.elapsedMs !== null && ` · ${responseMeta.elapsedMs} ms`}
                    </div>
                    <div className="max-w-xl w-full bg-white border border-red-200 rounded-xl p-4 text-xs font-mono text-red-700 break-all leading-5">
                      {responseMeta.error}
                    </div>
                  </div>
                ) : responseTab === 'headers' && responseData ? (
                  <div className="min-h-[360px] bg-[#F9FAFB] rounded-b-2xl overflow-auto max-h-[520px]">
                    {Object.keys(lastResponseHeaders).length === 0 ? (
                      <div className="flex min-h-[200px] items-center justify-center text-xs text-[#6B7280]">
                        Nenhum header retornado.
                      </div>
                    ) : (
                      <table className="w-full text-xs text-left text-[#111827]">
                        <thead className="sticky top-0 bg-[#F0F4F8] text-[#6B7280] uppercase shadow-[0_1px_0_#E5E7EB]">
                          <tr>
                            <th className="px-4 py-2.5 font-bold w-56">Header</th>
                            <th className="px-4 py-2.5 font-bold">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(lastResponseHeaders).map(([k, v]) => (
                            <tr key={k} className="border-t border-[#E5E7EB] hover:bg-white">
                              <td className="px-4 py-2 font-mono font-bold text-[#2563EB] align-top whitespace-nowrap">{k}</td>
                              <td className="px-4 py-2 font-mono text-[#374151] break-all align-top">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : responseTab === 'cookies' && responseData ? (
                  <div className="min-h-[360px] bg-[#F9FAFB] rounded-b-2xl overflow-auto max-h-[520px]">
                    {parsedCookies.length === 0 ? (
                      <div className="flex min-h-[200px] items-center justify-center text-xs text-[#6B7280]">
                        Nenhum cookie retornado.
                      </div>
                    ) : (
                      <table className="w-full text-xs text-left text-[#111827]">
                        <thead className="sticky top-0 bg-[#F0F4F8] text-[#6B7280] uppercase shadow-[0_1px_0_#E5E7EB]">
                          <tr>
                            <th className="px-4 py-2.5 font-bold w-48">Nome</th>
                            <th className="px-4 py-2.5 font-bold">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedCookies.map(([name, value], i) => (
                            <tr key={i} className="border-t border-[#E5E7EB] hover:bg-white">
                              <td className="px-4 py-2 font-mono font-bold text-[#2563EB] align-top whitespace-nowrap">{name}</td>
                              <td className="px-4 py-2 font-mono text-[#374151] break-all align-top">{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : responseData && viewMode === 'table' ? (
                  <div className="min-h-[360px] p-4 bg-[#F9FAFB] overflow-auto max-h-[520px] rounded-b-2xl">
                    {tableRows.length > 0 && tableColumns.length > 0 ? (
                      <table className="w-full min-w-max text-xs text-left text-[#111827]">
                        <thead className="sticky top-0 bg-[#F9FAFB] text-[#6B7280] uppercase shadow-[0_1px_0_#E5E7EB]">
                          <tr>
                            {tableColumns.map((column) => (
                              <th key={column} className="max-w-72 px-3 py-2 font-bold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-t border-[#E5E7EB] align-top">
                              {tableColumns.map((column) => (
                                <td key={column} className="max-w-72 px-3 py-2">
                                  <span className="block max-h-24 overflow-auto whitespace-pre-wrap break-words">
                                    {row[column] || ''}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="flex min-h-[320px] items-center justify-center text-center text-xs text-[#6B7280]">
                        Nenhum dado tabular encontrado nesta resposta.
                      </div>
                    )}
                  </div>
                ) : displayedJsonResponse ? (
                  <div className="response-scrollbar min-h-[360px] bg-[#F8FAFC] overflow-auto max-h-[520px] rounded-b-2xl border-t border-[#E5E7EB]">
                    <pre className="m-0 whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-6 text-[#111827]">
                      {jsonSearch.trim()
                        ? displayedJsonResponse.split('\n').map((line, i) => (
                            <span
                              key={i}
                              className={`block ${line.toLowerCase().includes(jsonSearch.toLowerCase()) ? 'bg-yellow-100 rounded' : ''}`}
                            >
                              {renderHighlightedJson(line)}{'\n'}
                            </span>
                          ))
                        : renderHighlightedJson(displayedJsonResponse)}
                    </pre>
                  </div>
                ) : (
                  <div className="min-h-[360px] p-8 bg-[#F9FAFB] rounded-b-2xl flex flex-col items-center justify-center">
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] shadow-sm">
                      <Terminal size={24} />
                    </div>
                    <div className="text-sm font-bold text-[#111827] mb-1">A resposta aparecerá aqui</div>
                    <div className="text-xs text-[#6B7280] mb-5">Configure e envie uma requisição para ver o retorno</div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 justify-center text-xs text-[#9CA3AF]">
                      <span>Status HTTP</span>
                      <span>Tempo de resposta</span>
                      <span>Tamanho</span>
                      <span>Headers</span>
                      <span>Cookies</span>
                      <span>Busca no JSON</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
          {activeScreen === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-2xl font-bold text-[#111827]">Histórico</h2>
                  <p className="text-sm text-[#6B7280] mt-1">Execuções recentes — máximo 100 entradas, ordenadas da mais recente.</p>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-bold border border-red-200 hover:bg-red-100 transition-colors"
                  >
                    <Trash2 size={14} /> Limpar histórico
                  </button>
                )}
              </div>

              {history.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" size={15} />
                  <input
                    className="w-full bg-[#FFFFFF] border border-[#E5E7EB] rounded-xl py-2.5 pl-9 pr-4 text-sm text-[#111827] placeholder:text-[#6B7280] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                    placeholder="Buscar por URL, método ou status..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </div>
              )}

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                {history.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] mx-auto">
                      <History size={24} />
                    </div>
                    <div className="text-sm font-bold text-[#111827]">Nenhuma execução registrada</div>
                    <div className="mt-1 text-xs text-[#6B7280]">Execute requisições no construtor para ver o histórico aqui</div>
                  </div>
                ) : (() => {
                  const filtered = history.filter(entry => {
                    if (!historySearch) return true;
                    const s = historySearch.toLowerCase();
                    return (
                      entry.url.toLowerCase().includes(s) ||
                      entry.method.toLowerCase().includes(s) ||
                      String(entry.status ?? '').includes(s)
                    );
                  });
                  if (filtered.length === 0) {
                    return (
                      <div className="p-8 text-center text-sm text-[#6B7280]">
                        Nenhuma entrada encontrada para "{historySearch}".
                      </div>
                    );
                  }
                  return (
                    <div className="divide-y divide-[#E5E7EB]">
                      {filtered.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-4 p-4 hover:bg-[#F9FAFB] transition-colors">
                          <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-bold min-w-[58px] text-center shrink-0 border ${
                            entry.method === 'GET' ? 'bg-green-50 text-green-700 border-green-200' :
                            entry.method === 'POST' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            entry.method === 'PATCH' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            entry.method === 'PUT' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                            entry.method === 'DELETE' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-gray-50 text-gray-700 border-gray-200'
                          }`}>{entry.method}</span>

                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-sm text-[#111827] truncate">{entry.url}</div>
                            <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#6B7280]">
                              {entry.status !== null ? (
                                <span className={`font-bold ${entry.success ? 'text-green-700' : 'text-red-600'}`}>
                                  HTTP {entry.status}
                                </span>
                              ) : entry.error ? (
                                <span className="font-bold text-red-600">Erro de conexão</span>
                              ) : null}
                              {entry.elapsedMs !== null && (
                                <span>{entry.elapsedMs} ms</span>
                              )}
                              {entry.envName && (
                                <span className="px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#374151] font-medium">{entry.envName}</span>
                              )}
                              <span>{new Date(entry.executedAt).toLocaleString('pt-BR')}</span>
                            </div>
                            {entry.error && (
                              <div className="mt-1 text-xs text-red-500 truncate">{entry.error}</div>
                            )}
                          </div>

                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => loadFromHistory(entry)}
                              className="px-3 py-1.5 rounded-lg bg-[#EFF6FF] text-[#2563EB] text-xs font-bold border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
                            >
                              Carregar
                            </button>
                            <button
                              onClick={() => deleteHistoryEntry(entry.id)}
                              className="h-8 w-8 flex items-center justify-center rounded-lg bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {activeScreen === 'collections' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-2xl font-bold text-[#111827]">Coleções</h2>
                  <p className="text-sm text-[#6B7280] mt-1">Organize suas requisições em grupos. Mova-as usando o seletor em cada linha.</p>
                </div>
                <button
                  onClick={createCollection}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold hover:bg-[#1D4ED8] transition-colors shadow-sm"
                >
                  <Plus size={14} /> Nova Coleção
                </button>
              </div>

              <div className="space-y-3">
                {/* Sem coleção */}
                {(() => {
                  const items = savedRequests.filter(r => !r.collectionId);
                  const isExp = expandedCollections.has('__none__');
                  return (
                    <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                      <button
                        onClick={() => toggleCollection('__none__')}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#F9FAFB] transition-colors text-left"
                      >
                        {isExp ? <ChevronDown size={16} className="text-[#6B7280] shrink-0" /> : <ChevronRight size={16} className="text-[#6B7280] shrink-0" />}
                        <span className="font-semibold text-sm text-[#111827]">Sem coleção</span>
                        <span className="ml-1 px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-xs font-medium">{items.length}</span>
                      </button>
                      {isExp && (
                        <div className="border-t border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                          {items.length === 0
                            ? <div className="px-5 py-4 text-xs text-[#9CA3AF]">Nenhuma requisição sem coleção.</div>
                            : items.map(req => renderCollectionRequestRow(req))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Coleções criadas */}
                {collections.length === 0 && (
                  <div className="p-6 text-center text-xs text-[#9CA3AF] bg-[#FFFFFF] rounded-2xl border border-dashed border-[#E5E7EB]">
                    Nenhuma coleção criada. Clique em "Nova Coleção" para começar.
                  </div>
                )}
                {collections.map(col => {
                  const items = savedRequests.filter(r => r.collectionId === col.id);
                  const isExp = expandedCollections.has(col.id);
                  const isEditing = editingCollectionId === col.id;
                  return (
                    <div key={col.id} className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-4">
                        <button
                          onClick={() => toggleCollection(col.id)}
                          className="shrink-0 text-[#6B7280] hover:text-[#111827]"
                        >
                          {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        {isEditing ? (
                          <input
                            className="flex-1 h-8 bg-[#F9FAFB] border border-[#2563EB] rounded-lg px-3 text-sm font-semibold text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                            value={editingCollectionName}
                            onChange={e => setEditingCollectionName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') confirmRenameCollection();
                              if (e.key === 'Escape') { cancellingRenameRef.current = true; setEditingCollectionId(null); }
                            }}
                            onBlur={() => {
                              if (cancellingRenameRef.current) { cancellingRenameRef.current = false; return; }
                              confirmRenameCollection();
                            }}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => toggleCollection(col.id)}
                            className="flex-1 flex items-center gap-2 text-left"
                          >
                            <span className="font-semibold text-sm text-[#111827]">{col.name}</span>
                            <span className="px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-xs font-medium">{items.length}</span>
                          </button>
                        )}
                        <div className="flex gap-1 shrink-0">
                          {isEditing ? (
                            <>
                              <button
                                onClick={confirmRenameCollection}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 transition-colors"
                                title="Confirmar"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => setEditingCollectionId(null)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F5F7FA] transition-colors"
                                title="Cancelar"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startRenameCollection(col)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB] hover:bg-[#EFF6FF] hover:text-[#2563EB] hover:border-[#BFDBFE] transition-colors"
                                title="Renomear"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => deleteCollection(col.id)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                                title="Excluir coleção"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {isExp && (
                        <div className="border-t border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                          {items.length === 0
                            ? <div className="px-5 py-4 text-xs text-[#9CA3AF]">Nenhuma requisição nesta coleção. Use o seletor "Sem coleção" em outras requisições para movê-las aqui.</div>
                            : items.map(req => renderCollectionRequestRow(req))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {activeScreen === 'environments' && (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-2xl font-bold text-[#111827]">Ambientes</h2>
                <p className="text-sm text-[#6B7280] mt-1">Gerencie variáveis por ambiente. Use <span className="font-mono bg-[#F3F4F6] px-1 rounded text-[#374151]">{'{{NOME}}'}</span> na URL, headers e body para substituição automática.</p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                {/* Abas dos ambientes */}
                <div className="flex border-b border-[#E5E7EB] bg-[#F9FAFB]">
                  {environments.map(env => (
                    <button
                      key={env.id}
                      onClick={() => setEditingEnvId(env.id)}
                      className={`relative px-6 py-3.5 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                        editingEnvId === env.id
                          ? 'bg-white text-[#2563EB] border-[#2563EB]'
                          : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                      }`}
                    >
                      {env.name}
                      {activeEnvId === env.id && (
                        <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[9px] font-bold border border-green-200 leading-none">ATIVO</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Editor do ambiente selecionado */}
                {(() => {
                  const env = environments.find(e => e.id === editingEnvId);
                  if (!env) return null;
                  return (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-bold text-[#111827]">Variáveis — {env.name}</h3>
                          {activeEnvId === env.id ? (
                            <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-bold border border-green-200">
                              ✓ Ambiente ativo
                            </span>
                          ) : (
                            <button
                              onClick={() => setActiveEnvironment(env.id)}
                              className="px-3 py-1 rounded-lg bg-[#EFF6FF] text-[#2563EB] text-xs font-bold border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
                            >
                              Definir como ativo
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {activeEnvId === env.id && (
                            <button
                              onClick={() => setActiveEnvironment(null)}
                              className="px-3 py-2 rounded-xl bg-[#F9FAFB] text-[#6B7280] text-xs font-bold border border-[#E5E7EB] hover:bg-[#F5F7FA] transition-colors"
                            >
                              Desativar
                            </button>
                          )}
                          <button
                            onClick={() => addEnvVariable(env.id)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold hover:bg-[#1D4ED8] transition-colors shadow-sm"
                          >
                            <Plus size={14} /> Adicionar variável
                          </button>
                        </div>
                      </div>

                      {env.variables.length === 0 ? (
                        <div className="border border-dashed border-[#E5E7EB] rounded-xl p-10 text-center">
                          <div className="text-sm font-medium text-[#111827] mb-1">Nenhuma variável configurada</div>
                          <div className="text-xs text-[#9CA3AF]">
                            Clique em "Adicionar variável" e use <span className="font-mono bg-[#F3F4F6] px-1 rounded">{'{{NOME}}'}</span> nas requisições
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-[1fr_1fr_40px] gap-3 px-3 pb-1">
                            <div className="text-[10px] font-bold uppercase text-[#6B7280]">Nome</div>
                            <div className="text-[10px] font-bold uppercase text-[#6B7280]">Valor</div>
                            <div />
                          </div>
                          {env.variables.map(variable => (
                            <div key={variable.id} className="grid grid-cols-[1fr_1fr_40px] gap-3 items-center bg-[#F9FAFB] rounded-xl px-3 py-2.5 border border-[#E5E7EB]">
                              <input
                                className="h-9 bg-white border border-[#E5E7EB] rounded-lg px-3 text-sm font-mono text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                                placeholder="NOME_VARIAVEL"
                                value={variable.name}
                                onChange={(e) => updateEnvVariable(env.id, variable.id, 'name', e.target.value)}
                              />
                              <input
                                className="h-9 bg-white border border-[#E5E7EB] rounded-lg px-3 text-sm font-mono text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/10"
                                placeholder="valor"
                                value={variable.value}
                                onChange={(e) => updateEnvVariable(env.id, variable.id, 'value', e.target.value)}
                              />
                              <button
                                onClick={() => removeEnvVariable(env.id, variable.id)}
                                className="h-9 w-9 flex items-center justify-center rounded-lg bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {env.variables.length > 0 && (
                        <div className="mt-5 p-3 bg-[#F0F9FF] rounded-xl border border-[#BAE6FD]">
                          <p className="text-xs text-[#0369A1]">
                            <strong>Dica:</strong> use <span className="font-mono font-bold">{'{{NOME_VARIAVEL}}'}</span> na URL, headers ou body — a substituição ocorre automaticamente ao enviar a requisição com este ambiente ativo.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {activeScreen === 'settings' && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#F3F4F6] flex items-center justify-center mb-5">
                <Settings size={34} className="text-[#9CA3AF]" />
              </div>
              <h2 className="text-xl font-bold text-[#111827]">Configurações</h2>
              <p className="text-sm text-[#6B7280] mt-2 max-w-sm">Preferências e personalizações da ferramenta serão adicionadas em breve.</p>
            </div>
          )}
        </div>
      </main>
      
      {/* Modal de Geração de Código */}
      {showCodeModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowCodeModal(false)}>
          <div className="bg-[#FFFFFF] rounded-lg p-6 max-w-3xl w-full mx-4 border-2 border-[#E5E7EB]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[#2563EB] flex items-center gap-2">
                <Code size={24} /> Código Gerado
              </h2>
              <button
                onClick={() => setShowCodeModal(false)}
                className="text-[#6B7280] hover:text-[#111827]"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="flex gap-2 mb-4">
              {(['curl', 'javascript', 'axios', 'python'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setCodeLanguage(lang)}
                  className={`px-4 py-2 rounded text-sm font-bold ${
                    codeLanguage === lang
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#F9FAFB] text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  {lang === 'curl' && 'cURL'}
                  {lang === 'javascript' && 'JavaScript'}
                  {lang === 'axios' && 'Axios'}
                  {lang === 'python' && 'Python'}
                </button>
              ))}
            </div>
            
            <div className="bg-[#F9FAFB] rounded p-4 border border-[#E5E7EB] relative">
              <pre className="text-xs font-mono text-[#111827] overflow-auto max-h-96 whitespace-pre-wrap">
                {generateCode()}
              </pre>
              <button
                onClick={copyCode}
                className="absolute top-2 right-2 bg-[#FFFFFF] text-[#2563EB] px-3 py-1 rounded text-xs border border-[#E5E7EB] flex items-center gap-1 hover:bg-[#F5F7FA]"
              >
                {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                {copiedCode ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
