"""Taskflow local API. Python 3.11+, standard library only. Never bind beyond loopback."""
import argparse
import contextlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

STATUSES = {'todo', 'doing', 'blocked', 'done', 'cancelled'}
PRIORITIES = {'low', 'medium', 'high', 'urgent'}
DEFAULT_SETTINGS = {'email': '', 'reminder_enabled': False, 'reminder_hour': 8, 'utc_offset': 420}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def text(value, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ApiError('Nội dung không hợp lệ hoặc quá dài.')
    return value.strip()


def valid_date(value, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ApiError('Ngày phải theo định dạng YYYY-MM-DD.')
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ApiError('Ngày không hợp lệ.')
    return value


def validate_task(data):
    result = {
        'title': text(data.get('title', ''), 200, True),
        'description': text(data.get('description', ''), 15000),
        'status': data.get('status', 'todo'), 'priority': data.get('priority', 'medium'),
        'project': text(data.get('project', 'Cá nhân'), 80, True),
        'start_date': valid_date(data.get('start_date') or None, True),
        'due_date': valid_date(data.get('due_date') or None, True),
        'today': data.get('today', False), 'checklist': data.get('checklist', [])
    }
    if result['status'] not in STATUSES or result['priority'] not in PRIORITIES:
        raise ApiError('Trạng thái hoặc ưu tiên không hợp lệ.')
    if not isinstance(result['today'], bool):
        raise ApiError('Giá trị My Day không hợp lệ.')
    if result['start_date'] and result['due_date'] and result['start_date'] > result['due_date']:
        raise ApiError('Ngày bắt đầu không được sau hạn hoàn thành.')
    items = result['checklist']
    if not isinstance(items, list) or len(items) > 100:
        raise ApiError('Checklist tối đa 100 mục.')
    clean = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('done'), bool):
            raise ApiError('Checklist không hợp lệ.')
        clean.append({'id': text(item.get('id', ''), 80, True), 'text': text(item.get('text', ''), 300, True), 'done': item['done']})
    if len({i['id'] for i in clean}) != len(clean):
        raise ApiError('Checklist có mã trùng.')
    result['checklist'] = clean
    return result


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS logs (
              id TEXT PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
              content TEXT NOT NULL, minutes INTEGER NOT NULL,
              work_date TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER,
              task_title TEXT NOT NULL, action TEXT NOT NULL,
              changes TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reminders (
              day TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL, updated_at TEXT NOT NULL);
            ''')
            db.execute('INSERT OR IGNORE INTO settings VALUES (1, ?)', (json.dumps(DEFAULT_SETTINGS),))

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def event(self, db, task_id, title, action, changes=None):
        db.execute('INSERT INTO events(task_id,task_title,action,changes,created_at) VALUES(?,?,?,?,?)',
                   (task_id, title, action, json.dumps(changes or {}, ensure_ascii=False), now()))

    @staticmethod
    def unpack(row):
        return {'start_date': None, **json.loads(row['data']), **{k: row[k] for k in ['id', 'created_at', 'updated_at', 'deleted_at', 'version']}}

    def task(self, db, task_id):
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if not row:
            raise ApiError('Không tìm thấy task.', 404)
        return self.unpack(row)

    def state(self):
        with self.db() as db:
            tasks = [self.unpack(r) for r in db.execute('SELECT * FROM tasks ORDER BY id DESC')]
            logs = [dict(r) for r in db.execute('SELECT * FROM logs ORDER BY work_date DESC, created_at DESC')]
            events = [{**dict(r), 'changes': json.loads(r['changes'])} for r in db.execute('SELECT * FROM events ORDER BY id DESC')]
            settings = json.loads(db.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            reminder = db.execute('SELECT * FROM reminders ORDER BY updated_at DESC LIMIT 1').fetchone()
        return {'tasks': tasks, 'logs': logs, 'events': events, 'settings': settings,
                'system': {'smtp_configured': smtp_ready(), 'database': str(self.path), 'last_reminder': dict(reminder) if reminder else None}}

    def create(self, data):
        clean = validate_task(data)
        stamp = now()
        with self.db() as db:
            cursor = db.execute('INSERT INTO tasks(data,created_at,updated_at) VALUES(?,?,?)', (json.dumps(clean), stamp, stamp))
            self.event(db, cursor.lastrowid, clean['title'], 'created')
            return self.task(db, cursor.lastrowid)

    def update(self, task_id, data):
        allowed = {'title','description','status','priority','project','start_date','due_date','today','checklist','version'}
        if not isinstance(data, dict) or set(data) - allowed:
            raise ApiError('Trường cập nhật không hợp lệ.')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = self.task(db, task_id)
            if previous['deleted_at']:
                raise ApiError('Hãy khôi phục task trước khi sửa.', 409)
            if data.get('version') != previous['version']:
                raise ApiError('Task đã thay đổi. Đóng chi tiết và mở lại để lấy dữ liệu mới.', 409)
            clean = validate_task({**previous, **data})
            changes = {k: {'before': previous[k], 'after': v} for k, v in clean.items() if previous[k] != v}
            if changes:
                db.execute('UPDATE tasks SET data=?,updated_at=?,version=version+1 WHERE id=?', (json.dumps(clean), now(), task_id))
                self.event(db, task_id, clean['title'], 'updated', changes)
            return self.task(db, task_id)

    def trash(self, task_id, restore=False):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            task = self.task(db, task_id)
            if bool(task['deleted_at']) == (not restore):
                return task
            db.execute('UPDATE tasks SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?', (None if restore else now(), now(), task_id))
            self.event(db, task_id, task['title'], 'restored' if restore else 'deleted')
            return self.task(db, task_id)

    def add_log(self, task_id, data):
        content = text(data.get('content', ''), 10000, True)
        minutes = data.get('minutes', 0)
        if type(minutes) is not int or not 1 <= minutes <= 1440:
            raise ApiError('Thời gian phải từ 1 đến 1.440 phút.')
        work_date = valid_date(data.get('work_date'))
        with self.db() as db:
            task = self.task(db, task_id)
            if task['deleted_at']:
                raise ApiError('Task đang ở thùng rác.', 409)
            result = {'id': str(uuid.uuid4()), 'task_id': task_id, 'content': content, 'minutes': minutes, 'work_date': work_date, 'created_at': now()}
            db.execute('INSERT INTO logs VALUES(:id,:task_id,:content,:minutes,:work_date,:created_at)', result)
            self.event(db, task_id, task['title'], 'logged', {'work_log': {'before': None, 'after': {'content': content, 'minutes': minutes, 'work_date': work_date}}})
            return result

    def settings(self, data):
        email = text(data.get('email', ''), 254)
        if email and not re.fullmatch(r'[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+', email):
            raise ApiError('Địa chỉ email không hợp lệ.')
        enabled = data.get('reminder_enabled', False)
        hour, offset = data.get('reminder_hour', 8), data.get('utc_offset', 420)
        if type(enabled) is not bool or type(hour) is not int or not 0 <= hour <= 23 or type(offset) is not int or not -720 <= offset <= 840:
            raise ApiError('Cấu hình nhắc việc không hợp lệ.')
        if enabled and (not email or not smtp_ready()):
            raise ApiError('Cần địa chỉ email nhận và cấu hình SMTP trước khi bật nhắc việc.')
        clean = {'email': email, 'reminder_enabled': enabled, 'reminder_hour': hour, 'utc_offset': offset}
        with self.db() as db:
            old = json.loads(db.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            db.execute('UPDATE settings SET data=? WHERE id=1', (json.dumps(clean),))
            changes = {k: {'before': old.get(k), 'after': v} for k,v in clean.items() if old.get(k) != v}
            if changes:
                self.event(db, None, 'Cài đặt', 'settings', changes)
        return clean

    def export(self):
        state = self.state()
        return {'schema_version': 1, 'exported_at': now(), **{k: state[k] for k in ['tasks','logs','events','settings']}}

    def restore_backup(self, data):
        if not isinstance(data, dict) or data.get('schema_version') != 1:
            raise ApiError('Bản sao lưu không đúng định dạng Taskflow v1.')
        for key in ['tasks','logs','events']:
            if not isinstance(data.get(key), list) or len(data[key]) > 100000:
                raise ApiError('Bản sao lưu không hợp lệ hoặc quá lớn.')
        tasks, logs, events = [], [], []
        def timestamp(v):
            if not isinstance(v, str) or len(v) > 60:
                raise ApiError('Thời gian sao lưu không hợp lệ.')
            try:
                parsed = datetime.fromisoformat(v)
                if parsed.tzinfo is None:
                    raise ValueError()
            except ValueError:
                raise ApiError('Thời gian sao lưu không hợp lệ.')
            return v
        for t in data['tasks']:
            if type(t.get('id')) is not int or t['id'] <= 0:
                raise ApiError('Mã task không hợp lệ.')
            tasks.append((t['id'], json.dumps(validate_task(t)), timestamp(t['created_at']), timestamp(t['updated_at']), timestamp(t['deleted_at']) if t.get('deleted_at') else None, 1))
        ids = {t[0] for t in tasks}
        if len(ids) != len(tasks):
            raise ApiError('Mã task bị trùng.')
        for log in data['logs']:
            if log.get('task_id') not in ids or type(log.get('minutes')) is not int or not 1 <= log['minutes'] <= 1440:
                raise ApiError('Work log không hợp lệ.')
            logs.append((text(log.get('id'), 80, True), log['task_id'], text(log.get('content'), 10000, True), log['minutes'], valid_date(log.get('work_date')), timestamp(log['created_at'])))
        for event in sorted(data['events'], key=lambda e: e.get('id', 0)):
            changes = event.get('changes', {})
            if not isinstance(changes, dict) or len(json.dumps(changes)) > 100000:
                raise ApiError('Lịch sử không hợp lệ.')
            for v in changes.values():
                if not isinstance(v, dict) or not {'before','after'} <= set(v):
                    raise ApiError('Chi tiết lịch sử không hợp lệ.')
            events.append((event.get('task_id'), text(event.get('task_title'),200,True), text(event.get('action'),30,True), json.dumps(changes),timestamp(event['created_at'])))
        # Serialize the pre-restore snapshot while holding the write transaction.
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            backup = self.path.parent / ('before-restore-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3) + '.json')
            backup.write_text(json.dumps(self.export(), ensure_ascii=False, indent=2), encoding='utf-8')
            db.execute('DELETE FROM logs')
            db.execute('DELETE FROM events')
            db.execute('DELETE FROM tasks')
            db.executemany('INSERT INTO tasks(id,data,created_at,updated_at,deleted_at,version) VALUES(?,?,?,?,?,?)', tasks)
            db.executemany('INSERT INTO logs VALUES(?,?,?,?,?,?)', logs)
            db.executemany('INSERT INTO events(task_id,task_title,action,changes,created_at) VALUES(?,?,?,?,?)', events)
            # Do not overwrite local notification settings or delivery receipts with cloud data.
            self.event(db, None, 'Workspace', 'backup_restored', {'tasks': {'before': None, 'after': len(tasks)}})
        return {'restored': len(tasks), 'safety_backup': str(backup)}


def smtp_ready():
    return bool(os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM') and os.getenv('SMTP_SECURITY', 'starttls') in {'starttls','ssl'})


def send_email(recipient, subject, body):
    message = EmailMessage()
    message['From'], message['To'], message['Subject'] = os.environ['SMTP_FROM'], recipient, subject
    message.set_content(body)
    secure = os.getenv('SMTP_SECURITY', 'starttls')
    host = os.environ['SMTP_HOST']
    port = int(os.getenv('SMTP_PORT', '465' if secure == 'ssl' else '587'))
    if secure not in {'ssl', 'starttls'}:
        raise ValueError('SMTP TLS required')
    context = ssl.create_default_context()
    with (smtplib.SMTP_SSL(host, port, timeout=20, context=context) if secure == 'ssl' else smtplib.SMTP(host, port, timeout=20)) as smtp:
        if secure == 'starttls':
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        if os.getenv('SMTP_USERNAME'):
            smtp.login(os.environ['SMTP_USERNAME'], os.environ.get('SMTP_PASSWORD', ''))
        smtp.send_message(message)


def reminder_tick(store, sender=send_email, current=None):
    state = store.state()
    settings = state['settings']
    if not settings['reminder_enabled'] or not smtp_ready():
        return
    current = (current or datetime.now(timezone.utc)).astimezone(timezone(timedelta(minutes=settings['utc_offset'])))
    if current.hour < settings['reminder_hour']:
        return
    day = current.date().isoformat()
    tomorrow = (current.date() + timedelta(days=1)).isoformat()
    tasks = [t for t in state['tasks'] if not t['deleted_at'] and t['status'] not in {'done','cancelled'} and t['due_date'] and t['due_date'] <= tomorrow]
    if not tasks:
        return
    with store.db() as db:
        inserted = db.execute('INSERT OR IGNORE INTO reminders VALUES(?,?,?,?)', (day,'sending','',now())).rowcount
    if not inserted:
        return
    try:
        body = 'Các công việc cần chú ý:\n\n' + '\n'.join(f"TF-{t['id']:03d} · {t['title']} · hạn {t['due_date']}" for t in tasks)
        sender(settings['email'], f'Taskflow · {len(tasks)} công việc cần chú ý · {day}', body)
        status, detail = 'sent', f'{len(tasks)} task'
    except Exception as error:
        # SMTP has no idempotency guarantee. Do not automatically retry ambiguous sends.
        status, detail = 'failed', type(error).__name__ + ': Không gửi được; kiểm tra SMTP. Không tự gửi lại trong ngày để tránh trùng.'
    with store.db() as db:
        db.execute('UPDATE reminders SET status=?,detail=?,updated_at=? WHERE day=?', (status,detail,now(),day))


def make_handler(store, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_request(self):
            supplied = self.headers.get('Authorization', '')
            if not hmac.compare_digest(supplied, 'Bearer ' + token):
                return self.respond({'error': 'Unauthorized'}, 401)
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 0 or size > 10 * 1024 * 1024:
                    raise ApiError('Yêu cầu vượt quá 10 MB.', 413)
                body = json.loads(self.rfile.read(size)) if size else {}
                if not isinstance(body, dict):
                    raise ApiError('Body phải là JSON object.')
                path = urlparse(self.path).path
                method = self.command
                match = re.fullmatch(r'/tasks/(\d+)(/logs|/restore)?', path)
                if method == 'GET' and path == '/health':
                    result = {'ok': True}
                elif method == 'GET' and path == '/state':
                    result = store.state()
                elif method == 'POST' and path == '/tasks':
                    result = store.create(body)
                elif method == 'PATCH' and match and not match[2]:
                    result = store.update(int(match[1]), body)
                elif method == 'DELETE' and match and not match[2]:
                    result = store.trash(int(match[1]))
                elif method == 'POST' and match and match[2] == '/restore':
                    result = store.trash(int(match[1]), True)
                elif method == 'POST' and match and match[2] == '/logs':
                    result = store.add_log(int(match[1]), body)
                elif method == 'PUT' and path == '/settings':
                    result = store.settings(body)
                elif method == 'GET' and path == '/backup':
                    result = store.export()
                elif method == 'POST' and path == '/backup/restore':
                    result = store.restore_backup(body)
                else:
                    raise ApiError('Not found', 404)
                self.respond(result)
            except ApiError as error:
                self.respond({'error': error.message}, error.status)
            except (ValueError, TypeError, KeyError, AttributeError, sqlite3.IntegrityError):
                self.respond({'error': 'Dữ liệu không hợp lệ. Thay đổi chưa được lưu.'}, 400)
            except Exception:
                self.respond({'error': 'Không thể xử lý. Kiểm tra dung lượng đĩa và thử lại.'}, 500)

        def respond(self, payload, status=200):
            raw = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = handle_request
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True)
    args = parser.parse_args()
    token = os.environ.get('TASKFLOW_TOKEN')
    if not token or len(token) < 32:
        raise SystemExit('TASKFLOW_TOKEN is required (at least 32 characters).')
    store = Store(Path(args.data_dir) / 'taskflow.db')
    server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(store, token))
    server.daemon_threads = True
    def scheduler():
        while True:
            try:
                reminder_tick(store)
            except Exception:
                pass
            time.sleep(60)
    if os.environ.get('TASKFLOW_DISABLE_LOCAL_REMINDERS') != '1':
        threading.Thread(target=scheduler, daemon=True).start()
    print(json.dumps({'ready': True, 'port': server.server_port}), flush=True)
    server.serve_forever(poll_interval=0.3)


if __name__ == '__main__':
    main()
