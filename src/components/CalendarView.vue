<script setup>
import {computed,ref} from 'vue'
import Icon from './Icon.vue'
import {activeTasks,localDay,state} from '../composables/useWorkspace'
const emit=defineEmits(['open'])
const month=ref(new Date(new Date().getFullYear(),new Date().getMonth(),1))
const label=computed(()=>month.value.toLocaleDateString('vi-VN',{month:'long',year:'numeric'}))
const cells=computed(()=>{const first=new Date(month.value);const offset=(first.getDay()+6)%7;first.setDate(1-offset);return Array.from({length:42},(_,i)=>{const day=new Date(first);day.setDate(first.getDate()+i);const iso=localDay(day);return {iso,day:day.getDate(),muted:day.getMonth()!==month.value.getMonth(),tasks:activeTasks.value.filter(t=>t.due_date===iso)}})})
function shift(n){month.value=new Date(month.value.getFullYear(),month.value.getMonth()+n,1)}
</script>
<template><section class="surface calendar-surface"><header class="calendar-header"><h2>{{label}}</h2><div class="button-row"><button class="button small" @click="month=new Date(new Date().getFullYear(),new Date().getMonth(),1)">Hôm nay</button><button class="icon-button" aria-label="Tháng trước" @click="shift(-1)"><Icon name="left"/></button><button class="icon-button" aria-label="Tháng sau" @click="shift(1)"><Icon name="right"/></button></div></header><div class="calendar-week"><span v-for="day in ['Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy','Chủ nhật']">{{day}}</span></div><div class="calendar-grid"><div v-for="cell in cells" :key="cell.iso" class="calendar-day" :class="{muted:cell.muted,today:cell.iso===state.today}"><time :datetime="cell.iso">{{cell.day}}</time><button v-for="task in cell.tasks" :key="task.id" :class="['calendar-task',task.status]" @click="emit('open',task)">{{task.title}}</button></div></div></section></template>
