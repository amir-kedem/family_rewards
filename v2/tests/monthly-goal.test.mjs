import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthlyGoalPoints} from '../src/monthly-goal.ts';
const activity = (overrides={}) => ({id:'a',delta:25,kind:'task',label:'Task',at:'2026-11-04T12:00:00Z',cancelled_by:null,...overrides});
test('monthly goal counts earnings, excludes prize spending and refunds, and removes cancelled tasks', () => {
  const rows = [activity(),activity({id:'prize',kind:'reward',delta:-80}),
    activity({id:'refund',kind:'undo',delta:80}),
    activity({id:'cancelled',cancelled_by:'undo-task'}),
    activity({id:'undo-task',kind:'undo',delta:-25}),
    activity({id:'legacy-task',kind:'legacy',delta:40,label:'ביצוע קריאה'}),
    activity({id:'legacy-prize',kind:'legacy',delta:-200,label:'מימוש גלידה'}),
    activity({id:'correction',kind:'adjust',delta:-5}),
    activity({id:'last-month',at:'2026-10-28T12:00:00Z'})];
  assert.equal(monthlyGoalPoints(rows,new Date('2026-11-04T15:00:00Z')),60);
  assert.equal(monthlyGoalPoints(rows,new Date('2026-12-04T15:00:00Z')),0);
});
test('monthly goal follows Israel calendar at the month boundary', () => {
  const rows=[activity({at:'2026-10-31T21:59:59Z'}),activity({at:'2026-10-31T22:00:00Z'})];
  assert.equal(monthlyGoalPoints(rows,new Date('2026-11-01T00:00:00Z')),25);
});
