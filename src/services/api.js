import {cloudApi} from './cloudStore'
import {firebaseMessage} from './firebase'
export const isDesktop=!!window.taskflow
export const api=new Proxy({}, {get:(_,action)=>async payload=>{
 if(!Object.hasOwn(cloudApi,action))throw Error('Thao tác không hỗ trợ trong chế độ Firebase.')
 try{return await cloudApi[action](payload===undefined?undefined:JSON.parse(JSON.stringify(payload)))}
 catch(error){throw Error(firebaseMessage(error))}
}})
