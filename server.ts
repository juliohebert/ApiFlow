import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Proxy route
  app.post("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.body;
    console.log('Proxying request:', { url, method, headers, body });
    try {
      const fetchOptions: any = {
        method,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      };
      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }
      console.log('Fetching with options:', fetchOptions);
      const response = await fetch(url, fetchOptions);
      const data = await response.text();
      console.log('API Response:', { status: response.status, data });
      let parsedData;
      try {
        parsedData = JSON.parse(data);
      } catch {
        parsedData = { raw: data };
      }
      res.json({ status: response.status, data: parsedData });
    } catch (error) {
      console.error('Proxy Error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
