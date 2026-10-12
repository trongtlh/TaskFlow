import { reactive, computed } from 'vue'
import { api } from '../services/api'
export const statuses = [
  {id:'todo',name:'Cần làm',color:'#8c98ab',icon:'circle'},
  {id:'doing',name:'Đang làm',color:'#3768ef',icon:'progress'},
  {id:'blocked',name:'Đang vướng',color:'#df9544',icon:'pause'},
  {id:'done',name:'Hoàn thành',color:'#289879',icon:'check'},
  {id:'cancelled',name:'Đã hủy',color:'#87919f',icon:'x'}
]
export const priorities = {urgent:'Khẩn cấp',high:'Cao',medium:'Trung bình',low:'Thấp'}
export const localDay = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
export const dateLabel = value => value ? new Date(value+'T12:00:00').toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}) : 'Chưa đặt hạn'
export const stampLabel = value => new Date(value).toLocaleString('vi-VN',{hour12:false})
export const taskKey = id => `TF-${String(id).padStart(3,'0')}`
export const state = reactive({
  notes: [],
  tasks: [],
  logs: [],
  events: [],
  settings: {
    email: '',
    reminder_enabled: false,
    reminder_hour: 8,
    utc_offset: 420,
  },
  system: {},
  loading: true,
  busy: false,
  error: '',
  toast: '',
  today: localDay(),
})
let generation=0
let toastTimer
export function notify(text) {state.toast=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>state.toast='',4500)}
export async function load() {
  const activeGeneration=generation
  try {const next=await api.state();if(activeGeneration!==generation)return;Object.assign(state,next);state.error=''} catch(error) {if(activeGeneration===generation)state.error=error.message} finally {if(activeGeneration===generation)state.loading=false}
}
export async function run(callback, message='Đã lưu thay đổi') {
  if(state.busy) return null
  state.busy=true
  try {const result=await callback();await load();if(message && result !== false)notify(message);return result}
  catch(error){notify(error.message);return null} finally {state.busy=false}
}
export const activeTasks = computed(()=>state.tasks.filter(t=>!t.deleted_at))
export const projects = computed(()=>[...new Set(activeTasks.value.map(t=>t.project))].sort())
export const overdue = task => !!task.due_date && task.due_date<state.today && !['done','cancelled'].includes(task.status)
export const actionLabels = {created:'Tạo công việc',updated:'Cập nhật công việc',deleted:'Chuyển vào thùng rác',restored:'Khôi phục công việc',logged:'Ghi nhật ký làm việc',settings:'Thay đổi cài đặt',backup_restored:'Khôi phục bản sao lưu',imported:'Nhập dữ liệu từ SQLite'}
export const fieldLabels = {
  title: 'Tiêu đề',
  description: 'Mô tả',
  status: 'Trạng thái',
  priority: 'Ưu tiên',
  project: 'Dự án',
  start_date: 'Ngày bắt đầu',
  due_date: 'Hạn hoàn thành',
  today: 'My Day',
  checklist: 'Checklist',
  work_log: 'Nhật ký',
  email: 'Email',
  reminder_enabled: 'Nhắc việc',
  reminder_hour: 'Giờ nhắc',
  utc_offset: 'Múi giờ',
  tasks: 'Số task',
  note: 'Bản ghi',
}

actionLabels.noted = 'Thêm bình luận / code / ảnh'
export function displayValue(value, field) {
  if(value===null||value===undefined||value==='') return 'Chưa có'
  if(field==='status') return statuses.find(s=>s.id===value)?.name||value
  if(field==='priority') return priorities[value]||value
  if(typeof value==='boolean') return value?'Bật':'Tắt'
  if(Array.isArray(value)) return value.map(i=>`${i.done?'✓':'○'} ${i.text}`).join('; ')||'Trống'
  if(typeof value==='object') return value.content ? `${value.content} · ${value.minutes} phút · ${value.work_date}` : JSON.stringify(value)
  return String(value)
}

export function resetWorkspace() {
  generation++
  clearTimeout(toastTimer)

  Object.assign(state, {
    notes: [],
    tasks: [],
    logs: [],
    events: [],
    settings: {
      email: '',
      reminder_enabled: false,
      reminder_hour: 8,
      utc_offset: 420,
    },
    system: {},
    loading: true,
    busy: false,
    error: '',
    toast: '',
  })
}