const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('PencilKit receives selected thickness and does not change it when zoom changes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/client/app/tenet-native-ink.js'), 'utf8');
  const configuration = source.slice(source.indexOf('function configuration()'), source.indexOf('async function synchronize()'));
  const controls = source.match(/^\s*const webControlSelector = [^\r\n]+;/m)?.[0];
  assert.ok(controls, 'Native control selector must be available to the configuration fixture');
  const state = { mode:'pen', inkColor:'#10243e', pen:3, scale:0.2, panX:0, panY:0 };
  const context = vm.createContext({ state, sessionId:'width-test', nativeToolKey:'', nativeToolWidth:4,
    canvasViewportMetrics:()=>({width:1024}), view:{getBoundingClientRect:()=>({x:0,y:100,width:1024,height:668})},
    engine:'pencilkit', lock:0, suspended:new Set(), document:{hidden:false,querySelectorAll:()=>[]},
    snapshotLoadInProgress:false, modalOpen:()=>false, onscreen:()=>true, window:{innerWidth:1024},
    SIZE:20000, toolRequestId:0, widthRequestId:0, fingerDrawing:true,
  });
  vm.runInContext(`${controls}\n${configuration}`, context);
  assert.equal(vm.runInContext('configuration().width',context),15);
  state.pen=8;
  assert.equal(vm.runInContext('configuration().width',context),40);
  state.scale=0.4;
  assert.equal(vm.runInContext('configuration().width',context),40);
  state.pen=5;
  assert.equal(vm.runInContext('configuration().width',context),12.5);
});
