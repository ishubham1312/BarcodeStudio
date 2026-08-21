import imaplib
import email
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
import re
import time
import datetime
import threading
import os
import sqlite3
from typing import List, Dict, Any, Optional
from services.db_service import get_record_by_unique_field
from services.printer_service import print_batch_to_spooler
from services.logging_service import get_logger
from utils.helpers import get_user_data_dir

logger = get_logger()

# ---------------------------------------------------------------------------
# SQLite Persistent State Helpers for IMAP UIDs & Message-ID Deduplication
# ---------------------------------------------------------------------------

def resolve_sqlite_path(path_str: Optional[str]) -> str:
    """Resolve relative SQLite paths against user writable directory."""
    from utils.helpers import get_user_data_dir
    if not path_str:
        return str(get_user_data_dir() / 'barcode_studio_library.db')
    if not os.path.isabs(path_str):
        filename = os.path.basename(path_str)
        if not filename:
            filename = 'barcode_studio_library.db'
        return str(get_user_data_dir() / filename)
    return path_str

def init_state_db(db_config: Dict[str, Any]) -> str:
    """Ensure state tables exist in the local SQLite db and return the SQLite path."""
    sqlite_path = resolve_sqlite_path(db_config.get("sqlitePath"))
        
    db_dir = os.path.dirname(sqlite_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
        
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_processing_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_email_cache (
                message_id TEXT PRIMARY KEY,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    except Exception as e:
        logger.error(f"[GmailState] Failed to initialize state tables: {e}")
    finally:
        conn.close()
    return sqlite_path

def get_db_state(sqlite_path: str, key: str, default: str = "") -> str:
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    val = default
    try:
        cursor.execute("SELECT value FROM email_processing_state WHERE key = ?", (key,))
        row = cursor.fetchone()
        if row:
            val = row[0]
    except Exception as e:
        logger.error(f"[GmailState] get_db_state error for {key}: {e}")
    finally:
        conn.close()
    return val

def set_db_state(sqlite_path: str, key: str, value: str) -> None:
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR REPLACE INTO email_processing_state (key, value) VALUES (?, ?)", (key, value))
        conn.commit()
    except Exception as e:
        logger.error(f"[GmailState] set_db_state error for {key}: {e}")
    finally:
        conn.close()

def is_message_processed(sqlite_path: str, message_id: str) -> bool:
    if not message_id:
        return False
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    exists = False
    try:
        cursor.execute("SELECT 1 FROM processed_email_cache WHERE message_id = ?", (message_id,))
        exists = cursor.fetchone() is not None
    except Exception as e:
        logger.error(f"[GmailState] is_message_processed error: {e}")
    finally:
        conn.close()
    return exists

def mark_message_processed(sqlite_path: str, message_id: str) -> None:
    if not message_id:
        return
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR IGNORE INTO processed_email_cache (message_id) VALUES (?)", (message_id,))
        conn.commit()
    except Exception as e:
        logger.error(f"[GmailState] mark_message_processed error: {e}")
    finally:
        conn.close()

def prune_processed_cache(sqlite_path: str, limit: int = 1000) -> None:
    conn = sqlite3.connect(sqlite_path)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            DELETE FROM processed_email_cache 
            WHERE message_id NOT IN (
                SELECT message_id FROM processed_email_cache 
                ORDER BY processed_at DESC LIMIT ?
            )
        """, (limit,))
        conn.commit()
    except Exception as e:
        logger.error(f"[GmailState] prune_processed_cache error: {e}")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Module-level last-poll timestamp (thread-safe fallback).
# ---------------------------------------------------------------------------
_last_poll_lock = threading.Lock()
_last_poll_time: Optional[datetime.datetime] = None   # UTC

def get_last_poll_time() -> Optional[datetime.datetime]:
    with _last_poll_lock:
        return _last_poll_time

def set_last_poll_time(dt: datetime.datetime) -> None:
    global _last_poll_time
    with _last_poll_lock:
        _last_poll_time = dt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_print_command(command_str: str, available_template_keys: List[str]) -> Dict[str, Any]:
    """
    Parses a single print command line.

    Format: <AccessionNumber>[/options...]

    Examples:
        888102765866          -> all templates, 2 copies each (default)
        906324/a              -> template A only, 2 copies
        1001234/3             -> all templates, 3 copies each
        810162/4/a1           -> all × 4, template A overridden to 1
        1001235/a2/b5         -> template A × 2, template B × 5
        914954/a/b3           -> template A × 2, template B × 3
    """
    command_str = command_str.strip()
    if not command_str:
        return {"success": False, "error": "Empty command line"}

    parts = [p.strip() for p in command_str.split("/") if p.strip()]
    if not parts:
        return {"success": False, "error": "Invalid command format (no parts found)"}

    accession = parts[0]
    options = parts[1:]

    if not options:
        return {
            "success": True,
            "accession": accession,
            "templates": {tk: 2 for tk in available_template_keys},
        }

    global_copies = None
    template_overrides: Dict[str, int] = {}

    for opt in options:
        if re.match(r"^\d+$", opt):
            val = int(opt)
            if val < 0:
                return {"success": False, "error": f"Invalid negative copy count: '{opt}'"}
            global_copies = val
        else:
            match = re.match(r"^([a-z])(\d+)?$", opt)
            if not match:
                return {"success": False, "error": f"Invalid option format: '{opt}'"}
            t_letter = match.group(1)
            t_copies_str = match.group(2)
            if available_template_keys and t_letter not in available_template_keys:
                return {
                    "success": False,
                    "error": (
                        f"Unknown template key '{t_letter}' "
                        f"(configured: {', '.join(available_template_keys)})"
                    ),
                }
            copies = int(t_copies_str) if t_copies_str is not None else 2
            if copies < 0:
                return {"success": False, "error": f"Invalid negative copy count for '{t_letter}': '{opt}'"}
            template_overrides[t_letter] = copies

    final_templates: Dict[str, int] = {}
    if global_copies is not None:
        for tk in available_template_keys:
            final_templates[tk] = template_overrides.get(tk, global_copies)
    else:
        if not template_overrides:
            return {"success": False, "error": "No target templates or global count in options"}
        final_templates = template_overrides

    return {"success": True, "accession": accession, "templates": final_templates}


def get_email_body(msg) -> str:
    """Extract plain-text body from an email.Message object."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if (part.get_content_type() == "text/plain"
                    and "attachment" not in str(part.get("Content-Disposition"))):
                payload = part.get_payload(decode=True)
                if payload:
                    body += payload.decode("utf-8", errors="ignore")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="ignore")
    return body


def extract_accession_commands(body: str) -> List[str]:
    """
    Extract print command lines from an email body.

    Handles two input styles:

    Standard (one per line):
        888102765866
        906324/a
        1001234/3

    Compact (all on one line, slash-separated):
        888102765866/a906324/a1/b31001234/3810162/4/a11001235/a2/b5914954/a/b3

    A token is treated as a new accession when it consists of 4+ leading digits.
    """
    lines: List[str] = []

    for raw in body.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        if not re.match(r"^\d", raw):
            continue  # skip non-digit lines (headers, signatures, etc.)

        tokens = [t.strip() for t in raw.split("/") if t.strip()]
        commands: List[str] = []
        current: List[str] = []

        for tok in tokens:
            if re.match(r"^\d{4,}", tok):
                if current:
                    commands.append("/".join(current))
                current = [tok]
            else:
                current.append(tok)

        if current:
            commands.append("/".join(current))

        lines.extend(commands)

    # Deduplicate, preserve order
    seen: set = set()
    result: List[str] = []
    for cmd in lines:
        if cmd not in seen:
            seen.add(cmd)
            result.append(cmd)

    return result


def parse_email_date(msg) -> Optional[datetime.datetime]:
    """Parse the Date header of an email into a UTC-aware datetime, or None."""
    date_str = msg.get("Date")
    if not date_str:
        return None
    try:
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        else:
            dt = dt.astimezone(datetime.timezone.utc)
        return dt
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main Poller using IMAP UIDs & Message-ID Deduplication
# ---------------------------------------------------------------------------

def poll_gmail_inbox_and_print(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Polls Gmail inbox via IMAP using database-backed UIDs and Message-IDs.
    Guarantees exactly-once processing and printing.
    """
    logs: List[str] = []
    mail = None

    try:
        # ------------------------------------------------------------------ params
        gmail_address      = params.get("gmailAddress")
        gmail_app_password = params.get("gmailAppPassword")
        trigger_subjects: List[str]      = params.get("triggerSubjects", [])
        verified_only: bool              = params.get("verifiedOnly", False)
        verified_senders: List[str]      = params.get("verifiedSenders", [])
        templates_list: List[Dict]       = params.get("templates", [])
        template_mappings: Dict[str,str] = params.get("templateMappings", {})
        printer_name: str                = params.get("printerName", "")
        db_config: Dict[str, Any]        = params.get("dbConfig", {})

        # ----------------------------------------------------------------- validate
        if not gmail_address or not gmail_app_password:
            return {"success": False, "error": "Gmail address or app password not configured.", "logs": logs}
        if not templates_list:
            return {"success": False, "error": "No templates registered for print mapping.", "logs": logs}
        if not template_mappings:
            return {"success": False, "error": "No template key mappings provided.", "logs": logs}
        if not printer_name:
            return {"success": False, "error": "No active printer selected.", "logs": logs}
        if not db_config:
            return {"success": False, "error": "No database connection config provided.", "logs": logs}

        table_name: str  = db_config.get("table", "")
        unique_field: str = db_config.get("uniqueField", "")

        if not table_name:
            logs.append("[ERROR] Database table is not configured. Set a table in DB Settings.")
            return {"success": False, "error": "Database table not configured.", "logs": logs}

        if not unique_field:
            logs.append(
                "[WARN] Unique field is not configured — will attempt auto-detection from table columns."
            )

        available_keys = sorted(list(template_mappings.keys()))

        # Initialize State Tables and fetch path
        sqlite_path = init_state_db(db_config)

        # ---------------------------------------------------------------- connect
        logs.append("[IMAP] Connecting to secure IMAP gateway 'imap.gmail.com:993'...")

        total_spooled_pages = 0
        total_accessions_printed = 0
        processed_count = 0
        skipped_duplicate = 0
        printed_jobs = []

        import ssl
        try:
            context = ssl.create_default_context()
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=context)
        except Exception as ssl_err:
            logs.append(f"[IMAP] [WARN] SSL connection verification failed ({ssl_err}). Retrying with unverified SSL context...")
            logger.warning(f"Default IMAP SSL connection failed: {ssl_err}. Retrying with unverified SSL context...")
            context = ssl._create_unverified_context()
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=context)

        mail.login(gmail_address, gmail_app_password)
        logs.append(f"[AUTH] Access Granted! Logged in as '{gmail_address}'.")

        mail.select("INBOX")

        # Query current UIDVALIDITY and UIDNEXT standard status details
        status, status_data = mail.status("INBOX", "(UIDVALIDITY UIDNEXT)")
        current_uid_validity = ""
        if status == "OK" and status_data and status_data[0]:
            val_match = re.search(r'UIDVALIDITY\s+(\d+)', status_data[0].decode('utf-8', errors='ignore'))
            current_uid_validity = val_match.group(1) if val_match else ""
            
        logs.append(f"[IMAP] Current INBOX UIDVALIDITY: {current_uid_validity}")

        # Fetch saved state
        saved_uid_validity = get_db_state(sqlite_path, "uid_validity", "")
        last_processed_uid_str = get_db_state(sqlite_path, "last_processed_uid", "0")
        last_processed_uid = int(last_processed_uid_str) if last_processed_uid_str.isdigit() else 0

        # Detect UID resets or empty state
        uid_reset = False
        if saved_uid_validity and saved_uid_validity != current_uid_validity:
            logs.append(f"[IMAP] [WARNING] Mailbox UIDVALIDITY changed (saved: {saved_uid_validity}, current: {current_uid_validity}). Resetting UID counter to prevent full reprocessing.")
            uid_reset = True

        if uid_reset or not saved_uid_validity or last_processed_uid == 0:
            # Find the max UID currently in the inbox to seed our pointer
            status, search_res = mail.uid('search', None, 'ALL')
            if status == "OK" and search_res and search_res[0]:
                all_uids = [int(x) for x in search_res[0].split() if x.isdigit()]
                if all_uids:
                    last_processed_uid = max(all_uids)
                    logs.append(f"[IMAP] Seeded last_processed_uid to latest inbox UID: {last_processed_uid}")
                else:
                    last_processed_uid = 0
                    logs.append("[IMAP] Inbox is empty. Seeded last_processed_uid to 0.")
            else:
                last_processed_uid = 0
                logs.append("[IMAP] Could not retrieve UIDs. Seeded last_processed_uid to 0.")
                
            set_db_state(sqlite_path, "uid_validity", current_uid_validity)
            set_db_state(sqlite_path, "last_processed_uid", str(last_processed_uid))
        else:
            logs.append(f"[IMAP] Resuming from last_processed_uid: {last_processed_uid}")

        # Fetch UIDs of all unseen (unread) emails
        status, messages = mail.uid('search', None, 'UNSEEN')
        if status != "OK":
            raise ValueError("Failed to query inbox UIDs.")

        email_uids = []
        if messages and messages[0]:
            email_uids = sorted([int(x) for x in messages[0].split() if x.isdigit()])

        total_found = len(email_uids)
        logs.append(f"[SCAN] Found {total_found} unread (UNSEEN) email(s) in INBOX.")

        for msg_uid in email_uids:
            res, msg_data = mail.uid('fetch', str(msg_uid), '(RFC822)')
            if res != "OK" or not msg_data:
                logs.append(f"[ERROR] Failed to fetch email UID {msg_uid}. Skipping.")
                continue

            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue

                msg = email.message_from_bytes(response_part[1])

                # ---- Message-ID Deduplication Cache Check ----
                message_id = msg.get("Message-ID")
                if message_id:
                    message_id = message_id.strip()
                    if is_message_processed(sqlite_path, message_id):
                        logs.append(f"[SCAN] Email UID {msg_uid} (Message-ID: {message_id}) already processed in a previous session. Skipping.")
                        skipped_duplicate += 1
                        # Update UID state in DB to keep pointers moving forward
                        set_db_state(sqlite_path, "last_processed_uid", str(msg_uid))
                        last_processed_uid = msg_uid
                        continue

                # ---- decode Subject ----
                subject = ""
                subject_header = msg.get("Subject")
                if subject_header:
                    decoded = decode_header(subject_header)
                    subject_parts = []
                    for sub, enc in decoded:
                        if isinstance(sub, bytes):
                            subject_parts.append(sub.decode(enc or "utf-8", errors="ignore"))
                        else:
                            subject_parts.append(str(sub))
                    subject = "".join(subject_parts)

                # ---- decode Sender ----
                from_header = msg.get("From") or ""
                decoded_from = decode_header(from_header)
                from_parts = []
                for val, enc in decoded_from:
                    if isinstance(val, bytes):
                        from_parts.append(val.decode(enc or "utf-8", errors="ignore"))
                    else:
                        from_parts.append(str(val))
                sender_full = "".join(from_parts)
                sender_name, sender_email = parseaddr(sender_full)
                sender_email = sender_email.strip().lower()
                sender_address = f"{sender_name} <{sender_email}>" if sender_name else sender_email

                # ---- subject filter ----
                subject_clean = subject.strip()
                subject_matches = any(
                    subj.strip().lower() == subject_clean.lower()
                    for subj in trigger_subjects
                )

                if not subject_matches:
                    # Not a print trigger, but we still mark it as read/processed so we don't scan it again
                    if message_id:
                        mark_message_processed(sqlite_path, message_id)
                    set_db_state(sqlite_path, "last_processed_uid", str(msg_uid))
                    last_processed_uid = msg_uid
                    continue

                # ---- time parsed for logging ----
                email_dt = parse_email_date(msg)
                email_time_str = email_dt.strftime("%Y-%m-%d %H:%M:%S UTC") if email_dt else "unknown time"
                logs.append(
                    f"[PARSE] Print trigger email - "
                    f"Subject: '{subject}' | From: '{sender_address}' | Received: {email_time_str}"
                )

                # ---- sender filter ----
                if verified_only:
                    is_approved = any(
                        addr.strip().lower() == sender_email
                        for addr in verified_senders
                    )
                    if not is_approved:
                        logs.append(
                            f"[SECURITY] [BLOCKED] '{sender_email}' is not in the "
                            f"Verified Senders list. Ignored."
                        )
                        if message_id:
                            mark_message_processed(sqlite_path, message_id)
                        set_db_state(sqlite_path, "last_processed_uid", str(msg_uid))
                        last_processed_uid = msg_uid
                        continue
                    logs.append(f"[SECURITY] [VERIFIED] Sender '{sender_email}' approved.")

                # ---- parse body ----
                body = get_email_body(msg)
                commands = extract_accession_commands(body)

                if not commands:
                    logs.append(
                        "[PARSE] [WARNING] No valid accession commands found in body. "
                        "Body must contain 4+ digit accession numbers."
                    )
                    if message_id:
                        mark_message_processed(sqlite_path, message_id)
                    set_db_state(sqlite_path, "last_processed_uid", str(msg_uid))
                    last_processed_uid = msg_uid
                    continue

                accession_list = ", ".join(c.split("/")[0] for c in commands)
                logs.append(
                    f"[PARSE] Extracted {len(commands)} command(s) - "
                    f"Accessions: {accession_list}"
                )

                field_display = unique_field if unique_field else "(auto-detect)"
                logs.append(
                    f"[DB] Querying table '[{table_name}]' using field '[{field_display}]'..."
                )

                print_failed = False
                # ---- process each accession ----
                for line_no, cmd_line in enumerate(commands, 1):
                    parsed = parse_print_command(cmd_line, available_keys)
                    if not parsed["success"]:
                        logs.append(
                            f"[ERROR] Command #{line_no} '{cmd_line}' invalid: {parsed['error']}."
                        )
                        continue

                    accession = parsed["accession"]
                    target_templates_map: Dict[str, int] = parsed["templates"]

                    logs.append(
                        f"[QUERY] [{line_no}/{len(commands)}] Looking up accession '{accession}'..."
                    )

                    try:
                        record = get_record_by_unique_field(
                            db_config,
                            table_name,
                            unique_field,
                            accession,
                        )
                    except Exception as db_err:
                        logs.append(
                            f"[ERROR] DB query failed for '{accession}': {db_err}."
                        )
                        print_failed = True
                        printed_jobs.append({
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            "method": "email",
                            "senderEmail": sender_address,
                            "accessionNo": accession,
                            "copies": sum(target_templates_map.values()) if target_templates_map else 1,
                            "templates": [template_mappings.get(k) for k in target_templates_map.keys() if template_mappings.get(k)] if target_templates_map else [],
                            "printerName": printer_name,
                            "status": "failed",
                            "error": f"DB query failed: {str(db_err)}"
                        })
                        continue

                    if not record:
                        logs.append(
                            f"[ERROR] Accession '{accession}' not found in database. Skipping."
                        )
                        printed_jobs.append({
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            "method": "email",
                            "senderEmail": sender_address,
                            "accessionNo": accession,
                            "copies": sum(target_templates_map.values()) if target_templates_map else 1,
                            "templates": [template_mappings.get(k) for k in target_templates_map.keys() if template_mappings.get(k)] if target_templates_map else [],
                            "printerName": printer_name,
                            "status": "failed",
                            "error": f"Accession '{accession}' not found in database"
                        })
                        continue

                    title_val = (
                        record.get("TITLE") or record.get("Title") or record.get("title")
                        or record.get("NAME") or record.get("Name") or "(no title)"
                    )
                    author_val = (
                        record.get("AUTHOR") or record.get("Author") or record.get("author")
                        or record.get("WRITER") or ""
                    )
                    display = f"'{title_val}'"
                    if author_val:
                        display += f" by {author_val}"
                    logs.append(f"[QUERY] [SUCCESS] Found: {display}")

                    # ---- spool interleaved templates in a single print job ----
                    queue = []
                    max_copies = max(target_templates_map.values()) if target_templates_map else 0
                    
                    template_objs = {}
                    for letter_key in sorted(target_templates_map.keys()):
                        template_id = template_mappings.get(letter_key)
                        template_obj = next(
                            (t for t in templates_list if t.get("id") == template_id),
                            None,
                        )
                        if template_obj:
                            template_objs[letter_key] = template_obj
                        else:
                            logs.append(
                                f"[ERROR] Key '{letter_key}' -> template ID '{template_id}' not found."
                            )

                    for c in range(max_copies):
                        for letter_key in sorted(target_templates_map.keys()):
                            copies_needed = target_templates_map[letter_key]
                            if c < copies_needed:
                                t_obj = template_objs.get(letter_key)
                                if t_obj:
                                    queue.append({"template": t_obj, "record": record})

                    if not queue:
                        logs.append(
                            f"[SPOOL] Skipping print for '{accession}' (0 copies or no templates found)."
                        )
                        continue

                    first_template = queue[0]["template"]
                    try:
                        spool_res = print_batch_to_spooler(
                            printer_name, queue, 1, first_template
                        )
                    except Exception as spool_err:
                        logs.append(
                            f"[ERROR] Spooler exception for '{accession}': {spool_err}"
                        )
                        print_failed = True
                        printed_jobs.append({
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            "method": "email",
                            "senderEmail": sender_address,
                            "accessionNo": accession,
                            "copies": sum(target_templates_map.values()),
                            "templates": [template_mappings.get(k) for k in target_templates_map.keys() if template_mappings.get(k)],
                            "printerName": printer_name,
                            "status": "failed",
                            "error": str(spool_err)
                        })
                        continue

                    if spool_res.get("success"):
                        pages_printed = len(queue)
                        logs.append(
                            f"[SPOOL] [SUCCESS] '{accession}' -> interleaved {pages_printed} labels -> '{printer_name}'"
                        )
                        total_spooled_pages += pages_printed
                        printed_jobs.append({
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            "method": "email",
                            "senderEmail": sender_address,
                            "accessionNo": accession,
                            "copies": sum(target_templates_map.values()),
                            "templates": [template_mappings.get(k) for k in target_templates_map.keys() if template_mappings.get(k)],
                            "printerName": printer_name,
                            "status": "success"
                        })
                    else:
                        logs.append(
                            f"[ERROR] Spooler failure - '{accession}': {spool_res.get('message', 'Unknown error')}"
                        )
                        print_failed = True
                        printed_jobs.append({
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            "method": "email",
                            "senderEmail": sender_address,
                            "accessionNo": accession,
                            "copies": sum(target_templates_map.values()),
                            "templates": [template_mappings.get(k) for k in target_templates_map.keys() if template_mappings.get(k)],
                            "printerName": printer_name,
                            "status": "failed",
                            "error": spool_res.get('message', 'Unknown error')
                        })

                    total_accessions_printed += 1

                # Job Completed: update transaction state for UID and Message-ID cache
                if print_failed:
                    logs.append(f"[IMAP] [WARNING] Print failed for email UID {msg_uid}. Marking as UNREAD (unseen) to retry.")
                    try:
                        mail.uid('store', str(msg_uid), '-FLAGS', '\\Seen')
                    except Exception as store_err:
                        logs.append(f"[ERROR] Failed to mark email UID {msg_uid} as unread: {store_err}")
                else:
                    if message_id:
                        mark_message_processed(sqlite_path, message_id)
                    set_db_state(sqlite_path, "last_processed_uid", str(msg_uid))
                    last_processed_uid = msg_uid
                    processed_count += 1

        if skipped_duplicate > 0:
            logs.append(
                f"[TIME] Skipped {skipped_duplicate} email(s) already processed in a previous poll."
            )

        # Prune deduplication cache to keep it fast
        prune_processed_cache(sqlite_path, 1000)

        # ---------------------------------------------------------------- done
        if total_spooled_pages > 0:
            logs.append(
                f"[FINISHED] [OK] Done. {processed_count} trigger email(s) processed. "
                f"{total_accessions_printed} accession(s) printed. "
                f"{total_spooled_pages} label page(s) sent to '{printer_name}'."
            )
            logs.append(f"[PRINT_DONE] {total_accessions_printed}:{total_spooled_pages}")
        else:
            logs.append(
                f"[FINISHED] Done. {processed_count} trigger email(s) processed. "
                f"No labels spooled."
            )

        return {
            "success": True,
            "logs": logs,
            "printedCount": total_accessions_printed,
            "spooledPages": total_spooled_pages,
            "printedJobs": printed_jobs,
            "lastPollTime": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error(f"Error in Gmail Print poller: {e}")
        logs.append(f"[FATAL] Error: {str(e)}")
        return {"success": False, "error": str(e), "logs": logs}
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass
