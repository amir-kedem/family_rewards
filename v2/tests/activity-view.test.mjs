import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityDate,byPoints,filterActivity} from '../src/activity-view.ts';
const row=(id,at,kind='task',label='Task',delta=25,cancelled_by=null)=>({id,at,kind,label,delta,cancelled_by});
const now=new Date('2026-11-04T12:00:00Z');
const options={expanded:true,from:'',to:'',type:'all'};
test('point sorting is numeric, stable and does not modify source data',()=>{
  const items=[{id:'a',value:1000},{id:'b',value:20},{id:'c',value:5},{id:'d',value:20}];
  assert.deepEqual(byPoints(items).map(x=>x.id),['c','b','d','a']);
  assert.equal(items[0].id,'a');
});
test('history uses inclusive Israel dates and supports imported action types',()=>{
  const rows=[row('oct','2026-10-31T21:59:59Z'),row('nov','2026-10-31T22:00:00Z'),row('prize','2026-11-03T10:00:00Z','legacy','מימוש גלידה',-200),row('undo','2026-11-03T11:00:00Z','undo','Cancellation',-25),row('cancelled','2026-11-03T10:00:00Z','task','Task',25,'undo')];
  assert.equal(activityDate(rows[1].at),'2026-11-01');
  assert.deepEqual(filterActivity(rows,{...options,from:'2026-11-01',to:'2026-11-01'},now).map(x=>x.id),['nov']);
  assert.deepEqual(filterActivity(rows,{...options,type:'reward'},now).map(x=>x.id),['prize']);
  assert.deepEqual(filterActivity(rows,{...options,type:'undo'},now).map(x=>x.id),['undo','cancelled']);
  assert.deepEqual(filterActivity(rows,{...options,from:'2026-11-04',to:'2026-11-01'},now),[]);
});
test('default history is eight days; expansion makes older records available',()=>{
  const rows=[row('old','2026-10-10T10:00:00Z'),row('recent','2026-11-03T10:00:00Z')];
  assert.deepEqual(filterActivity(rows,{...options,expanded:false},now).map(x=>x.id),['recent']);
  assert.equal(filterActivity(rows,options,now).length,2);
});
