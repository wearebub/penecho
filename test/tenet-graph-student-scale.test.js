"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../src/client/app/tenet-ipad-usability.js"),"utf8");
const from=source.indexOf("  function drawTenetInsertArtwork(");
const to=source.indexOf("  function drawTenetExtraArtwork(",from);
assert(from>=0&&to>from,"Graph artwork function boundaries must exist");
for(const kind of ["graph-first","graph-four"])for(const size of [120,1024]) {
  test(kind+" at "+size+" pixels leaves numerical scale for the student",()=>{
    const labels=[],lines=[];
    const drawing={scale(){},beginPath(){},moveTo(){},stroke(){},fillRect(){},lineTo:(x,y)=>lines.push([x,y]),fillText:text=>labels.push(text)};
    const canvas={getContext:()=>drawing};
    const context=vm.createContext({document:{createElement:()=>canvas},window:{devicePixelRatio:1}});
    const draw=new vm.Script("("+source.slice(from,to).trim()+")").runInContext(context);
    draw(kind,"#10243e",size);
    assert.deepEqual(labels,["x","y"]);
    assert(lines.length>=40,"Retain the grid, axes, arrowheads, and scale ticks");
    assert(canvas.width>0&&canvas.width<=size);
    assert(canvas.height>0&&canvas.height<=size);
  });
}
