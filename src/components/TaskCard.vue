<script setup>
import Icon from './Icon.vue'
import {state, priorities, overdue, taskKey,dateLabel} from '../composables/useWorkspace'
defineProps({task:Object})
defineEmits(['open','focus'])
</script>
<template>
<article class="task-card" draggable="true" @dragstart="$event.dataTransfer.setData('text/plain',String(task.id))">
  <div class="card-top"><span class="task-key">{{ taskKey(task.id) }}</span><button class="icon-button tiny" :class="{selected:task.today}" :aria-label="task.today?'Bỏ khỏi My Day':'Thêm vào My Day'" @click="$emit('focus',task)"><Icon name="sun" :size="17"/></button></div>
  <button class="card-title" @click="$emit('open',task)">{{task.title}}</button>
  <p v-if="task.description" class="card-description">{{task.description}}</p>
  <div class="card-tags"><span class="project-tag">{{task.project}}</span><span class="priority-tag" :class="task.priority"><Icon name="flag" :size="12"/>{{priorities[task.priority]}}</span></div>
  <div v-if="task.checklist.length" class="check-progress"><div><span :style="{width:task.checklist.filter(i=>i.done).length/task.checklist.length*100+'%'}"></span></div><small>{{task.checklist.filter(i=>i.done).length}}/{{task.checklist.length}}</small></div>
  <footer class="card-footer"><span class="due" :class="{overdue:overdue(task)}"><Icon name="date" :size="14"/>{{task.due_date===state.today?'Hôm nay':dateLabel(task.due_date)}}</span><span v-if="state.logs.some(l=>l.task_id===task.id)" class="log-count"><Icon name="clock" :size="14"/>{{state.logs.filter(l=>l.task_id===task.id).reduce((n,l)=>n+l.minutes,0)}}p</span></footer>
</article>
</template>
