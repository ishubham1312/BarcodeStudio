import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { bootstrapDatabase, testDbConnection, getDatabases, getTables, getColumns, getPreviewRows, getRecordByUniqueField } from "./src/server/dbService.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Bootstrap sample SQL Database (SQLite)
  try {
    bootstrapDatabase();
  } catch (err) {
    console.error("Failed to bootstrap SQLite database:", err);
  }

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Database Connection/Service Routes
  app.post("/api/db/test", async (req, res) => {
    try {
      const result = await testDbConnection(req.body.config);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/db/databases", async (req, res) => {
    try {
      const list = await getDatabases(req.body.config);
      res.json({ success: true, databases: list });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/db/tables", async (req, res) => {
    try {
      const data = await getTables(req.body.config);
      res.json({ success: true, ...data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/db/columns", async (req, res) => {
    try {
      const columns = await getColumns(req.body.config, req.body.table);
      res.json({ success: true, columns });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/db/query", async (req, res) => {
    try {
      const rows = await getPreviewRows(req.body.config, req.body.table, req.body.limit);
      res.json({ success: true, rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/db/query-record", async (req, res) => {
    try {
      const { config, table, uniqueField, value } = req.body;
      console.log(`[query-record] Searching table="${table}" field="${uniqueField}" value="${value}" dbType="${config?.dbType}"`);
      const record = await getRecordByUniqueField(config, table, uniqueField, value);
      res.json({ success: true, record });
    } catch (err: any) {
      console.error("[query-record] Error:", err.message);
      res.status(500).json({ success: false, message: err.message });
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
