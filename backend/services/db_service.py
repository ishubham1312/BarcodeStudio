import sqlite3
import os
import pymysql
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
from services.logging_service import get_logger

logger = get_logger()

# We try to import pyodbc for MS SQL Server
try:
  import pyodbc
except ImportError:
  pyodbc = None
  logger.warning("pyodbc not installed. MS SQL Server connections will be unavailable unless installed.")

_thread_local = threading.local()
_columns_cache: Dict[str, List[str]] = {}

def resolve_sqlite_path(sqlite_path: str) -> str:
  """Resolve relative SQLite paths against user writable directory."""
  from utils.helpers import get_user_data_dir
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

def get_cached_mssql_conn(config: Dict[str, Any]):
  conn_str = get_mssql_conn_string(config)
  conn = getattr(_thread_local, "mssql_conn", None)
  cached_str = getattr(_thread_local, "mssql_conn_str", None)

  if conn is not None and cached_str == conn_str:
    try:
      cur = conn.cursor()
      cur.execute("SELECT 1")
      cur.fetchone()
      cur.close()
      return conn
    except Exception:
      try:
        conn.close()
      except Exception:
        pass
      _thread_local.mssql_conn = None

  conn = pyodbc.connect(conn_str, timeout=3)
  try:
    conn.autocommit = True
  except Exception:
    pass
  _thread_local.mssql_conn = conn
  _thread_local.mssql_conn_str = conn_str
  return conn

def get_cached_mysql_conn(config: Dict[str, Any]):
  database = config.get("database")
  conn_key = (
    config.get("server", "localhost"),
    int(config.get("port", 3306)),
    config.get("username", ""),
    config.get("password", ""),
    database
  )
  conn = getattr(_thread_local, "mysql_conn", None)
  cached_key = getattr(_thread_local, "mysql_conn_key", None)

  if conn is not None and cached_key == conn_key:
    try:
      conn.ping(reconnect=True)
      return conn
    except Exception:
      try:
        conn.close()
      except Exception:
        pass
      _thread_local.mysql_conn = None

  conn = pymysql.connect(
    host=config.get("server", "localhost"),
    port=int(config.get("port", 3306)),
    user=config.get("username", ""),
    password=config.get("password", ""),
    database=database,
    cursorclass=pymysql.cursors.DictCursor,
    connect_timeout=3,
    autocommit=True
  )
  _thread_local.mysql_conn = conn
  _thread_local.mysql_conn_key = conn_key
  return conn

def get_cached_sqlite_conn(sqlite_path: str):
  resolved_path = resolve_sqlite_path(sqlite_path)
  conn = getattr(_thread_local, "sqlite_conn", None)
  cached_path = getattr(_thread_local, "sqlite_conn_path", None)

  if conn is not None and cached_path == resolved_path:
    try:
      cur = conn.cursor()
      cur.execute("SELECT 1")
      cur.close()
      return conn
    except Exception:
      try:
        conn.close()
      except Exception:
        pass
      _thread_local.sqlite_conn = None

  conn = sqlite3.connect(resolved_path)
  conn.row_factory = sqlite3.Row
  _thread_local.sqlite_conn = conn
  _thread_local.sqlite_conn_path = resolved_path
  return conn

def get_record_by_unique_field(config: Dict[str, Any], table_name: str, unique_field: str, value: str) -> Optional[Dict[str, Any]]:
  db_type = config.get("dbType")
  database = config.get("database")
  val_clean = str(value).strip() if value is not None else ""
  if not val_clean or not table_name:
    return None

  ACCESSION_HINTS = (
    "acc_no", "accno", "accession", "accessionno", "accession_no",
    "accession_number", "accessionnumber", "barcode", "id"
  )

  if db_type == "sqlite":
    sqlite_path = config.get("sqlitePath")
    try:
      conn = get_cached_sqlite_conn(sqlite_path)
    except Exception as e:
      logger.error(f"SQLite connection error: {e}")
      return None

    cursor = conn.cursor()
    safe_table = "".join(c for c in table_name if c.isalnum() or c in '_')
    safe_field = "".join(c for c in unique_field if c.isalnum() or c in '_') if unique_field else ""

    # 1. Direct indexed match on unique_field
    if safe_field:
      try:
        cursor.execute(f'SELECT * FROM "{safe_table}" WHERE "{safe_field}" = ? LIMIT 1', (val_clean,))
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
      except sqlite3.OperationalError:
        pass
      except Exception:
        pass

    # 2. Fallback check only if safe_field did not exist in table
    cache_key = f"sqlite:{sqlite_path}:{safe_table}"
    actual_cols = _columns_cache.get(cache_key)
    if not actual_cols:
      try:
        cursor.execute(f'PRAGMA table_info("{safe_table}")')
        actual_cols = [r[1] for r in cursor.fetchall()]
        _columns_cache[cache_key] = actual_cols
      except Exception:
        actual_cols = []

    matched_col = None
    for col in actual_cols:
      if col.lower() in ACCESSION_HINTS:
        matched_col = col
        break

    if matched_col:
      try:
        cursor.execute(f'SELECT * FROM "{safe_table}" WHERE "{matched_col}" = ? LIMIT 1', (val_clean,))
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
      except Exception:
        pass

    cursor.close()
    return None

  elif db_type == "mysql":
    try:
      conn = get_cached_mysql_conn(config)
    except Exception as e:
      logger.error(f"MySQL connection error: {e}")
      return None

    cursor = conn.cursor()
    safe_table = f"`{table_name}`"

    # 1. Direct indexed match on unique_field
    if unique_field:
      safe_fld = f"`{unique_field}`"
      try:
        cursor.execute(f"SELECT * FROM {safe_table} WHERE {safe_fld} = %s LIMIT 1", (val_clean,))
        row = cursor.fetchone()
        cursor.close()
        return row
      except pymysql.err.OperationalError:
        pass
      except Exception:
        pass

    # 2. Fallback check only if unique_field was invalid or not in table
    cache_key = f"mysql:{database}:{table_name}"
    actual_cols = _columns_cache.get(cache_key)
    if not actual_cols:
      try:
        cursor.execute(f"SHOW COLUMNS FROM {safe_table}")
        actual_cols = [r['Field'] for r in cursor.fetchall()]
        _columns_cache[cache_key] = actual_cols
      except Exception:
        actual_cols = []

    matched_col = None
    for col in actual_cols:
      if col.lower() in ACCESSION_HINTS:
        matched_col = col
        break

    if matched_col:
      try:
        cursor.execute(f"SELECT * FROM {safe_table} WHERE `{matched_col}` = %s LIMIT 1", (val_clean,))
        row = cursor.fetchone()
        cursor.close()
        return row
      except Exception:
        pass

    cursor.close()
    return None

  elif db_type == "mssql":
    if not pyodbc:
      return None

    try:
      conn = get_cached_mssql_conn(config)
    except Exception as e:
      logger.error(f"MSSQL connection error: {e}")
      return None

    cursor = conn.cursor()

    if '[' in table_name or '.' in table_name:
      clean_table = "".join(c for c in table_name if c.isalnum() or c in '_.[]')
    else:
      clean_table = f"[{table_name}]"

    val_clean = str(value).strip()

    # 1. Direct indexed query on unique_field
    if unique_field:
      safe_field = unique_field.replace("[", "").replace("]", "")
      try:
        cursor.execute(f"SELECT TOP 1 * FROM {clean_table} WHERE [{safe_field}] = ?", (val_clean,))
        row = cursor.fetchone()
        if row:
          columns = [col[0] for col in cursor.description]
          res = {columns[idx]: ("" if val is None else str(val)) for idx, val in enumerate(row)}
          cursor.close()
          return res
        else:
          # Indexed column checked and 0 rows found -> Record does not exist!
          cursor.close()
          return None
      except (pyodbc.ProgrammingError, pyodbc.Error) as err:
        err_str = str(err)
        # Fall through to fallback column search only if column name is invalid (Error 207)
        if "207" not in err_str and "Invalid column" not in err_str:
          cursor.close()
          return None

    # 2. Fallback only if unique_field was not provided or had invalid column name
    cache_key = f"mssql:{database}:{table_name}"
    actual_columns = _columns_cache.get(cache_key)
    if not actual_columns:
      try:
        cursor.execute(f"SELECT TOP 1 * FROM {clean_table}")
        if cursor.description:
          actual_columns = [col[0] for col in cursor.description]
          _columns_cache[cache_key] = actual_columns
      except Exception:
        actual_columns = []

    matched_col = None
    if actual_columns:
      for col in actual_columns:
        if col.lower() in ACCESSION_HINTS:
          matched_col = col
          break

    if matched_col:
      try:
        cursor.execute(f"SELECT TOP 1 * FROM {clean_table} WHERE [{matched_col}] = ?", (val_clean,))
        row = cursor.fetchone()
        if row:
          columns = [col[0] for col in cursor.description]
          res = {columns[idx]: ("" if val is None else str(val)) for idx, val in enumerate(row)}
          cursor.close()
          return res
      except Exception:
        pass

    cursor.close()
    return None

  return None

def get_records_by_unique_field_batch(
  config: Dict[str, Any],
  table_name: str,
  unique_field: str,
  values: List[str]
) -> Dict[str, Optional[Dict[str, Any]]]:
  """
  High-performance multithreaded and chunked batch lookup for multiple accession numbers at once.
  Returns { clean_value: record_dict_or_none }.
  """
  from concurrent.futures import ThreadPoolExecutor, as_completed

  clean_values = [str(v).strip() for v in values if v is not None and str(v).strip()]
  if not clean_values or not table_name:
    return {}

  # Map lowercase term -> original/cleaned term
  term_map = {v.lower(): v for v in clean_values}
  results: Dict[str, Optional[Dict[str, Any]]] = {term: None for term in term_map.keys()}

  db_type = config.get("dbType")
  safe_field = "".join(c for c in unique_field if c.isalnum() or c in '_') if unique_field else ""

  # 1. Fast Batch Query using SQL IN (...) in chunks of 200
  chunk_size = 200
  distinct_values = list(set(term_map.values()))

  try:
    if db_type == "sqlite" and safe_field:
      sqlite_path = config.get("sqlitePath")
      conn = get_cached_sqlite_conn(sqlite_path)
      cursor = conn.cursor()
      safe_table = "".join(c for c in table_name if c.isalnum() or c in '_')

      for i in range(0, len(distinct_values), chunk_size):
        chunk = distinct_values[i:i + chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        cursor.execute(f'SELECT * FROM "{safe_table}" WHERE "{safe_field}" IN ({placeholders})', chunk)
        rows = cursor.fetchall()
        for r in rows:
          d = dict(r)
          for k, v in d.items():
            if k.lower() == safe_field.lower() and v is not None:
              results[str(v).strip().lower()] = d
      cursor.close()

    elif db_type == "mysql" and safe_field:
      conn = get_cached_mysql_conn(config)
      cursor = conn.cursor()
      safe_table = f"`{table_name}`"

      for i in range(0, len(distinct_values), chunk_size):
        chunk = distinct_values[i:i + chunk_size]
        placeholders = ",".join("%s" for _ in chunk)
        cursor.execute(f"SELECT * FROM {safe_table} WHERE `{safe_field}` IN ({placeholders})", chunk)
        rows = cursor.fetchall()
        for r in rows:
          d = dict(r)
          for k, v in d.items():
            if k.lower() == safe_field.lower() and v is not None:
              results[str(v).strip().lower()] = d
      cursor.close()

    elif db_type == "mssql" and safe_field and pyodbc:
      conn = get_cached_mssql_conn(config)
      cursor = conn.cursor()
      clean_table = f"[{table_name}]" if not ('[' in table_name or '.' in table_name) else "".join(c for c in table_name if c.isalnum() or c in '_.[]')

      for i in range(0, len(distinct_values), chunk_size):
        chunk = distinct_values[i:i + chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        cursor.execute(f"SELECT * FROM {clean_table} WHERE [{safe_field}] IN ({placeholders})", chunk)
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()
        for r in rows:
          d = {columns[idx]: ("" if val is None else str(val)) for idx, val in enumerate(r)}
          for k, v in d.items():
            if k.lower() == safe_field.lower() and v is not None:
              results[str(v).strip().lower()] = d
      cursor.close()

  except Exception as batch_err:
    logger.warning(f"Fast batch IN query notice: {batch_err}")

  # 2. Multithreaded fallback pool for any terms still missing
  missing_terms = [term_map[t_lower] for t_lower, rec in results.items() if rec is None]
  if missing_terms:
    max_workers = min(16, len(missing_terms))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
      future_to_term = {
        executor.submit(get_record_by_unique_field, config, table_name, unique_field, term): term
        for term in missing_terms
      }
      for future in as_completed(future_to_term):
        term = future_to_term[future]
        try:
          rec = future.result()
          if rec:
            results[term.lower()] = rec
        except Exception:
          pass

  return results
