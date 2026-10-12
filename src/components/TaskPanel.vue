<script setup>
import { ref,computed,nextTick,onMounted,onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import ActivityList from './ActivityList.vue'
import {api} from '../services/api'
import TaskNotes from './TaskNotes.vue'
import {state,run,statuses,priorities,projects,taskKey,localDay,stampLabel} from '../composables/useWorkspace'
const props=defineProps({task:Object,initialStatus:{type:String,default:'todo'}})
const emit=defineEmits(['close','saved'])
const noteDirty = ref(false)
const notesEditor = ref(null)
const panelScroll = ref(null)
const createdTask = ref(null)

// Sau khi tạo task, giữ ID lại để thử lưu ảnh/code
// mà không tạo thêm task nếu bước lưu đính kèm thất bại.
const task = computed(() => {
  const id = createdTask.value?.id ?? props.task?.id

  return state.tasks.find(item => item.id === id)
    || createdTask.value
    || props.task
})
const draft=ref(props.task?JSON.parse(JSON.stringify(props.task)):{title:'',description:'',status:props.initialStatus,priority:'medium',project:'Cá nhân',start_date:null,due_date:null,today:false,checklist:[]})
let initial = JSON.stringify(draft.value)
const tab=ref('details'),item=ref(''),confirmClose=ref(false),confirmDelete=ref(false),titleInput=ref(null)
const log=ref({content:'',minutes:30,work_date:localDay()})
const logs=computed(()=>state.logs.filter(l=>l.task_id===props.task?.id))
const events=computed(()=>state.events.filter(l=>l.task_id===props.task?.id))
const totalMinutes=computed(()=>logs.value.reduce((s,l)=>s+l.minutes,0))
function close() {
  if (state.busy) return

  if (
    JSON.stringify(draft.value) !== initial ||
    log.value.content ||
    item.value.trim() ||
    noteDirty.value
  ) {
    confirmClose.value = true

    // Đưa cảnh báo vào vùng nhìn thấy.
    panelScroll.value?.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  } else {
    emit('close')
  }
}
async function save() {
  if (state.busy) return

  // Kiểm tra nội dung đính kèm trước khi tạo task.
  try {
    notesEditor.value?.validatePending()
  } catch (error) {
    tab.value = 'notes'
    await run(async () => {
      throw error
    })
    return
  }

  const existing = task.value
  const fields = [
    'title',
    'description',
    'status',
    'priority',
    'project',
    'start_date',
    'due_date',
    'today',
    'checklist',
  ]

  const payload = Object.fromEntries(
    fields.map(key => [key, draft.value[key]]),
  )

  if (existing) {
    payload.id = existing.id
    payload.version = draft.value.version
  }

  const result = await run(
    () => existing
      ? api.updateTask(payload)
      : api.createTask(payload),
    '',
  )

  if (!result) return

  const savedTask = state.tasks.find(item => item.id === result.id)

  createdTask.value = savedTask || {
    ...draft.value,
    id: result.id,
    version: existing ? draft.value.version : 1,
    deleted_at: null,
  }

  draft.value.id = result.id
  draft.value.version = createdTask.value.version
  initial = JSON.stringify(draft.value)

  if (notesEditor.value?.hasPending()) {
    const noteResult = await run(
      () => notesEditor.value.savePending(result.id),
      'Đã lưu task và nội dung đính kèm',
    )

    if (!noteResult) {
      // Task đã tồn tại. Giữ form để người dùng thử lại.
      tab.value = 'notes'
      return
    }
  }

  emit('saved', result)
}
function addItem(){if(item.value.trim()&&draft.value.checklist.length<100){draft.value.checklist.push({id:crypto.randomUUID(),text:item.value.trim(),done:false});item.value=''}}
async function submitLog(){const result=await run(()=>api.addLog({id:props.task.id,...log.value}),'Đã ghi nhật ký');if(result)log.value={content:'',minutes:30,work_date:localDay()}}
async function askDelete() {
  confirmDelete.value = true
  await nextTick()

  // Đưa hộp xác nhận xóa vào vùng nhìn thấy.
  panelScroll.value?.scrollTo({
    top: panelScroll.value.scrollHeight,
    behavior: 'smooth',
  })
}
async function remove(){const result=await run(()=>api.deleteTask({id:props.task.id}),'Đã chuyển task vào thùng rác');if(result)emit('close')}
function keydown(event){if(event.key==='Escape')close();if(event.key==='Tab'){const items=[...document.querySelectorAll('.task-panel button:not([disabled]), .task-panel input, .task-panel textarea, .task-panel select')].filter(el=>el.offsetParent!==null);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
let beforeFocus
onMounted(()=>{beforeFocus=document.activeElement;titleInput.value?.focus();document.addEventListener('keydown',keydown)})
onBeforeUnmount(()=>{document.removeEventListener('keydown',keydown);beforeFocus?.focus()})
</script>
<template>
<div class="panel-backdrop" @mousedown.self="close">
<section class="task-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
  <header class="panel-header"><span><Icon name="checklist"/>{{task?taskKey(task.id):'Tạo công việc mới'}}</span><button class="icon-button" aria-label="Đóng chi tiết" @click="close"><Icon name="x"/></button></header>
  <div ref="panelScroll" class="panel-scroll">
    <div v-if="confirmClose" class="notice warning">Bạn có thay đổi chưa lưu.<div class="button-row"><button class="button small" @click="confirmClose=false">Tiếp tục sửa</button><button class="button danger small" @click="$emit('close')">Bỏ thay đổi</button></div></div>
    <form id="task-form" @submit.prevent="save">
      <label id="panel-title" class="sr-only" for="task-title">Tiêu đề công việc</label>
      <textarea id="task-title" ref="titleInput" class="task-title-input" v-model="draft.title" required maxlength="200" rows="2" placeholder="Bạn cần làm gì?" :disabled="!!task?.deleted_at"></textarea>
      <div class="detail-meta">
        <label><Icon name="circle"/>Trạng thái<select v-model="draft.status" :disabled="!!task?.deleted_at"><option v-for="s in statuses" :value="s.id">{{s.name}}</option></select></label>
        <label><Icon name="flag"/>Ưu tiên<select v-model="draft.priority" :disabled="!!task?.deleted_at"><option v-for="(label,key) in priorities" :value="key">{{label}}</option></select></label>
        <label><Icon name="date"/>Ngày bắt đầu<input v-model="draft.start_date" type="date" :max="draft.due_date || undefined" :disabled="!!task?.deleted_at"/></label>
        <label><Icon name="date"/>Hạn hoàn thành<input v-model="draft.due_date" type="date" :min="draft.start_date || undefined" :disabled="!!task?.deleted_at"/></label>
        <label><Icon name="folder"/>Dự án<input v-model="draft.project" list="project-options" required maxlength="80" :disabled="!!task?.deleted_at"/><datalist id="project-options"><option v-for="p in projects" :value="p"/></datalist></label>
      </div>
      <label class="focus-toggle"><input type="checkbox" v-model="draft.today" :disabled="!!task?.deleted_at"/><Icon name="sun" :size="17"/>Đưa vào My Day</label>
      <div class="panel-tabs">
        <button
          type="button"
          v-for="t in [
            { id: 'details', name: 'Chi tiết' },
            { id: 'logs', name: 'Work log' },
            { id: 'notes', name: 'Ảnh & code' },
            { id: 'history', name: 'Lịch sử' }
          ]"
          :key="t.id"
          :class="{ active: tab === t.id }"
          @click="tab = t.id"
          :disabled="!task && ['logs', 'history'].includes(t.id)"
        >
          {{ t.name }}
          <span v-if="t.id === 'logs' && logs.length">
            {{ logs.length }}
          </span>
        </button>
      </div>
      <section v-show="tab==='details'" class="detail-section">
        <label class="field-label" for="description">Mô tả</label><textarea id="description" v-model="draft.description" rows="5" maxlength="15000" placeholder="Mục tiêu, yêu cầu hoặc đường dẫn liên quan…" :disabled="!!task?.deleted_at"></textarea>
        <div class="section-heading"><h3>Checklist</h3><span>{{draft.checklist.filter(i=>i.done).length}} / {{draft.checklist.length}}</span></div>
        <div v-for="(check,index) in draft.checklist" :key="check.id" class="checklist-row"><input type="checkbox" v-model="check.done" :aria-label="check.text" :disabled="!!task?.deleted_at"/><input v-model="check.text" :class="{struck:check.done}" aria-label="Nội dung checklist" required maxlength="300" :disabled="!!task?.deleted_at"/><button type="button" class="icon-button tiny" aria-label="Xóa mục checklist" @click="draft.checklist.splice(index,1)" :disabled="!!task?.deleted_at"><Icon name="x" :size="15"/></button></div>
        <div v-if="!task?.deleted_at" class="add-check"><input v-model="item" maxlength="300" placeholder="Thêm một bước nhỏ…" aria-label="Mục checklist mới" @keydown.enter.prevent="addItem"/><button type="button" class="icon-button" @click="addItem" aria-label="Thêm checklist"><Icon name="plus"/></button></div>
      </section>
    </form>
    <section v-if="tab==='logs'">
      <div class="section-heading"><h3>Nhật ký công việc</h3><span>{{Math.floor(totalMinutes/60)}} giờ {{totalMinutes%60}} phút</span></div>
      <form v-if="!task?.deleted_at" class="log-form" @submit.prevent="submitLog"><textarea v-model="log.content" required maxlength="10000" rows="3" placeholder="Bạn đã làm được gì? Còn vướng ở đâu?" aria-label="Nội dung work log"></textarea><div class="log-fields"><label>Ngày làm<input type="date" v-model="log.work_date" required/></label><label>Thời gian (phút)<input type="number" v-model.number="log.minutes" min="1" max="1440" required/></label><button class="button primary" :disabled="state.busy"><Icon name="plus" :size="16"/>Ghi log</button></div></form>
      <div v-for="entry in logs" :key="entry.id" class="log-entry"><div><strong>{{entry.work_date.split('-').reverse().join('/')}}</strong><span>{{entry.minutes}} phút</span></div><p>{{entry.content}}</p><small>Ghi lúc {{stampLabel(entry.created_at)}}</small></div><p v-if="!logs.length" class="muted">Chưa có nhật ký cho công việc này.</p>
    </section>
    <TaskNotes
      ref="notesEditor"
      v-show="tab === 'notes'"
      :task="task"
      @dirty="noteDirty = $event"
    />
    <ActivityList v-if="tab==='history'" :events="events"/>
    <div v-if="task" class="task-timestamps"><span>Tạo: {{stampLabel(task.created_at)}}</span><span>Cập nhật: {{stampLabel(task.updated_at)}}</span></div>
    <div v-if="confirmDelete" class="notice warning">Chuyển task vào thùng rác? Bạn có thể khôi phục sau.<div class="button-row"><button class="button small" @click="confirmDelete=false">Giữ lại</button><button class="button danger small" :disabled="state.busy" @click="remove">Chuyển vào thùng rác</button></div></div>
  </div>
  <footer class="panel-footer"><button v-if="task&&!task.deleted_at" class="icon-button danger-text" aria-label="Xóa task" @click="askDelete"><Icon name="trash"/></button><span class="spacer"></span><button class="button" @click="close">Đóng</button><button v-if="!task?.deleted_at" form="task-form" class="button primary" :disabled="state.busy">{{state.busy?'Đang lưu…':task?'Lưu thay đổi':'Tạo task'}}</button><button v-else class="button primary" @click="async()=>{await run(()=>api.restoreTask({id:task.id}),'Đã khôi phục');$emit('close')}">Khôi phục task</button></footer>
</section>
</div>
</template>
