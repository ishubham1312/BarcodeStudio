import sqlite3
import os
import pymysql
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.services.logging_service import get_logger

logger = get_logger()

# We try to import pyodbc for MS SQL Server
try:
  import pyodbc
except ImportError:
  pyodbc = None
  logger.warning("pyodbc not installed. MS SQL Server connections will be unavailable unless installed.")

def resolve_sqlite_path(sqlite_path: str) -> str:
  """Resolve relative SQLite paths against user writable directory."""
  from backend.utils.helpers import get_user_data_dir
  if sqlite_path:
    import os
    if not os.path.isabs(sqlite_path):
      filename = os.path.basename(sqlite_path)
      if not filename:
        filename = 'barcode_studio_library.db'
      return str(get_user_data_dir() / filename)
    return sqlite_path
  return str(get_user_data_dir() / 'barcode_studio_library.db')

def get_sqlite_conn(sqlite_path: str):
  """Establish a connection to SQLite database and configure it to return dictionary-like rows."""
  resolved_path = resolve_sqlite_path(sqlite_path)
  conn = sqlite3.connect(resolved_path)
  conn.row_factory = sqlite3.Row
  return conn

def bootstrap_database(sqlite_path: str):
  """
  Bootstrap a local, realistic SQLite database for library indexing so everything works out of the box.
  Identical to TS version database bootstrap.
  """
  resolved_path = resolve_sqlite_path(sqlite_path)
  logger.info(f"Bootstrapping local SQLite database at {resolved_path}...")
  db_dir = Path(resolved_path).parent
  db_dir.mkdir(parents=True, exist_ok=True)
  
  conn = sqlite3.connect(resolved_path)
  cursor = conn.cursor()
  try:
    cursor.execute("""
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
    """)

    cursor.execute("SELECT COUNT(*) FROM BOOK_MASTER")
    count = cursor.fetchone()[0]
    if count == 0:
      sample_books = [
        ("ACC001", "Introduction to Algorithms", "Thomas H. Cormen", "MIT Press", "9780262033848", "005.1", "COR/I", "89.99", "Available", "Stack A-1"),
        ("ACC002", "Clean Code", "Robert C. Martin", "Prentice Hall", "9780132350884", "005.13", "MAR/C", "45.50", "Available", "Stack A-2"),
        ("ACC003", "Design Patterns", "Erich Gamma", "Addison-Wesley", "9780201633610", "005.12", "GAM/D", "54.99", "Issued", "Stack B-1"),
        ("ACC004", "The Pragmatic Programmer", "Andy Hunt", "Addison-Wesley", "9780135957059", "005.11", "HUN/P", "48.00", "Available", "Stack B-3"),
        ("ACC005", "Artificial Intelligence: A Modern Approach", "Stuart Russell", "Pearson", "9780136042594", "006.3", "RUS/A", "120.00", "Available", "Stack C-2"),
        ("ACC006", "Compilers: Principles, Techniques, and Tools", "Alfred V. Aho", "Addison-Wesley", "9780321486813", "005.45", "AHO/C", "95.00", "Available", "Stack C-4"),
        ("ACC007", "Computer Networking", "James Kurose", "Pearson", "9780132856201", "004.6", "KUR/C", "79.99", "Issued", "Stack D-1"),
        ("ACC008", "Database System Concepts", "Abraham Silberschatz", "McGraw-Hill", "9780073523323", "005.74", "SIL/D", "110.00", "Available", "Stack D-2"),
        ("ACC009", "The C Programming Language", "Brian W. Kernighan", "Prentice Hall", "9780131103627", "005.133", "KER/C", "35.00", "Available", "Stack A-3"),
        ("ACC010", "Refactoring", "Martin Fowler", "Addison-Wesley", "9780134757599", "005.14", "FOW/R", "50.00", "Available", "Stack B-2")
      ]
      cursor.executemany("""
        INSERT INTO BOOK_MASTER (ACC_NO, TITLE, AUTHOR, PUBLISHER, ISBN, CLASS_NO, BOOK_NO, PRICE, STATUS, LOCATION)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """, sample_books)
      conn.commit()
      logger.info("[OK] SQLite sample BOOK_MASTER populated.")

    cursor.execute("""
      CREATE TABLE IF NOT EXISTS MEMBER_MASTER (
        MEMBER_ID TEXT PRIMARY KEY,
        NAME TEXT,
        DEPARTMENT TEXT,
        CATEGORY TEXT,
        EMAIL TEXT,
        STATUS TEXT
      )
    """)

    cursor.execute("SELECT COUNT(*) FROM MEMBER_MASTER")
    mem_count = cursor.fetchone()[0]
    if mem_count == 0:
      sample_members = [
        ("MEM101", "John Doe", "Computer Science", "Student", "john.doe@univ.edu", "Active"),
        ("MEM102", "Alice Smith", "Information Tech", "Faculty", "alice.smith@univ.edu", "Active"),
        ("MEM103", "Bob Johnson", "Mathematics", "Student", "bob.johnson@univ.edu", "Suspended")
      ]
      cursor.executemany("""
        INSERT INTO MEMBER_MASTER (MEMBER_ID, NAME, DEPARTMENT, CATEGORY, EMAIL, STATUS)
        VALUES (?, ?, ?, ?, ?, ?)
      """, sample_members)
      conn.commit()
      logger.info("[OK] SQLite sample MEMBER_MASTER populated.")
  except Exception as e:
    logger.error(f"Error bootstrapping SQLite database: {e}")
  finally:
    conn.close()

def get_mssql_conn_string(config: Dict[str, Any]) -> str:
  """Build a pyodbc connection string for SQL Server."""
  if not pyodbc:
    raise RuntimeError("pyodbc driver is not available.")
    
  server_str = config.get("server", "localhost")
  if config.get("instance"):
    server_str += f"\\{config['instance']}"
    
  # Discover SQL Server drivers
  installed_drivers = pyodbc.drivers()
  
  # Prioritize modern ODBC Drivers over legacy 'SQL Server'
  preferred_prefixes = [
    "ODBC Driver 18",
    "ODBC Driver 17",
    "ODBC Driver 13",
    "ODBC Driver 11",
    "SQL Server Native Client 11.0",
    "SQL Server Native Client 10.0"
  ]
  
  driver = None
  for prefix in preferred_prefixes:
    for d in installed_drivers:
      if prefix in d:
        driver = d
        break
    if driver:
      break
      
  if not driver:
    # Fallback to any SQL Server or ODBC driver
    fallback_drivers = [d for d in installed_drivers if "SQL Server" in d or "ODBC Driver" in d]
    if fallback_drivers:
      driver = fallback_drivers[0]
    else:
      raise RuntimeError("No Microsoft SQL Server ODBC drivers found on system.")
  
  is_legacy = (driver == "SQL Server")
  
  conn_parts = [
    f"DRIVER={{{driver}}}",
    f"SERVER={server_str}"
  ]
  
  # The legacy "SQL Server" driver (sqlsrv32.dll) does not support Encrypt 
  # or TrustServerCertificate attributes.
  # We omit timeout parameters from the connection string to prevent "Invalid connection string attribute"
  # error on various drivers, setting it via pyodbc.connect(..., timeout=5) instead.
  if not is_legacy:
    conn_parts.extend([
      f"Encrypt={'yes' if config.get('encrypt') else 'no'}",
      f"TrustServerCertificate={'yes' if config.get('trustCert') else 'no'}"
    ])
  
  if config.get("database"):
    conn_parts.append(f"DATABASE={config['database']}")
    
  if config.get("authMode") == "windows":
    conn_parts.append("Trusted_Connection=yes")
  else:
    pwd = config.get('password', '')
    # Escape password in curly braces only if it contains special characters (like ';', '{', '}')
    special_chars = [';', '{', '}', '=', ' ', '\t']
    if pwd and any(c in pwd for c in special_chars):
      if not (pwd.startswith('{') and pwd.endswith('}')):
        pwd_escaped = pwd.replace('}', '}}')
        pwd = f"{{{pwd_escaped}}}"
    conn_parts.extend([
      f"UID={config.get('username', '')}", 
      f"PWD={pwd}"
    ])
    
  return ";".join(conn_parts)

def test_db_connection(config: Dict[str, Any]) -> Dict[str, Any]:
  db_type = config.get("dbType")
  
  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    if not sqlite_path:
      return {"success": False, "message": "SQLite path not specified"}
    try:
      resolved_path = resolve_sqlite_path(sqlite_path)
      conn = sqlite3.connect(resolved_path)
      conn.close()
      return {"success": True, "message": "Connected to SQLite database file successfully."}
    except Exception as e:
      return {"success": False, "message": f"SQLite Error: {str(e)}"}
      
  elif db_type == "mysql":
    try:
      conn = pymysql.connect(
        host=config.get("server", "localhost"),
        port=int(config.get("port", 3306)),
        user=config.get("username", ""),
        password=config.get("password", ""),
        database=config.get("database") or None,
        connect_timeout=5
      )
      conn.close()
      return {"success": True, "message": "MySQL connection successful."}
    except Exception as e:
      return {"success": False, "message": f"MySQL Error: {str(e)}"}
      
  elif db_type == "mssql":
    if not pyodbc:
      return {"success": False, "message": "pyodbc module is not installed."}
    try:
      conn_str = get_mssql_conn_string(config)
      conn = pyodbc.connect(conn_str, timeout=5)
      conn.close()
      return {"success": True, "message": "MS SQL Server connection successful."}
    except Exception as e:
      return {"success": False, "message": f"MS SQL Error: {str(e)}"}
      
  return {"success": False, "message": "Unsupported database engine."}

def get_databases(config: Dict[str, Any]) -> List[str]:
  db_type = config.get("dbType")
  
  if db_type == "sqlite":
    return ["main"]
    
  elif db_type == "mysql":
    conn = pymysql.connect(
      host=config.get("server", "localhost"),
      port=int(config.get("port", 3306)),
      user=config.get("username", ""),
      password=config.get("password", ""),
      connect_timeout=5
    )
    cursor = conn.cursor()
    cursor.execute("SHOW DATABASES")
    dbs = [row[0] for row in cursor.fetchall()]
    conn.close()
    return dbs
    
  elif db_type == "mssql":
    if not pyodbc:
      return []
    conn_str = get_mssql_conn_string(config)
    conn = pyodbc.connect(conn_str, timeout=5)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name")
    dbs = [row[0] for row in cursor.fetchall()]
    conn.close()
    return dbs
    
  return []

def get_tables(config: Dict[str, Any]) -> Dict[str, List[str]]:
  db_type = config.get("dbType")
  database = config.get("database")
  
  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    resolved_path = resolve_sqlite_path(sqlite_path)
    conn = sqlite3.connect(resolved_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
    rows = cursor.fetchall()
    conn.close()
    
    tables = [r[0] for r in rows if r[1] == 'table']
    views = [r[0] for r in rows if r[1] == 'view']
    return {"tables": tables, "views": views}
    
  elif db_type == "mysql":
    conn = pymysql.connect(
      host=config.get("server", "localhost"),
      port=int(config.get("port", 3306)),
      user=config.get("username", ""),
      password=config.get("password", ""),
      database=database,
      connect_timeout=5
    )
    cursor = conn.cursor()
    cursor.execute("""
      SELECT TABLE_NAME, TABLE_TYPE 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = %s
    """, (database,))
    rows = cursor.fetchall()
    conn.close()
    
    tables = [r[0] for r in rows if r[1] == 'BASE TABLE']
    views = [r[0] for r in rows if r[1] == 'VIEW']
    return {"tables": tables, "views": views}
    
  elif db_type == "mssql":
    if not pyodbc:
      return {"tables": [], "views": []}
    conn_str = get_mssql_conn_string(config)
    conn = pyodbc.connect(conn_str, timeout=5)
    cursor = conn.cursor()
    # SQL query for tables & views
    cursor.execute(f"""
      SELECT TABLE_NAME, TABLE_TYPE 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_CATALOG = ?
    """, (database,))
    rows = cursor.fetchall()
    conn.close()
    
    tables = [r[0] for r in rows if r[1] == 'BASE TABLE']
    views = [r[0] for r in rows if r[1] == 'VIEW']
    return {"tables": tables, "views": views}
    
  return {"tables": [], "views": []}

def get_columns(config: Dict[str, Any], table_name: str) -> List[str]:
  db_type = config.get("dbType")
  database = config.get("database")
  
  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    resolved_path = resolve_sqlite_path(sqlite_path)
    conn = sqlite3.connect(resolved_path)
    cursor = conn.cursor()
    # Clean table_name slightly for safety
    safe_table = "".join(c for c in table_name if c.isalnum() or c == '_')
    cursor.execute(f"PRAGMA table_info({safe_table})")
    cols = [row[1] for row in cursor.fetchall()]
    conn.close()
    return cols
    
  elif db_type == "mysql":
    conn = pymysql.connect(
      host=config.get("server", "localhost"),
      port=int(config.get("port", 3306)),
      user=config.get("username", ""),
      password=config.get("password", ""),
      database=database,
      connect_timeout=5
    )
    cursor = conn.cursor()
    cursor.execute("""
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
      ORDER BY ORDINAL_POSITION
    """, (database, table_name))
    cols = [row[0] for row in cursor.fetchall()]
    conn.close()
    return cols
    
  elif db_type == "mssql":
    if not pyodbc:
      return []
    conn_str = get_mssql_conn_string(config)
    conn = pyodbc.connect(conn_str, timeout=5)
    cursor = conn.cursor()
    cursor.execute("""
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_CATALOG = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    """, (database, table_name))
    cols = [row[0] for row in cursor.fetchall()]
    conn.close()
    return cols
    
  return []

def get_preview_rows(config: Dict[str, Any], table_name: str, limit: int = 100) -> List[Dict[str, Any]]:
  db_type = config.get("dbType")
  database = config.get("database")
  
  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    conn = get_sqlite_conn(sqlite_path)
    cursor = conn.cursor()
    safe_table = "".join(c for c in table_name if c.isalnum() or c in '_')
    cursor.execute(f"SELECT * FROM {safe_table} LIMIT ?", (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows
    
  elif db_type == "mysql":
    conn = pymysql.connect(
      host=config.get("server", "localhost"),
      port=int(config.get("port", 3306)),
      user=config.get("username", ""),
      password=config.get("password", ""),
      database=database,
      cursorclass=pymysql.cursors.DictCursor,
      connect_timeout=5
    )
    cursor = conn.cursor()
    # Backtick quote table name for mysql
    safe_table = f"`{table_name}`"
    cursor.execute(f"SELECT * FROM {safe_table} LIMIT %s", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return rows
    
  elif db_type == "mssql":
    if not pyodbc:
      return []
    conn_str = get_mssql_conn_string(config)
    conn = pyodbc.connect(conn_str, timeout=5)
    cursor = conn.cursor()
    # Sanitize brackets for mssql table names
    clean_table = "".join(c for c in table_name if c.isalnum() or c in '_.[]')
    cursor.execute(f"SELECT TOP {int(limit)} * FROM {clean_table}")
    
    columns = [col[0] for col in cursor.description]
    rows = []
    for row in cursor.fetchall():
      # Map database types like decimal/datetime to standard types
      mapped_row = {}
      for idx, val in enumerate(row):
        # Format values to strings as expected by React front-end tables
        if val is None:
          mapped_row[columns[idx]] = ""
        else:
          mapped_row[columns[idx]] = str(val)
      rows.append(mapped_row)
    conn.close()
    return rows
    
  return []

def get_record_by_unique_field(config: Dict[str, Any], table_name: str, unique_field: str, value: str) -> Optional[Dict[str, Any]]:
  db_type = config.get("dbType")
  database = config.get("database")
  val_clean = str(value).strip() if value is not None else ""
  if not val_clean:
    return None

  ACCESSION_HINTS = [
    "acc_no", "accno", "accession", "accessionno", "accession_no",
    "accession_number", "accessionnumber", "acc", "barcode",
    "book_no", "bookno", "item_id", "itemid", "id", "code",
    "serial", "serial_no", "serialno"
  ]

  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    conn = get_sqlite_conn(sqlite_path)
    cursor = conn.cursor()
    safe_table = "".join(c for c in table_name if c.isalnum() or c in '_')
    safe_field = "".join(c for c in unique_field if c.isalnum() or c in '_')

    # Get actual columns in table
    try:
      cursor.execute(f'PRAGMA table_info("{safe_table}")')
      actual_cols = [row[1] for row in cursor.fetchall()]
    except Exception:
      actual_cols = []

    fields_to_try = []
    if safe_field:
      fields_to_try.append(safe_field)
    for col in actual_cols:
      if col not in fields_to_try and any(col.lower() == h or col.lower().startswith(h) for h in ACCESSION_HINTS):
        fields_to_try.append(col)

    row = None
    for fld in fields_to_try:
      # 1. Exact match
      cursor.execute(f'SELECT * FROM "{safe_table}" WHERE TRIM(CAST("{fld}" AS TEXT)) = ?', (val_clean,))
      row = cursor.fetchone()
      if row:
        break
      # 2. Prefix LIKE
      cursor.execute(f'SELECT * FROM "{safe_table}" WHERE CAST("{fld}" AS TEXT) LIKE ?', (f'{val_clean}%',))
      row = cursor.fetchone()
      if row:
        break
      # 3. Contains LIKE
      cursor.execute(f'SELECT * FROM "{safe_table}" WHERE CAST("{fld}" AS TEXT) LIKE ?', (f'%{val_clean}%',))
      row = cursor.fetchone()
      if row:
        break

    res = dict(row) if row else None
    conn.close()
    return res

  elif db_type == "mysql":
    conn = pymysql.connect(
      host=config.get("server", "localhost"),
      port=int(config.get("port", 3306)),
      user=config.get("username", ""),
      password=config.get("password", ""),
      database=database,
      cursorclass=pymysql.cursors.DictCursor,
      connect_timeout=5
    )
    cursor = conn.cursor()
    safe_table = f"`{table_name}`"

    try:
      cursor.execute(f"SHOW COLUMNS FROM {safe_table}")
      actual_cols = [r['Field'] for r in cursor.fetchall()]
    except Exception:
      actual_cols = []

    fields_to_try = []
    if unique_field:
      fields_to_try.append(unique_field)
    for col in actual_cols:
      if col not in fields_to_try and any(col.lower() == h or col.lower().startswith(h) for h in ACCESSION_HINTS):
        fields_to_try.append(col)

    row = None
    for fld in fields_to_try:
      safe_fld = f"`{fld}`"
      # Exact match
      cursor.execute(f"SELECT * FROM {safe_table} WHERE TRIM(CAST({safe_fld} AS CHAR)) = %s LIMIT 1", (val_clean,))
      row = cursor.fetchone()
      if row:
        break
      # Prefix LIKE
      cursor.execute(f"SELECT * FROM {safe_table} WHERE CAST({safe_fld} AS CHAR) LIKE %s LIMIT 1", (f'{val_clean}%',))
      row = cursor.fetchone()
      if row:
        break
      # Contains LIKE
      cursor.execute(f"SELECT * FROM {safe_table} WHERE CAST({safe_fld} AS CHAR) LIKE %s LIMIT 1", (f'%{val_clean}%',))
      row = cursor.fetchone()
      if row:
        break

    conn.close()
    return row

  elif db_type == "mssql":
    if not pyodbc:
      return None
    conn_str = get_mssql_conn_string(config)
    conn = pyodbc.connect(conn_str, timeout=5)
    cursor = conn.cursor()

    if '[' in table_name or '.' in table_name:
      clean_table = "".join(c for c in table_name if c.isalnum() or c in '_.[]')
    else:
      clean_table = f"[{table_name}]"

    # Step 1: Discover actual columns quickly via cursor description or schema
    actual_columns: List[str] = []
    try:
      cursor.execute(f"SELECT TOP 1 * FROM {clean_table}")
      if cursor.description:
        actual_columns = [col[0] for col in cursor.description]
    except Exception as desc_err:
      logger.warning(f"[db_service] Could not query table '{clean_table}' directly: {desc_err}")

    if not actual_columns:
      try:
        raw_table = table_name.replace("[", "").replace("]", "").split(".")[-1]
        cursor.execute(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
          "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
          (raw_table,)
        )
        actual_columns = [r[0] for r in cursor.fetchall()]
      except Exception:
        actual_columns = []

    # Step 2: Build prioritized list of fields to test
    fields_to_try: List[str] = []

    # 1. Exact match for requested unique_field
    if unique_field:
      for col in actual_columns:
        if col.lower() == unique_field.lower():
          if col not in fields_to_try:
            fields_to_try.append(col)
          break
      if unique_field not in fields_to_try:
        fields_to_try.append(unique_field)

    # 2. Add common accession-like candidate columns present in the table
    for col in actual_columns:
      c_lower = col.lower()
      if col not in fields_to_try and any(c_lower == hint or c_lower.startswith(hint) for hint in ACCESSION_HINTS):
        fields_to_try.append(col)

    if not fields_to_try and actual_columns:
      fields_to_try.append(actual_columns[0])

    logger.debug(
      f"[db_service] MSSQL lookup: table='{clean_table}' fields_to_try={fields_to_try} value='{val_clean}'"
    )

    row = None
    for fld in fields_to_try:
      try:
        # 1. Exact equality match
        cursor.execute(
          f"SELECT TOP 1 * FROM {clean_table} WHERE [{fld}] = ?",
          (val_clean,)
        )
        row = cursor.fetchone()
        if row:
          break

        # 2. Trimmed string match (essential for CHAR(N) and NVARCHAR fields with whitespace)
        cursor.execute(
          f"SELECT TOP 1 * FROM {clean_table} WHERE LTRIM(RTRIM(CAST([{fld}] AS NVARCHAR(MAX)))) = ?",
          (val_clean,)
        )
        row = cursor.fetchone()
        if row:
          break

        # 3. Prefix match
        cursor.execute(
          f"SELECT TOP 1 * FROM {clean_table} WHERE CAST([{fld}] AS NVARCHAR(MAX)) LIKE ?",
          (f"{val_clean}%",)
        )
        row = cursor.fetchone()
        if row:
          break

        # 4. Contains match
        cursor.execute(
          f"SELECT TOP 1 * FROM {clean_table} WHERE CAST([{fld}] AS NVARCHAR(MAX)) LIKE ?",
          (f"%{val_clean}%",)
        )
        row = cursor.fetchone()
        if row:
          break
      except Exception as col_query_err:
        logger.debug(f"[db_service] Query on column [{fld}] failed: {col_query_err}")
        continue

    res = None
    if row:
      columns = [col[0] for col in cursor.description]
      res = {}
      for idx, val in enumerate(row):
        res[columns[idx]] = "" if val is None else str(val)

    try:
      conn.close()
    except Exception:
      pass

    return res

  return None
