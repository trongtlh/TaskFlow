import sys
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
import json
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Store, ApiError, reminder_tick, make_handler, ThreadingHTTPServer


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'tasks.db')

    def tearDown(self):
        self.tmp.cleanup()

    def task(self, **kwargs):
        return self.store.create({'title':'Kiểm tra công việc', **kwargs})

    def test_crud_persistence_and_before_after_history(self):
        task = self.task()
        updated = self.store.update(task['id'], {'version':1, 'status':'doing', 'due_date':'2026-10-01'})
        self.assertEqual(updated['version'], 2)
        state = Store(self.store.path).state()
        self.assertEqual(state['tasks'][0]['status'],'doing')
        change = state['events'][0]['changes']['status']
        self.assertEqual(change, {'before':'todo','after':'doing'})
        self.store.trash(task['id'])
        self.assertIsNotNone(self.store.state()['tasks'][0]['deleted_at'])
        self.store.trash(task['id'],True)
        self.assertIsNone(self.store.state()['tasks'][0]['deleted_at'])

    def test_start_date_and_legacy_task(self):
        task = self.task(start_date='2026-09-30', due_date='2026-10-02')
        self.assertEqual(self.store.state()['tasks'][0]['start_date'], '2026-09-30')
        updated = self.store.update(task['id'], {'version':1, 'start_date':'2026-10-01'})
        self.assertEqual(self.store.state()['events'][0]['changes']['start_date'], {'before':'2026-09-30','after':'2026-10-01'})
        with self.assertRaises(ApiError):
            self.store.update(task['id'], {'version':2, 'start_date':'2026-10-03'})
        backup = self.store.export()
        del backup['tasks'][0]['start_date']
        self.store.restore_backup(backup)
        self.assertIsNone(self.store.state()['tasks'][0]['start_date'])
        with self.store.db() as db:
            row = db.execute('SELECT data FROM tasks WHERE id=?', (task['id'],)).fetchone()
            legacy = json.loads(row['data']); legacy.pop('start_date')
            db.execute('UPDATE tasks SET data=? WHERE id=?', (json.dumps(legacy),task['id']))
        legacy_task = self.store.state()['tasks'][0]
        self.store.update(task['id'], {'version':legacy_task['version'], 'start_date':'2026-09-30'})
        self.assertIsNone(self.store.state()['events'][0]['changes']['start_date']['before'])

    def test_concurrent_stale_edit_rejected(self):
        task = self.task()
        self.store.update(task['id'], {'version':1, 'title':'New title'})
        with self.assertRaises(ApiError) as error:
            self.store.update(task['id'], {'version':1, 'title':'Stale title'})
        self.assertEqual(error.exception.status,409)
        self.assertEqual(self.store.state()['tasks'][0]['title'],'New title')

    def test_validation_and_soft_deleted_log_guard(self):
        for data in [{'title':''}, {'title':'a','due_date':'2026-02-30'}, {'title':'a','status':'hacked'}, {'title':'a','checklist':[{'id':'1','text':'x','done':'yes'}]}]:
            with self.assertRaises(ApiError):self.store.create(data)
        task=self.task()
        with self.assertRaises(ApiError):self.store.add_log(task['id'], {'content':'Done','minutes':-5,'work_date':'2026-09-30'})
        self.store.trash(task['id'])
        with self.assertRaises(ApiError):self.store.add_log(task['id'], {'content':'Done','minutes':5,'work_date':'2026-09-30'})

    def test_work_log_is_distinct_from_audit(self):
        task=self.task()
        self.store.add_log(task['id'], {'content':'Viết API','minutes':45,'work_date':'2026-09-30'})
        state=self.store.state()
        self.assertEqual(state['logs'][0]['minutes'],45)
        self.assertEqual(state['events'][0]['action'],'logged')
        self.assertEqual(state['tasks'][0]['status'],'todo')

    def test_restore_snapshot_and_safety_backup(self):
        self.task()
        backup=self.store.export()
        self.task(title='Extra')
        result=self.store.restore_backup(backup)
        self.assertEqual(len(self.store.state()['tasks']),1)
        original=json.loads(Path(result['safety_backup']).read_text())
        self.assertEqual(len(original['tasks']),2)
        self.assertEqual(self.store.state()['events'][0]['action'],'backup_restored')

    def test_invalid_backup_rolls_back(self):
        self.task()
        backup=self.store.export()
        backup['tasks'][0]['title']=''
        with self.assertRaises(ApiError):self.store.restore_backup(backup)
        self.assertEqual(len(self.store.state()['tasks']),1)
        # Duplicate log IDs fail after deletes but transaction restores original DB.
        t=self.store.state()['tasks'][0]
        self.store.add_log(t['id'],{'content':'Work','minutes':10,'work_date':'2026-09-30'})
        backup=self.store.export();backup['logs'].append(backup['logs'][0])
        with self.assertRaises(Exception):self.store.restore_backup(backup)
        self.assertEqual(len(self.store.state()['logs']),1)

    @patch.dict('os.environ',{'SMTP_HOST':'smtp.test','SMTP_FROM':'me@example.com'})
    def test_reminder_dedup_excludes_done_and_deleted(self):
        task=self.task(due_date='2026-09-29')
        self.task(title='Finished',status='done',due_date='2026-09-29')
        deleted=self.task(title='Deleted',due_date='2026-09-29');self.store.trash(deleted['id'])
        self.store.settings({'email':'me@example.com','reminder_enabled':True,'reminder_hour':8,'utc_offset':420})
        mails=[]
        sender=lambda *args:mails.append(args)
        current=datetime(2026,9,30,3,tzinfo=timezone.utc)
        reminder_tick(self.store,sender,current)
        reminder_tick(self.store,sender,current)
        self.assertEqual(len(mails),1)
        self.assertIn(task['title'],mails[0][2])
        self.assertNotIn('Finished',mails[0][2])
        self.assertNotIn('Deleted',mails[0][2])
        self.assertEqual(self.store.state()['system']['last_reminder']['status'],'sent')

    @patch.dict('os.environ',{'SMTP_HOST':'smtp.test','SMTP_FROM':'me@example.com'})
    def test_failed_smtp_is_recorded_without_blind_retry(self):
        self.task(due_date='2026-09-29')
        self.store.settings({'email':'me@example.com','reminder_enabled':True})
        calls=[]
        def fail(*args):calls.append(1);raise TimeoutError()
        for _ in range(2):reminder_tick(self.store,fail,datetime(2026,9,30,3,tzinfo=timezone.utc))
        self.assertEqual(calls,[1])
        self.assertEqual(self.store.state()['system']['last_reminder']['status'],'failed')

    def test_http_requires_secret_and_rejects_bad_routes(self):
        token='x'*64
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.store,token))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(origin+'/state')
            self.assertEqual(error.exception.code,401)
            request=urllib.request.Request(origin+'/tasks',data=json.dumps({'title':'API task'}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            with urllib.request.urlopen(request) as response:self.assertEqual(json.load(response)['title'],'API task')
            request=urllib.request.Request(origin+'/state',headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(request) as response:self.assertEqual(len(json.load(response)['tasks']),1)
        finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
