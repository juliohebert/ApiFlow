import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  app.use(express.json());

  // Proxy route
  app.post("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.body;
    try {
      const targetUrl = new URL(url);
      if (!["http:", "https:"].includes(targetUrl.protocol)) {
        return res.status(400).json({ error: "URL invalida. Use http ou https." });
      }

      const requestMethod = String(method || "GET").toUpperCase();
      if (!allowedMethods.has(requestMethod)) {
        return res.status(400).json({ error: "Metodo HTTP invalido." });
      }

      const fetchOptions: any = {
        method: requestMethod,
        headers: {
          ...headers,
        },
      };
      
      // Adiciona Content-Type e body apenas se houver body
      if (body !== undefined && requestMethod !== 'GET') {
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(body);
      } else if (body === null && (requestMethod === 'POST' || requestMethod === 'PUT' || requestMethod === 'PATCH')) {
        // Se for POST/PUT/PATCH sem body, envia objeto vazio
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify({});
      }
      
      console.log('Proxying request:', { url: targetUrl.toString(), method: requestMethod });
      const response = await fetch(targetUrl, fetchOptions);
      const data = await response.text();
      console.log('API response:', { status: response.status });
      let parsedData;
      try {
        parsedData = JSON.parse(data);
      } catch {
        parsedData = { raw: data };
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      res.json({ status: response.status, data: parsedData, headers: responseHeaders });
    } catch (error) {
      console.error('Proxy Error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Swagger/OpenAPI fetch route
  app.post("/api/fetch-swagger", async (req, res) => {
    const { url } = req.body;
    console.log('Fetching Swagger from:', url);
    
    try {
      // Tenta várias URLs possíveis de especificação OpenAPI
      const swaggerUrl = new URL(url);
      if (!["http:", "https:"].includes(swaggerUrl.protocol)) {
        return res.status(400).json({ success: false, error: "URL invalida. Use http ou https." });
      }

      const fetchSwaggerJson = async (testUrl: string) => {
        const response = await fetch(testUrl);
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) return null;
        return response.json();
      };

      const directData = await fetchSwaggerJson(swaggerUrl.toString());
      if (directData) {
        return res.json({ success: true, data: directData, url: swaggerUrl.toString() });
      }

      const possiblePaths = [
        '/v2/api-docs',
        '/v3/api-docs',
        '/swagger.json',
        '/api-docs',
        '/openapi.json',
        '/swagger/v1/swagger.json',
      ];
      
      // Extrai a base URL do Swagger UI
      const baseUrl = swaggerUrl.toString().replace(/\/swagger-ui.*/, '').replace(/\/$/, '');
      
      for (const path of possiblePaths) {
        try {
          const testUrl = baseUrl + path;
          console.log('Tentando:', testUrl);
          const data = await fetchSwaggerJson(testUrl);
          if (data) {
            console.log('Swagger encontrado em:', testUrl);
            return res.json({ success: true, data, url: testUrl });
          }
        } catch (e) {
          // Continua tentando outras URLs
        }
      }
      
      res.status(404).json({ 
        success: false, 
        error: 'Não foi possível encontrar a especificação OpenAPI/Swagger. Tente fornecer a URL direta do JSON.' 
      });
    } catch (error) {
      console.error('Swagger Fetch Error:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
