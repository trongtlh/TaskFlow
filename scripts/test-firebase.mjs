import fs from 'node:fs/promises'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,runTransaction,serverTimestamp,updateDoc,deleteDoc,writeBatch} from 'firebase/firestore'
const projectId='demo-taskflow'
const env=await initializeTestEnvironment({projectId,firestore:{rules:await fs.readFile('firestore.rules','utf8')}})
try{
 await env.clearFirestore()
 const alice=env.authenticatedContext('alice',{email:'alice@example.com',email_verified:true}).firestore()
 const bob=env.authenticatedContext('bob',{email:'bob@example.com',email_verified:true}).firestore()
 const anon=env.unauthenticatedContext().firestore()
 const task={id:1,title:'Firebase task',description:'',status:'todo',priority:'medium',project:'Cá nhân',start_date:'2026-09-30',due_date:'2026-10-01',today:false,checklist:[],version:1,created_at:serverTimestamp(),updated_at:serverTimestamp(),deleted_at:null,last_event_id:'create1'}
 const audit={task_id:1,task_title:task.title,action:'created',changes:{},actor_uid:'alice',created_at:serverTimestamp(),task_version:1}
 await assertSucceeds(runTransaction(alice,async tx=>{tx.set(doc(alice,'users/alice/tasks/1'),task);tx.set(doc(alice,'users/alice/events/create1'),audit)}))
 await assertSucceeds(getDoc(doc(alice,'users/alice/tasks/1')))
 await assertFails(getDoc(doc(bob,'users/alice/tasks/1')))
 await assertFails(getDoc(doc(anon,'users/alice/tasks/1')))
 await assertFails(setDoc(doc(bob,'users/alice/tasks/2'),{...task,id:2}))
 await assertFails(updateDoc(doc(alice,'users/alice/tasks/1'),{title:'No version'}))
 await assertFails(deleteDoc(doc(alice,'users/alice/tasks/1')))
 await assertFails(updateDoc(doc(alice,'users/alice/events/create1'),{action:'forged'}))
 await assertSucceeds(runTransaction(alice,async tx=>{const t=(await tx.get(doc(alice,'users/alice/tasks/1'))).data();tx.update(doc(alice,'users/alice/tasks/1'),{status:'doing',version:t.version+1,updated_at:serverTimestamp(),last_event_id:'update1'});tx.set(doc(alice,'users/alice/events/update1'),{...audit,action:'updated',task_version:2})}))
 await assertFails(setDoc(doc(alice,'users/alice/reminders/2026-09-30'),{status:'sent'}))
 await assertSucceeds(setDoc(doc(alice,'users/alice/settings/preferences'),{email:'alice@example.com',reminder_enabled:true,reminder_hour:8,utc_offset:420}))
 const unverified=env.authenticatedContext('unverified',{email:'u@example.com',email_verified:false}).firestore()
 await assertFails(setDoc(doc(unverified,'users/unverified/settings/preferences'),{email:'u@example.com',reminder_enabled:true,reminder_hour:8,utc_offset:420}))
 // Atomic one-time import including old task timestamps, deleted task logs, and legacy history.
 const batch=writeBatch(bob)
 batch.set(doc(bob,'users/bob/meta/migration'),{completed_at:serverTimestamp(),task_count:1})
 batch.set(doc(bob,'users/bob/meta/counter'),{value:1})
 batch.set(doc(bob,'users/bob/tasks/1'),{...task,created_at:new Date('2026-01-01T00:00:00Z'),deleted_at:new Date('2026-02-01T00:00:00Z')})
 batch.set(doc(bob,'users/bob/imported_history/old'),{source:'sqlite',created_at:'2026-01-01T00:00:00Z'})
 await assertSucceeds(batch.commit())
 await assertFails(setDoc(doc(bob,'users/bob/imported_history/later'),{source:'sqlite'}))
 console.log('PASS: owner CRUD, other-user/anonymous denial, version check, append-only history, server-only mail receipts, verified settings, one-time import.')
}finally{await env.cleanup()}
