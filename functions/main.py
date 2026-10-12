"""Optional server-side reminders. Deploy to Firebase; never bundle Admin credentials in Electron."""
import json
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import firebase_admin
from firebase_admin import auth, firestore
from firebase_functions import scheduler_fn
from firebase_functions.params import SecretParam

firebase_admin.initialize_app()
smtp_config = SecretParam('SMTP_CONFIG')


def eligible_tasks(records, today):
    tomorrow = (today + timedelta(days=1)).isoformat()
    return [t for t in records if not t.get('deleted_at') and t.get('status') not in {'done','cancelled'} and t.get('due_date') and t['due_date'] <= tomorrow]


@firestore.transactional
def claim(transaction, receipt):
    if receipt.get(transaction=transaction).exists:
        return False
    transaction.set(receipt, {'status':'sending','detail':'','updated_at':firestore.SERVER_TIMESTAMP})
    return True


def send(config, recipient, tasks, day):
    security = config.get('security', 'starttls')
    if security not in {'starttls','ssl'}:
        raise ValueError('SMTP requires TLS')
    msg = EmailMessage()
    msg['From'], msg['To'] = config['from'], recipient
    msg['Subject'] = f'Taskflow · {len(tasks)} công việc cần chú ý · {day}'
    msg.set_content('Các công việc cần chú ý:\n\n' + '\n'.join(f"TF-{t['id']:03d} · {t['title']} · hạn {t['due_date']}" for t in tasks))
    context = ssl.create_default_context()
    host, port = config['host'], int(config.get('port', 465 if security == 'ssl' else 587))
    with (smtplib.SMTP_SSL(host, port, timeout=20, context=context) if security == 'ssl' else smtplib.SMTP(host, port, timeout=20)) as smtp:
        if security == 'starttls':
            smtp.ehlo(); smtp.starttls(context=context); smtp.ehlo()
        if config.get('username'):
            smtp.login(config['username'], config.get('password',''))
        smtp.send_message(msg)


@scheduler_fn.on_schedule(schedule='every 60 minutes', region='asia-southeast1', secrets=[smtp_config], timeout_sec=540, max_instances=1)
def remind_tasks(event: scheduler_fn.ScheduledEvent) -> None:
    db = firestore.client()
    config = json.loads(smtp_config.value)
    utc_now = datetime.now(timezone.utc)
    for user_doc in db.collection('users').stream():
        try:
            pref = user_doc.reference.collection('settings').document('preferences').get()
            if not pref.exists:
                continue
            settings = pref.to_dict()
            if not settings.get('reminder_enabled'):
                continue
            account = auth.get_user(user_doc.id)
            if account.disabled or not account.email_verified or not account.email:
                continue
            local = utc_now.astimezone(timezone(timedelta(minutes=settings.get('utc_offset',420))))
            if local.hour < settings.get('reminder_hour',8):
                continue
            day = local.date().isoformat()
            receipt = user_doc.reference.collection('reminders').document(day)
            if receipt.get().exists:
                continue
            records = [s.to_dict() for s in user_doc.reference.collection('tasks').stream()]
            tasks = eligible_tasks(records, local.date())
            if not tasks or not claim(db.transaction(), receipt):
                continue
            try:
                send(config, account.email, tasks, day)
                receipt.update({'status':'sent','detail':f'{len(tasks)} task','updated_at':firestore.SERVER_TIMESTAMP})
            except Exception as error:
                # Never blindly retry an ambiguous SMTP send. Receipt suppresses duplicates.
                receipt.update({'status':'failed','detail':type(error).__name__,'updated_at':firestore.SERVER_TIMESTAMP})
        except Exception as error:
            # A bad account must not prevent other workspaces from being processed.
            print(f'Reminder skipped ({type(error).__name__})')
