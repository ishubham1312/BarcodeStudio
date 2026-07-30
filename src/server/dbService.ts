import sqlite3 from "sqlite3";
import mysql from "mysql2/promise";
import mssql from "mssql";
import path from "path";
import fs from "fs";

export const SQLITE_DB_PATH = path.join(process.cwd(), "barcode_studio_library.db");

// Bootstrap a local, realistic SQLite database for library indexing so everything works out of the box.
export function bootstrapDatabase() {
  console.log("Checking SQLite database file status...");
  const db = new sqlite3.Database(SQLITE_DB_PATH);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS BOOK_MASTER (
        ACC_NO TEXT PRIMARY KEY,
        TITLE TEXT,
        AUTHOR TEXT,
        PUBLISHER TEXT,
        ISBN TEXT,
        CLASS_NO TEXT,
        BOOK_NO TEXT,
        PRICE TEXT,
        STATUS TEXT,
        LOCATION TEXT
      )
    `);

    db.get("SELECT COUNT(*) as count FROM BOOK_MASTER", (err, row: any) => {
      if (row && row.count === 0) {
        const stmt = db.prepare(`
          INSERT INTO BOOK_MASTER (ACC_NO, TITLE, AUTHOR, PUBLISHER, ISBN, CLASS_NO, BOOK_NO, PRICE, STATUS, LOCATION)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const sampleBooks = [
          ["ACC001", "Introduction to Algorithms", "Thomas H. Cormen", "MIT Press", "9780262033848", "005.1", "COR/I", "89.99", "Available", "Stack A-1"],
          ["ACC002", "Clean Code", "Robert C. Martin", "Prentice Hall", "9780132350884", "005.13", "MAR/C", "45.50", "Available", "Stack A-2"],
          ["ACC003", "Design Patterns", "Erich Gamma", "Addison-Wesley", "9780201633610", "005.12", "GAM/D", "54.99", "Issued", "Stack B-1"],
          ["ACC004", "The Pragmatic Programmer", "Andy Hunt", "Addison-Wesley", "9780135957059", "005.11", "HUN/P", "48.00", "Available", "Stack B-3"],
          ["ACC005", "Artificial Intelligence: A Modern Approach", "Stuart Russell", "Pearson", "9780136042594", "006.3", "RUS/A", "120.00", "Available", "Stack C-2"],
          ["ACC006", "Compilers: Principles, Techniques, and Tools", "Alfred V. Aho", "Addison-Wesley", "9780321486813", "005.45", "AHO/C", "95.00", "Available", "Stack C-4"],
          ["ACC007", "Computer Networking", "James Kurose", "Pearson", "9780132856201", "004.6", "KUR/C", "79.99", "Issued", "Stack D-1"],
          ["ACC008", "Database System Concepts", "Abraham Silberschatz", "McGraw-Hill", "9780073523323", "005.74", "SIL/D", "110.00", "Available", "Stack D-2"],
          ["ACC009", "The C Programming Language", "Brian W. Kernighan", "Prentice Hall", "9780131103627", "005.133", "KER/C", "35.00", "Available", "Stack A-3"],
          ["ACC010", "Refactoring", "Martin Fowler", "Addison-Wesley", "9780134757599", "005.14", "FOW/R", "50.00", "Available", "Stack B-2"]
        ];

        sampleBooks.forEach(book => stmt.run(book));
        stmt.finalize();
        console.log("✓ SQLite sample BOOK_MASTER populated.");
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS MEMBER_MASTER (
        MEMBER_ID TEXT PRIMARY KEY,
        NAME TEXT,
        DEPARTMENT TEXT,
        CATEGORY TEXT,
        EMAIL TEXT,
        STATUS TEXT
      )
    `);

    db.get("SELECT COUNT(*) as count FROM MEMBER_MASTER", (err, row: any) => {
      if (row && row.count === 0) {
        const stmt = db.prepare(`
          INSERT INTO MEMBER_MASTER (MEMBER_ID, NAME, DEPARTMENT, CATEGORY, EMAIL, STATUS)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const sampleMembers = [
          ["MEM101", "John Doe", "Computer Science", "Student", "john.doe@univ.edu", "Active"],
          ["MEM102", "Alice Smith", "Information Tech", "Faculty", "alice.smith@univ.edu", "Active"],
          ["MEM103", "Bob Johnson", "Mathematics", "Student", "bob.johnson@univ.edu", "Suspended"]
        ];
        sampleMembers.forEach(mem => stmt.run(mem));
        stmt.finalize();
        console.log("✓ SQLite sample MEMBER_MASTER populated.");
      }
    });
  });
}

// Universal Connection testing
export async function testDbConnection(config: any): Promise<{ success: boolean; message: string }> {
  const { dbType, server, port, username, password, database, sqlitePath, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    const targetPath = sqlitePath || SQLITE_DB_PATH;
    return new Promise((resolve) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
          resolve({ success: false, message: `SQLite: ${err.message}` });
        } else {
          db.close();
          resolve({ success: true, message: "Connected to SQLite database file successfully." });
        }
      });
    });
  }

  if (dbType === "mysql") {
    try {
      const connection = await mysql.createConnection({
        host: server || "localhost",
        port: Number(port) || 3306,
        user: username,
        password: password,
        database: database || undefined,
        connectTimeout: 5000
      });
      await connection.end();
      return { success: true, message: "MySQL connection successful." };
    } catch (err: any) {
      return { success: false, message: `MySQL Error: ${err.message}` };
    }
  }

  if (dbType === "mssql") {
    try {
      const sqlConfig: any = {
        server: server || "localhost",
        port: Number(port) || 1433,
        user: username,
        password: password,
        database: database || undefined,
        options: {
          encrypt: encrypt === true || encrypt === "true",
          trustServerCertificate: trustCert === true || trustCert === "true",
          enableArithAbort: true,
          connectTimeout: 5000
        }
      };
      if (instance) {
        sqlConfig.options.instanceName = instance;
      }
      const pool = await mssql.connect(sqlConfig);
      await pool.close();
      return { success: true, message: "MS SQL Server connection successful." };
    } catch (err: any) {
      return { success: false, message: `MS SQL Error: ${err.message}` };
    }
  }

  return { success: false, message: "Unsupported database engine selected." };
}

// Retrieve databases list
export async function getDatabases(config: any): Promise<string[]> {
  const { dbType, server, port, username, password, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    return ["main"];
  }

  if (dbType === "mysql") {
    const connection = await mysql.createConnection({
      host: server || "localhost",
      port: Number(port) || 3306,
      user: username,
      password: password
    });
    const [rows]: any[] = await connection.query("SHOW DATABASES");
    await connection.end();
    return rows.map((r: any) => r.Database || r.database || Object.values(r)[0]);
  }

  if (dbType === "mssql") {
    const sqlConfig: any = {
      server: server || "localhost",
      port: Number(port) || 1433,
      user: username,
      password: password,
      options: {
        encrypt: encrypt === true || encrypt === "true",
        trustServerCertificate: trustCert === true || trustCert === "true",
        enableArithAbort: true
      }
    };
    if (instance) {
      sqlConfig.options.instanceName = instance;
    }
    const pool = await mssql.connect(sqlConfig);
    const result = await pool.request().query("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name");
    await pool.close();
    return result.recordset.map((r: any) => r.name);
  }

  return [];
}

// Retrieve Tables and Views
export async function getTables(config: any): Promise<{ tables: string[]; views: string[] }> {
  const { dbType, server, port, username, password, database, sqlitePath, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    const targetPath = sqlitePath || SQLITE_DB_PATH;
    return new Promise((resolve) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          resolve({ tables: [], views: [] });
        }
      });
      db.all("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'", (err, rows: any[]) => {
        db.close();
        if (err || !rows) {
          resolve({ tables: [], views: [] });
        } else {
          const tables = rows.filter(r => r.type === "table").map(r => r.name);
          const views = rows.filter(r => r.type === "view").map(r => r.name);
          resolve({ tables, views });
        }
      });
    });
  }

  if (dbType === "mysql") {
    const connection = await mysql.createConnection({
      host: server || "localhost",
      port: Number(port) || 3306,
      user: username,
      password: password,
      database: database
    });
    // Query both tables and views
    const [tableRows]: any[] = await connection.query(`
      SELECT TABLE_NAME, TABLE_TYPE 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ?
    `, [database]);
    await connection.end();

    const tables = tableRows.filter((r: any) => r.TABLE_TYPE === "BASE TABLE").map((r: any) => r.TABLE_NAME);
    const views = tableRows.filter((r: any) => r.TABLE_TYPE === "VIEW").map((r: any) => r.TABLE_NAME);
    return { tables, views };
  }

  if (dbType === "mssql") {
    const sqlConfig: any = {
      server: server || "localhost",
      port: Number(port) || 1433,
      user: username,
      password: password,
      database: database,
      options: {
        encrypt: encrypt === true || encrypt === "true",
        trustServerCertificate: trustCert === true || trustCert === "true",
        enableArithAbort: true
      }
    };
    if (instance) {
      sqlConfig.options.instanceName = instance;
    }
    const pool = await mssql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT TABLE_NAME, TABLE_TYPE 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_CATALOG = '${database}'
    `);
    await pool.close();

    const tables = result.recordset.filter((r: any) => r.TABLE_TYPE === "BASE TABLE").map((r: any) => r.TABLE_NAME);
    const views = result.recordset.filter((r: any) => r.TABLE_TYPE === "VIEW").map((r: any) => r.TABLE_NAME);
    return { tables, views };
  }

  return { tables: [], views: [] };
}

// Retrieve Columns
export async function getColumns(config: any, tableName: string): Promise<string[]> {
  const { dbType, server, port, username, password, database, sqlitePath, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    const targetPath = sqlitePath || SQLITE_DB_PATH;
    return new Promise((resolve) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY);
      // Clean tableName to prevent injection
      const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "");
      db.all(`PRAGMA table_info(${safeTable})`, (err, rows: any[]) => {
        db.close();
        if (err || !rows) {
          resolve([]);
        } else {
          resolve(rows.map(r => r.name));
        }
      });
    });
  }

  if (dbType === "mysql") {
    const connection = await mysql.createConnection({
      host: server || "localhost",
      port: Number(port) || 3306,
      user: username,
      password: password,
      database: database
    });
    const [rows]: any[] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [database, tableName]);
    await connection.end();
    return rows.map((r: any) => r.COLUMN_NAME);
  }

  if (dbType === "mssql") {
    const sqlConfig: any = {
      server: server || "localhost",
      port: Number(port) || 1433,
      user: username,
      password: password,
      database: database,
      options: {
        encrypt: encrypt === true || encrypt === "true",
        trustServerCertificate: trustCert === true || trustCert === "true",
        enableArithAbort: true
      }
    };
    if (instance) {
      sqlConfig.options.instanceName = instance;
    }
    const pool = await mssql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_CATALOG = '${database}' AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION
    `);
    await pool.close();
    return result.recordset.map((r: any) => r.COLUMN_NAME);
  }

  return [];
}

// Retrieve rows from table/view with Limit/Top 100 for read-only spreadsheet grid
export async function getPreviewRows(
  config: any, 
  tableName: string, 
  limit: number = 100
): Promise<any[]> {
  const { dbType, server, port, username, password, database, sqlitePath, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    const targetPath = sqlitePath || SQLITE_DB_PATH;
    return new Promise((resolve) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY);
      const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "");
      db.all(`SELECT * FROM ${safeTable} LIMIT ${Number(limit)}`, (err, rows) => {
        db.close();
        if (err || !rows) {
          resolve([]);
        } else {
          resolve(rows);
        }
      });
    });
  }

  if (dbType === "mysql") {
    const connection = await mysql.createConnection({
      host: server || "localhost",
      port: Number(port) || 3306,
      user: username,
      password: password,
      database: database
    });
    // Table name escapes for safety
    const safeTable = connection.escapeId(tableName);
    const [rows]: any[] = await connection.query(`SELECT * FROM ${safeTable} LIMIT ?`, [Number(limit)]);
    await connection.end();
    return rows;
  }

  if (dbType === "mssql") {
    const sqlConfig: any = {
      server: server || "localhost",
      port: Number(port) || 1433,
      user: username,
      password: password,
      database: database,
      options: {
        encrypt: encrypt === true || encrypt === "true",
        trustServerCertificate: trustCert === true || trustCert === "true",
        enableArithAbort: true
      }
    };
    if (instance) {
      sqlConfig.options.instanceName = instance;
    }
    const pool = await mssql.connect(sqlConfig);
    // Table name safety
    const cleanTable = tableName.replace(/[^a-zA-Z0-9_\.]/g, "");
    const result = await pool.request().query(`SELECT TOP ${Number(limit)} * FROM ${cleanTable}`);
    await pool.close();
    return result.recordset;
  }

  return [];
}

export async function getRecordByUniqueField(
  config: any,
  tableName: string,
  uniqueField: string,
  value: string
): Promise<any | null> {
  const { dbType, server, port, username, password, database, sqlitePath, trustCert, encrypt, instance } = config;

  if (dbType === "sqlite") {
    const targetPath = sqlitePath || SQLITE_DB_PATH;
    return new Promise((resolve) => {
      const db = new sqlite3.Database(targetPath, sqlite3.OPEN_READONLY);
      const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "");
      const safeField = uniqueField.replace(/[^a-zA-Z0-9_]/g, "");
      // Try exact match first, then partial match (LIKE) for better search behavior
      db.get(`SELECT * FROM "${safeTable}" WHERE CAST("${safeField}" AS TEXT) = ?`, [value], (err, row) => {
        if (err || !row) {
          if (err) console.error("[SQLite query-record exact]", err.message);
          db.get(`SELECT * FROM "${safeTable}" WHERE CAST("${safeField}" AS TEXT) LIKE ?`, [`%${value}%`], (err2, row2) => {
            db.close();
            if (err2) console.error("[SQLite query-record like]", err2.message);
            if (err2 || !row2) {
              resolve(null);
            } else {
              resolve(row2);
            }
          });
        } else {
          db.close();
          resolve(row);
        }
      });
    });
  }

  if (dbType === "mysql") {
    const connection = await mysql.createConnection({
      host: server || "localhost",
      port: Number(port) || 3306,
      user: username,
      password: password,
      database: database
    });
    try {
      const safeTable = connection.escapeId(tableName);
      const safeField = connection.escapeId(uniqueField);
      // Use CAST for flexible comparison — column may be numeric
      const [rows]: any[] = await connection.query(
        `SELECT * FROM ${safeTable} WHERE CAST(${safeField} AS CHAR) = ? LIMIT 1`, [value]
      );
      if (rows.length === 0) {
        const [rows2]: any[] = await connection.query(
          `SELECT * FROM ${safeTable} WHERE CAST(${safeField} AS CHAR) LIKE ? LIMIT 1`, [`%${value}%`]
        );
        await connection.end();
        return rows2.length > 0 ? rows2[0] : null;
      }
      await connection.end();
      return rows[0];
    } catch (err: any) {
      console.error("[MySQL query-record]", err.message);
      await connection.end().catch(() => {});
      throw err;
    }
  }

  if (dbType === "mssql") {
    const sqlConfig: any = {
      server: server || "localhost",
      port: Number(port) || 1433,
      user: username,
      password: password,
      database: database,
      options: {
        encrypt: encrypt === true || encrypt === "true",
        trustServerCertificate: trustCert === true || trustCert === "true",
        enableArithAbort: true
      }
    };
    if (instance) {
      sqlConfig.options.instanceName = instance;
    }
    let pool: any;
    try {
      pool = await mssql.connect(sqlConfig);
      // Keep dots for schema-qualified names, strip everything else
      const cleanTable = tableName.replace(/[^a-zA-Z0-9_\.]/g, "");
      // Bracket-quote the field name for proper MSSQL identifier escaping
      const safeField = uniqueField.replace(/[^a-zA-Z0-9_]/g, "");

      // Use CAST to NVARCHAR for comparison — handles numeric, int, varchar columns uniformly
      let result = await pool.request()
        .input('val', mssql.NVarChar, value)
        .query(`SELECT TOP 1 * FROM ${cleanTable} WHERE CAST([${safeField}] AS NVARCHAR(MAX)) = @val`);
      
      if (result.recordset.length === 0) {
        // Fallback: partial match with LIKE
        result = await pool.request()
          .input('val', mssql.NVarChar, `%${value}%`)
          .query(`SELECT TOP 1 * FROM ${cleanTable} WHERE CAST([${safeField}] AS NVARCHAR(MAX)) LIKE @val`);
      }
      await pool.close();
      return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (err: any) {
      console.error("[MSSQL query-record]", err.message);
      if (pool) await pool.close().catch(() => {});
      throw err;
    }
  }

  return null;
}
