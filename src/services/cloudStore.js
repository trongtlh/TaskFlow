import { collection, deleteDoc, doc, getDocsFromServer, getDocFromServer, query, runTransaction, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { db,currentCloudUser,firebaseMessage } from './firebase'
const statuses=['todo','doing','blocked','done','cancelled'], priorities=['low','medium','high','urgent']
const fields=['title','description','status','priority','project','start_date','due_date','today','checklist']
function session(){const user=currentCloudUser();if(!user)throw Error('Hãy đăng nhập để tiếp tục.');return {uid:user.uid,email:user.email,verified:user.emailVerified}}
const userRef=uid=>doc(db,'users',uid)
const ref=(uid,name,id)=>doc(db,'users',uid,name,String(id))
const col=(uid,name)=>collection(db,'users',uid,name)
const plain=v=>JSON.parse(JSON.stringify(v))
function normalize(data){return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v?.toDate?v.toDate().toISOString():v]))}
function cleanText(v,max,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('Nội dung không hợp lệ hoặc quá dài.');return v.trim()}
function day(v){if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('Ngày không hợp lệ.');return v}
export function cleanTask(data){
 const result={title:cleanText(data.title||'',200,true),description:cleanText(data.description||'',15000),status:data.status||'todo',priority:data.priority||'medium',project:cleanText(data.project||'Cá nhân',80,true),start_date:day(data.start_date),due_date:day(data.due_date),today:data.today??false,checklist:data.checklist||[]}
 if(!statuses.includes(result.status)||!priorities.includes(result.priority)||typeof result.today!=='boolean')throw Error('Trạng thái hoặc ưu tiên không hợp lệ.')
 if(result.start_date&&result.due_date&&result.start_date>result.due_date)throw Error('Ngày bắt đầu không được sau hạn hoàn thành.')
 if(!Array.isArray(result.checklist)||result.checklist.length>100)throw Error('Checklist tối đa 100 mục.')
 result.checklist=result.checklist.map(i=>{if(typeof i.done!=='boolean')throw Error('Checklist không hợp lệ.');return {id:cleanText(i.id,80,true),text:cleanText(i.text,300,true),done:i.done}})
 if(new Set(result.checklist.map(i=>i.id)).size!==result.checklist.length)throw Error('Checklist bị trùng mã.')
 return result
}
function event(uid,task,action,changes={}){return {task_id:task?.id??null,task_title:task?.title||'Cài đặt',action,changes,actor_uid:uid,created_at:serverTimestamp(),task_version:task?.version??null}}
const defaults=email=>({email:email||'',reminder_enabled:false,reminder_hour:8,utc_offset:420})
export async function state(){
 const {uid,email}=session()
 // A root user document lets the scheduled Python job enumerate existing workspaces.
 await setDoc(userRef(uid),{email,updated_at:serverTimestamp()},{merge:true})
const [
  tasks,
  logs,
  events,
  settings,
  reminders,
  imported,
  notes,
] = await Promise.all([
  getDocsFromServer(col(uid, 'tasks')),
  getDocsFromServer(col(uid, 'logs')),
  getDocsFromServer(col(uid, 'events')),
  getDocFromServer(ref(uid, 'settings', 'preferences')),
  getDocsFromServer(col(uid, 'reminders')),
  getDocsFromServer(col(uid, 'imported_history')),
  getDocsFromServer(col(uid, 'notes')),
])
 if(currentCloudUser()?.uid!==uid)throw Error('Phiên đăng nhập đã thay đổi.')
 const rows=s=>s.docs.map(d=>({id:d.id,...normalize(d.data())}))
 const receipts=rows(reminders).sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''))
 return {notes: rows(notes), tasks:rows(tasks).sort((a,b)=>b.id-a.id),logs:rows(logs).sort((a,b)=>b.work_date.localeCompare(a.work_date)||b.created_at.localeCompare(a.created_at)),events:[...rows(events),...rows(imported).map((e,i)=>({...e,id:'legacy-'+i}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)),settings:settings.exists()?normalize(settings.data()):defaults(email),system:{storage:'firestore',uid,project:db.app.options.projectId,last_reminder:receipts[0]||null,email_verified:session().verified}}
}
export async function createTask(payload){
 const {uid}=session(),task=cleanTask(payload),eventRef=doc(col(uid,'events')),counterRef=ref(uid,'meta','counter')
 const id=await runTransaction(db,async tx=>{
 const counter=await tx.get(counterRef),id=(counter.exists()?counter.data().value:0)+1
 tx.set(counterRef,{value:id})
 const data={...task,id,version:1,created_at:serverTimestamp(),updated_at:serverTimestamp(),deleted_at:null,last_event_id:eventRef.id}
 tx.set(ref(uid,'tasks',id),data);tx.set(eventRef,event(uid,data,'created'));return id
 })
 return {id}
}
export async function updateTask(payload){
 const {uid}=session(),taskRef=ref(uid,'tasks',payload.id),eventRef=doc(col(uid,'events'))
 await runTransaction(db,async tx=>{
 const snap=await tx.get(taskRef);if(!snap.exists())throw Error('Không tìm thấy task.')
 const previous=snap.data();if(previous.deleted_at)throw Error('Khôi phục task trước khi sửa.')
 if(previous.version!==payload.version)throw Error('Task đã thay đổi trên thiết bị khác. Đóng chi tiết, nhấn tải lại và mở lại task.')
 const task=cleanTask({...previous,...payload}),changes={}
 for(const k of fields)if(JSON.stringify(previous[k]??null)!==JSON.stringify(task[k]))changes[k]={before:previous[k]??null,after:task[k]}
 if(!Object.keys(changes).length)return
 const next={...task,version:previous.version+1,updated_at:serverTimestamp(),last_event_id:eventRef.id}
 tx.update(taskRef,next);tx.set(eventRef,event(uid,{...previous,...next},'updated',changes))
 });return {id:payload.id}
}
async function trash({id},restore=false){
 const {uid}=session(),taskRef=ref(uid,'tasks',id),eventRef=doc(col(uid,'events'))
 await runTransaction(db,async tx=>{const snap=await tx.get(taskRef);if(!snap.exists())throw Error('Không tìm thấy task.');const task=snap.data();if(Boolean(task.deleted_at)===!restore)return
 const version=task.version+1
 tx.update(taskRef,{deleted_at:restore?null:serverTimestamp(),version,updated_at:serverTimestamp(),last_event_id:eventRef.id});tx.set(eventRef,event(uid,{...task,version},restore?'restored':'deleted'))
 });return {id}
}
export const deleteTask=p=>trash(p,false)
export const restoreTask=p=>trash(p,true)
// Xóa vĩnh viễn task đã ở thùng rác cùng note, work log, lịch sử và ảnh cục bộ của nó.
export async function purgeTask({id}){
 const {uid}=session(),taskRef=ref(uid,'tasks',id),snap=await getDocFromServer(taskRef)
 if(!snap.exists())throw Error('Không tìm thấy task.')
 if(!snap.data().deleted_at)throw Error('Chỉ xóa vĩnh viễn task đang ở thùng rác.')
 const taskId=snap.data().id,related={}
 for(const name of ['notes','logs','events'])related[name]=(await getDocsFromServer(query(col(uid,name),where('task_id','==',taskId)))).docs
 const images=related.notes.flatMap(d=>{const n=d.data();return [...(n.images||[]).map(i=>i.path),n.image_path].filter(Boolean)})
 // Task xóa sau cùng để rules còn thấy deleted_at của nó ở các lô trước.
 const refs=[...related.notes,...related.logs,...related.events].map(d=>d.ref)
 for(let i=0;i<refs.length;i+=400){const batch=writeBatch(db);refs.slice(i,i+400).forEach(r=>batch.delete(r));await batch.commit()}
 await deleteDoc(taskRef)
 await Promise.all(images.map(imagePath=>window.taskflow?.deleteLocalImage?.({uid,imagePath})?.catch(()=>{})))
 return {id}
}
export async function addLog({id,content,minutes,work_date}){
 const {uid}=session(),taskRef=ref(uid,'tasks',id),logRef=doc(col(uid,'logs')),eventRef=doc(col(uid,'events'))
 content=cleanText(content,10000,true);work_date=day(work_date)
 if(!work_date||!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Ngày làm hoặc số phút không hợp lệ.')
 await runTransaction(db,async tx=>{const snap=await tx.get(taskRef);if(!snap.exists()||snap.data().deleted_at)throw Error('Task không tồn tại hoặc đã xóa.');const task=snap.data()
 tx.set(logRef,{id:logRef.id,task_id:id,content,minutes,work_date,created_at:serverTimestamp(),event_id:eventRef.id});tx.set(eventRef,event(uid,task,'logged',{work_log:{before:null,after:{content,minutes,work_date}}}))
 });return {id:logRef.id}
}
export async function saveSettings(payload){
 const {uid,email,verified}=session(),settingsRef=ref(uid,'settings','preferences'),eventRef=doc(col(uid,'events'))
 const data={email,reminder_enabled:payload.reminder_enabled,reminder_hour:payload.reminder_hour,utc_offset:payload.utc_offset}
 if(typeof data.reminder_enabled!=='boolean'||!Number.isInteger(data.reminder_hour)||data.reminder_hour<0||data.reminder_hour>23||!Number.isInteger(data.utc_offset)||data.utc_offset < -720||data.utc_offset>840)throw Error('Cài đặt không hợp lệ.')
 if(data.reminder_enabled&&!verified)throw Error('Xác minh email trước khi bật nhắc việc.')
 await runTransaction(db,async tx=>{const snap=await tx.get(settingsRef),previous=snap.exists()?snap.data():defaults(email),changes={};for(const k of Object.keys(data))if(previous[k]!==data[k])changes[k]={before:previous[k]??null,after:data[k]};tx.set(settingsRef,data);tx.set(eventRef,event(uid,null,'settings',changes))})
 return data
}
export async function backup() {
  const data = await state()

  return {
    schema_version: 3,
    exported_at: new Date().toISOString(),
    owner_uid: session().uid,
    tasks: data.tasks,
    logs: data.logs,
    events: data.events,
    notes: data.notes,
    settings: data.settings,
  }
}
export async function importLocal(){
 const {uid}=session()
 if (!window.taskflow) throw Error('Mở app desktop để nhập SQLite cũ.')
 const legacy = await window.taskflow.backup()
 if(!legacy.tasks?.length)throw Error('SQLite cũ không có task.')
 // Import once into an empty cloud workspace. One transaction prevents partial migrations.
 const existing=await getDocsFromServer(col(uid,'tasks'));if(!existing.empty)throw Error('Chỉ nhập dữ liệu cũ vào workspace Firebase trống.')
 const logs=legacy.logs||[],events=legacy.events||[]
if (2 * legacy.tasks.length + 2 * logs.length + events.length + 3 > 400) {
  throw Error('Dữ liệu quá lớn cho lần nhập này (tối đa 400 bản ghi). Hãy giữ SQLite/JSON và yêu cầu công cụ chuyển dữ liệu theo lô.')
}
 const migrated=legacy.tasks.map(t=>({...cleanTask(t),id:t.id,version:1,created_at:new Date(t.created_at),updated_at:serverTimestamp(),deleted_at:t.deleted_at?new Date(t.deleted_at):null}))
 const counterRef=ref(uid,'meta','counter'),markerRef=ref(uid,'meta','migration'),auditRef=doc(col(uid,'events'))
 await runTransaction(db,async tx=>{
 const [counter,marker]=await Promise.all([tx.get(counterRef),tx.get(markerRef)])
 if(marker.exists()||(counter.exists()&&counter.data().value>0))throw Error('Workspace đã được sử dụng; không nhập đè dữ liệu.')
 tx.set(markerRef,{completed_at:serverTimestamp(),task_count:migrated.length})
 for(const task of migrated){const ev=doc(col(uid,'events'));tx.set(ref(uid,'tasks',task.id),{...task,last_event_id:ev.id});tx.set(ev,event(uid,task,'created'))}
 for(const log of logs){const lr=doc(col(uid,'logs')),ev=doc(col(uid,'events'));tx.set(lr,{...log,id:lr.id,created_at:serverTimestamp(),event_id:ev.id});tx.set(ev,event(uid,{id:log.task_id,title:legacy.tasks.find(t=>t.id===log.task_id)?.title||'Task',version:1},'logged',{work_log:{before:null,after:{content:log.content,minutes:log.minutes,work_date:log.work_date}}}))}
 // Historical changes are archived separately so they cannot masquerade as server-time audit events.
 for(const old of events){tx.set(doc(col(uid,'imported_history')),{...plain(old),source:'sqlite'})}
 tx.set(counterRef,{value:Math.max(...migrated.map(t=>t.id),0)});tx.set(auditRef,event(uid,null,'imported',{tasks:{before:0,after:migrated.length}}))
 })
 return {count:migrated.length}
}
export async function exportBackup() {
  const payload = await backup()
  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: 'application/json' },
  )

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = `taskflow-cloud-${new Date().toISOString().slice(0, 10)}.json`
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
export const cloudApi={state,createTask,updateTask,deleteTask,restoreTask,purgeTask,addLog,saveSettings,backup,importLocal,exportBackup}
