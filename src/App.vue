<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
import Icon from './components/Icon.vue'
import TaskCard from './components/TaskCard.vue'
import TaskPanel from './components/TaskPanel.vue'
import ActivityList from './components/ActivityList.vue'
import SettingsView from './components/SettingsView.vue'
import CalendarView from './components/CalendarView.vue'
import {api,isDesktop} from './services/api'
import {state,load,run,notify,activeTasks,projects,statuses,priorities,overdue,taskKey,dateLabel,localDay} from './composables/useWorkspace'
import {currentCloudUser,logout,firebaseMessage} from './services/firebase'
const dueOnly=ref(false)
const nav=ref('tasks'),view=ref('list'),query=ref(''),project=ref(''),priority=ref(''),status=ref(''),dateFrom=ref(''),dateTo=ref(''),panel=ref(null),initialStatus=ref('todo'),searchInput=ref(null)
const navItems=[{id:'overview',label:'Tổng quan',icon:'overview'},{id:'myday',label:'My Day',icon:'sun'},{id:'tasks',label:'Tất cả công việc',icon:'board'},{id:'calendar',label:'Lịch công việc',icon:'calendar'},{id:'activity',label:'Lịch sử hoạt động',icon:'history'}]
const titles={overview:'Tổng quan',myday:'My Day',tasks:'Tất cả công việc',calendar:'Lịch công việc',activity:'Lịch sử hoạt động',trash:'Thùng rác',settings:'Cài đặt'}
const subtitles={overview:'Một góc nhìn rõ ràng cho ngày làm việc của bạn.',myday:'Ít việc hơn, tập trung hơn. Chọn điều quan trọng hôm nay.',tasks:'Sắp xếp công việc, theo dõi từng bước tiến.',calendar:'Theo dõi hạn hoàn thành theo tháng.',activity:'Mỗi thay đổi đều có dấu vết.',trash:'Task đã xóa được giữ lại để bạn có thể khôi phục.',settings:'Tài khoản Firebase, dữ liệu và nhắc việc.'}
const taskViews=computed(()=>['tasks','myday','trash'].includes(nav.value))
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase()
const filtered=computed(()=>state.tasks.filter(task=>{
 if(nav.value==='trash'?!task.deleted_at:!!task.deleted_at)return false
 if(nav.value==='myday'&&!task.today)return false
 if(project.value&&task.project!==project.value)return false
 if(dueOnly.value&&!overdue(task))return false
 if(priority.value&&task.priority!==priority.value)return false
 if(status.value&&task.status!==status.value)return false
 const text=[task.title,task.description,task.project,taskKey(task.id),...state.logs.filter(l=>l.task_id===task.id).map(l=>l.content)].join(' ')
 return !query.value||norm(text).includes(norm(query.value))
}))
const columns=computed(()=>statuses.filter(s=>s.id!=='cancelled'||filtered.value.some(t=>t.status==='cancelled')))
const stats=computed(()=>[
 {label:'Tổng công việc',value:activeTasks.value.length,icon:'checklist',tone:'blue',caption:'Trong workspace',filter:''},
 {label:'Đang thực hiện',value:activeTasks.value.filter(t=>t.status==='doing').length,icon:'progress',tone:'violet',caption:'Từng bước tiến lên',filter:'doing'},
 {label:'Đã hoàn thành',value:activeTasks.value.filter(t=>t.status==='done').length,icon:'checks',tone:'green',caption:'Những việc đã xong',filter:'done'},
 {label:'Đang quá hạn',value:activeTasks.value.filter(overdue).length,icon:'clock',tone:'amber',caption:'Cần bạn chú ý',filter:'overdue'}
])
const eventList=computed(()=>state.events.filter(e=>{
 const day=localDay(new Date(e.created_at))
 return (!dateFrom.value||day>=dateFrom.value)&&(!dateTo.value||day<=dateTo.value)&&(!query.value||norm(`${e.task_title} ${e.task_id?taskKey(e.task_id):''} ${JSON.stringify(e.changes)}`).includes(norm(query.value)))
}))
const mydayCount=computed(()=>activeTasks.value.filter(t=>t.today&&!['done','cancelled'].includes(t.status)).length)
const attention=computed(()=>activeTasks.value.filter(t=>overdue(t)||t.due_date===state.today).filter(t=>!['done','cancelled'].includes(t.status)).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date))))
const completion=computed(()=>activeTasks.value.length?Math.round(activeTasks.value.filter(t=>t.status==='done').length/activeTasks.value.length*100):0)
function navigate(id){dueOnly.value=false;nav.value=id;query.value='';status.value='';priority.value='';project.value=''}
function openTask(task){panel.value=task}
function openById(id){const task=state.tasks.find(t=>t.id===id);if(task)openTask(task);else notify('Task không còn trong workspace.')}
function newTask(value='todo'){initialStatus.value=value;panel.value={new:true}}
async function purge(task){if(window.confirm(`Xóa vĩnh viễn "${task.title}"?\nTask cùng work log, ảnh, code và lịch sử liên quan sẽ mất và không thể khôi phục.`))await run(()=>api.purgeTask({id:task.id}),'Đã xóa vĩnh viễn task')}
async function focusTask(task){await run(()=>api.updateTask({id:task.id,version:task.version,today:!task.today}),task.today?'Đã bỏ khỏi My Day':'Đã thêm vào My Day')}
async function drop(event,target){if(nav.value==='trash')return;const task=state.tasks.find(t=>t.id===Number(event.dataTransfer.getData('text/plain')));if(task&&task.status!==target)await run(()=>api.updateTask({id:task.id,version:task.version,status:target}),'Đã chuyển trạng thái')}
async function signOutAccount(){if(!window.confirm(`Đăng xuất khỏi tài khoản ${currentCloudUser()?.email||''}?`))return;try{await logout()}catch(error){notify(firebaseMessage(error))}}
function filterStat(stat){navigate('tasks');if(stat.filter==='overdue'){view.value='list';dueOnly.value=true}else status.value=stat.filter}
function shortcut(event){if((event.ctrlKey||event.metaKey)&&event.key==='k'){event.preventDefault();searchInput.value?.focus()}if(event.key==='n'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!panel.value)newTask()}
let dayTimer
onMounted(()=>{load();document.addEventListener('keydown',shortcut);dayTimer=setInterval(()=>state.today=localDay(),60000)})
onBeforeUnmount(()=>{document.removeEventListener('keydown',shortcut);clearInterval(dayTimer)})
</script>
<template>
<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="#" @click.prevent="navigate('overview')"><span class="brand-mark"><Icon name="check" :size="24"/></span><span>taskflow<span class="brand-dot">.</span></span></a>
    <div class="workspace-label"><span class="workspace-avatar">P</span><div><strong>Personal workspace</strong><small>Không gian của bạn</small></div><Icon name="down" :size="15"/></div>
    <span class="nav-section-label">WORKSPACE</span>
    <nav aria-label="Điều hướng chính"><button v-for="item in navItems" :key="item.id" class="nav-link" :class="{active:nav===item.id}" @click="navigate(item.id)"><Icon :name="item.icon"/><span>{{item.label}}</span><span v-if="item.id==='myday'&&mydayCount" class="nav-count">{{mydayCount}}</span></button></nav>
    <div class="project-heading"><span class="nav-section-label">DỰ ÁN</span><button class="icon-button tiny" aria-label="Tạo task cho dự án mới" @click="newTask()"><Icon name="plus" :size="15"/></button></div>
    <div class="project-nav"><button v-for="(p,index) in projects" :key="p" :class="{selected:project===p&&nav==='tasks'}" @click="navigate('tasks');project=p"><span class="project-square" :style="{background:['#6979db','#ddaa5b','#58a794','#b97bc8'][index%4]}"></span>{{p}}<span>{{activeTasks.filter(t=>t.project===p).length}}</span></button><p v-if="!projects.length" class="sidebar-hint">Dự án xuất hiện khi bạn tạo task đầu tiên.</p></div>
    <div class="sidebar-bottom"><button class="nav-link" :class="{active:nav==='trash'}" @click="navigate('trash')"><Icon name="trash"/><span>Thùng rác</span></button><button class="nav-link" :class="{active:nav==='settings'}" @click="navigate('settings')"><Icon name="settings"/><span>Cài đặt</span></button><div class="local-status"><Icon name="disk" :size="16"/><span>Lưu trên Firebase<small>Cloud workspace</small></span><span class="status-dot"></span></div><div class="profile"><span class="avatar">ME</span><div><strong>Không gian cá nhân</strong><small>Taskflow Desktop · v0.2</small></div><button class="icon-button" aria-label="Đăng xuất" :title="'Đăng xuất khỏi '+(currentCloudUser()?.email||'tài khoản')" :disabled="state.busy" @click="signOutAccount"><Icon name="logout" :size="17"/></button></div></div>
  </aside>
  <div class="main-shell">
    <header class="topbar"><div class="breadcrumb"><Icon name="folder" :size="17"/><span>Workspace</span><span class="slash">/</span><strong>{{titles[nav]}}</strong></div><div class="topbar-right"><button class="icon-button" aria-label="Tải lại từ Firebase" :disabled="state.busy" @click="load"><Icon name="restore"/></button><span class="today-label">{{new Date(state.today+'T12:00:00').toLocaleDateString('vi-VN',{weekday:'short',day:'numeric',month:'long',year:'numeric'})}}</span><button class="icon-button notification-button" aria-label="Cài đặt nhắc việc" @click="navigate('settings')"><Icon name="bell"/></button><span class="avatar small-avatar">ME</span></div></header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">{{nav==='myday'?'MAKE ROOM FOR WHAT MATTERS':'YOUR WORK, IN FOCUS'}}</div><h1>{{titles[nav]}}<span v-if="taskViews" class="heading-count">{{filtered.length}}</span></h1><p>{{subtitles[nav]}}</p></div><button v-if="nav!=='settings'&&nav!=='trash'" class="button primary new-task" @click="newTask()"><Icon name="plus" :size="18"/>Tạo task<span class="keyboard-hint">N</span></button></div>
      <div v-if="state.loading" class="empty"><Icon name="loading" :size="32"/><h3>Đang mở workspace…</h3></div>
      <div v-else-if="state.error" class="surface error-state"><Icon name="disk" :size="40"/><h2>Chưa tải được dữ liệu Firebase</h2><p>{{state.error}}</p><button class="button primary" @click="load">Thử lại</button></div>
      <template v-else>
        <div v-if="nav==='tasks'||nav==='overview'" class="stats-grid"><button v-for="stat in stats" :key="stat.label" class="stat-card" @click="filterStat(stat)"><div class="stat-top"><span>{{stat.label}}</span><span :class="['stat-icon',stat.tone]"><Icon :name="stat.icon" :size="18"/></span></div><strong>{{stat.value.toString().padStart(2,'0')}}</strong><small>{{stat.caption}}</small></button></div>
        <template v-if="taskViews">
          <div v-if="dueOnly" class="notice warning">Đang xem task quá hạn. <button class="text-button" @click="dueOnly=false">Xem tất cả</button></div><div class="task-toolbar"><div class="view-switch" v-if="nav!=='trash'"><button :class="{active:view==='board'}" @click="view='board'"><Icon name="board" :size="16"/>Bảng</button><button :class="{active:view==='list'}" @click="view='list'"><Icon name="list" :size="17"/>Danh sách</button></div><span v-else class="muted">{{filtered.length}} task đã xóa</span><div class="toolbar-filters"><label class="search-box"><Icon name="search" :size="17"/><input ref="searchInput" v-model="query" placeholder="Tìm task, nội dung, work log…" aria-label="Tìm công việc"/><kbd>Ctrl K</kbd></label><select v-model="priority" aria-label="Lọc ưu tiên"><option value="">Mọi ưu tiên</option><option v-for="(label,key) in priorities" :value="key">{{label}}</option></select><select v-model="status" aria-label="Lọc trạng thái"><option value="">Mọi trạng thái</option><option v-for="s in statuses" :value="s.id">{{s.name}}</option></select><select v-model="project" aria-label="Lọc dự án"><option value="">Mọi dự án</option><option v-for="p in projects" :value="p">{{p}}</option></select></div></div>
          <div v-if="nav==='myday'&&!filtered.length&&!query" class="focus-banner"><Icon name="sun" :size="26"/><div><h3>Hôm nay, bạn muốn hoàn thành điều gì?</h3><p>Nhấn biểu tượng mặt trời trên task để đưa vào My Day.</p></div><button class="button" @click="navigate('tasks')">Chọn công việc</button></div>
          <div v-if="view==='board'&&nav!=='trash'" class="kanban"><section v-for="column in columns" :key="column.id" class="kanban-column" @dragover.prevent @drop.prevent="drop($event,column.id)"><header class="column-header"><span :style="{color:column.color}"><Icon :name="column.icon" :size="17"/></span><h2>{{column.name}}</h2><span class="column-count">{{filtered.filter(t=>t.status===column.id).length}}</span><button class="icon-button tiny" :aria-label="'Thêm task '+column.name" @click="newTask(column.id)"><Icon name="plus" :size="16"/></button></header><div class="column-cards"><TaskCard v-for="task in filtered.filter(t=>t.status===column.id)" :key="task.id" :task="task" @open="openTask" @focus="focusTask"/><div v-if="!filtered.some(t=>t.status===column.id)" class="column-empty"><Icon :name="column.icon" :size="26"/><span>{{column.id==='done'?'Những thành quả sắp tới':'Chưa có công việc'}}</span><small>{{column.id==='todo'?'Bắt đầu với một task nhỏ.':'Kéo task vào đây để chuyển trạng thái.'}}</small></div><button class="add-task" @click="newTask(column.id)"><Icon name="plus" :size="16"/>Thêm task</button></div></section></div>
          <div v-else class="surface table-wrap"><table class="task-table"><thead><tr><th>Công việc</th><th>Trạng thái</th><th>Ưu tiên</th><th>Ngày bắt đầu</th><th>Hạn hoàn thành</th><th>Dự án</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody><tr v-for="task in filtered" :key="task.id"><td><button class="table-task" @click="openTask(task)"><small>{{taskKey(task.id)}}</small><strong>{{task.title}}</strong></button></td><td><span class="status-pill" :class="task.status">{{statuses.find(s=>s.id===task.status)?.name}}</span></td><td><span class="priority-tag" :class="task.priority"><Icon name="flag" :size="13"/>{{priorities[task.priority]}}</span></td><td>{{task.start_date ? dateLabel(task.start_date) : 'Chưa đặt'}}</td><td :class="{overdue:overdue(task)}">{{dateLabel(task.due_date)}}</td><td>{{task.project}}</td><td><template v-if="nav==='trash'"><button class="icon-button" aria-label="Khôi phục task" title="Khôi phục" @click="run(()=>api.restoreTask({id:task.id}),'Đã khôi phục task')"><Icon name="restore"/></button><button class="icon-button danger-text" aria-label="Xóa vĩnh viễn task" title="Xóa vĩnh viễn" :disabled="state.busy" @click="purge(task)"><Icon name="trash"/></button></template><button v-else class="icon-button" :class="{selected:task.today}" aria-label="Đổi lựa chọn My Day" @click="focusTask(task)"><Icon name="sun"/></button></td></tr></tbody></table><div v-if="!filtered.length" class="empty"><Icon :name="nav==='trash'?'trash':'search'" :size="32"/><h3>{{nav==='trash'?'Thùng rác trống':'Chưa có công việc phù hợp'}}</h3><p>{{query||priority||status||project?'Thử đổi từ khóa hoặc bộ lọc.':'Tạo task đầu tiên để bắt đầu.'}}</p></div></div>
          <div class="board-footer"><span><Icon name="shield" :size="14"/>Thay đổi được lưu tự động vào lịch sử sau khi bạn nhấn lưu.</span><span>{{activeTasks.length}} công việc · {{projects.length}} dự án</span></div>
        </template>
        <div v-if="nav==='overview'" class="overview-grid"><section class="surface overview-attention"><div class="section-heading"><h2>Cần chú ý</h2><span class="pill neutral">{{attention.length}} công việc</span></div><button v-for="task in attention" :key="task.id" class="attention-row" @click="openTask(task)"><span class="attention-symbol" :class="{overdue:overdue(task)}"><Icon name="clock"/></span><div><strong>{{task.title}}</strong><small>{{taskKey(task.id)}} · {{task.project}}</small></div><span :class="{overdue:overdue(task)}">{{dateLabel(task.due_date)}}</span></button><div v-if="!attention.length" class="empty compact-empty"><Icon name="success" :size="34"/><h3>Không có việc cần nhắc</h3><p>Các task đến hạn sẽ xuất hiện ở đây.</p></div></section><section class="surface progress-card"><div class="section-heading"><h2>Tiến độ workspace</h2><Icon name="checks"/></div><div class="progress-number">{{completion}}<span>%</span></div><div class="wide-progress"><span :style="{width:completion+'%'}"></span></div><p>{{activeTasks.filter(t=>t.status==='done').length}} / {{activeTasks.length}} công việc đã hoàn thành</p><button class="button" @click="navigate('myday')"><Icon name="sun" :size="17"/>Mở My Day</button></section><section class="surface overview-activity"><div class="section-heading"><h2>Hoạt động gần đây</h2><button class="text-button" @click="navigate('activity')">Xem tất cả</button></div><ActivityList :events="state.events.slice(0,6)" compact @open="openById"/></section></div>
        <CalendarView v-if="nav==='calendar'" @open="openTask"/>
        <template v-if="nav==='activity'"><div class="activity-toolbar"><label class="search-box"><Icon name="search" :size="17"/><input ref="searchInput" v-model="query" placeholder="Tìm task hoặc nội dung thay đổi…" aria-label="Tìm lịch sử"/></label><label>Từ ngày<input type="date" v-model="dateFrom"/></label><label>Đến ngày<input type="date" v-model="dateTo"/></label><button v-if="query||dateFrom||dateTo" class="text-button" @click="query='';dateFrom='';dateTo=''">Xóa bộ lọc</button></div><section class="surface activity-surface"><ActivityList :events="eventList" @open="openById"/></section></template>
        <SettingsView v-if="nav==='settings'"/>
      </template>
    </main>
  </div>
  <TaskPanel v-if="panel" :key="panel.new?'new':panel.id" :task="panel.new?null:panel" :initial-status="initialStatus" @close="panel=null" @saved="panel=null"/>
  <Transition name="toast"><div v-if="state.toast" class="toast-message" role="status"><Icon name="bell" :size="17"/><span>{{state.toast}}</span><button class="icon-button tiny" aria-label="Đóng thông báo" @click="state.toast=''"><Icon name="x" :size="15"/></button></div></Transition>
</div>
</template>
