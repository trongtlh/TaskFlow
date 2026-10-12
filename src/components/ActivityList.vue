<script setup>
import Icon from './Icon.vue'
import {actionLabels,fieldLabels,displayValue,stampLabel,taskKey} from '../composables/useWorkspace'
defineProps({events:{type:Array,default:()=>[]},compact:Boolean})
defineEmits(['open'])
</script>
<template>
<div v-if="!events.length" class="empty compact-empty"><Icon name="history" :size="32"/><h3>Chưa có hoạt động</h3><p>Mọi thay đổi được ghi lại tự động.</p></div>
<div v-else class="timeline">
  <article v-for="event in events" :key="event.id" class="timeline-item">
    <span class="timeline-icon"><Icon :name="event.action==='logged'?'clock':event.action==='created'?'plus':event.action==='deleted'?'trash':'history'" :size="15"/></span>
    <div class="timeline-body"><div class="timeline-line"><strong>{{actionLabels[event.action]||event.action}}<small v-if="event.source==='sqlite'"> · Nhập từ SQLite</small></strong><time>{{stampLabel(event.created_at)}}</time></div>
    <button v-if="event.task_id" class="text-button event-task" @click="$emit('open',event.task_id)">{{taskKey(event.task_id)}} · {{event.task_title}}</button><span v-else class="muted">{{event.task_title}}</span>
    <dl v-if="!compact" class="change-list"><div v-for="(change,field) in event.changes" :key="field"><dt>{{fieldLabels[field]||field}}</dt><dd><span class="old-value">{{displayValue(change.before,field)}}</span><span class="change-arrow">→</span><span>{{displayValue(change.after,field)}}</span></dd></div></dl>
    </div>
  </article>
</div>
</template>
