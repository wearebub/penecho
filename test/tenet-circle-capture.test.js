import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/client/app/ai-runtime.js", import.meta.url), "utf8");
const start = source.indexOf("function tenetRegionGeometry(");
const end = source.indexOf("function tenetIllustrationBytes(",start);
assert.ok(start > 0 && end > start);
function harness() {
  const operations = [];
  const context2d = {
    fillRect:() => operations.push("white"), save(){}, restore(){}, setTransform(){},
    beginPath:() => operations.push("path"), moveTo(){},lineTo(){},closePath(){},
    clip:rule => operations.push(`clip:${rule}`),drawImage:() => operations.push("tiles"),
  };
  const context = vm.createContext({
    SIZE:20000, TILE:256, MAX_ATLAS_WIDTH:2048, MAX_ATLAS_HEIGHT:1536,
    performance:{now:()=>1},
    offscreen:(w,h) => ({width:w,height:h,getContext:()=>context2d,toDataURL:()=>"data:image/png;base64,test"}),
    drawAnimationsToContext:() => operations.push("animations"),
    drawWidgetsToContext:() => operations.push("widgets"),
    drawImagesToContext:() => operations.push("images"),
    drawTextBoxesToContext:() => operations.push("text"),
    forTiles:(x,y,w,h,callback) => callback({},0,0),
    drawSharpOverlays:() => operations.push("sharp-and-native"),
  });
  vm.runInContext(source.slice(start,end), context);
  return {context,operations};
}
const polygon = [{x:100,y:200},{x:500,y:220},{x:280,y:400}];
test("every captured layer, including native ink, is clipped before painting", () => {
  const {context,operations} = harness();
  const packed = context.buildTenetRegionImage(polygon,"Explain this step");
  assert.deepEqual(operations, ["white","path","clip:evenodd","animations","widgets","images","text","tiles","sharp-and-native"]);
  const result = JSON.parse(JSON.stringify(packed));
  assert.deepEqual(result.sourceRect, {x:100,y:200,w:400,h:200});
  assert.deepEqual(result.captureRect,result.sourceRect);
  assert.deepEqual(result.changedBox,result.sourceRect);
  assert.deepEqual(result.selectionContext.path,polygon);
  assert.equal(result.selectionQuestion,"Explain this step");
  assert.equal(result.focusInset,null);
  assert.deepEqual(result.hotspotGrid.hotspots,[]);
  assert.equal(result.typedInput,undefined);
  assert.equal(result.drawingData,undefined);
});
test("invalid or unbounded selection never falls through to a full-page capture", () => {
  const {context,operations} = harness();
  for (const points of [[],[{x:0,y:0}], [{x:-1,y:0},{x:10,y:0},{x:10,y:10}], [{x:0,y:0},{x:Infinity,y:0},{x:1,y:1}],Array(513).fill({x:10,y:10})]) {
    assert.throws(() => context.buildTenetRegionImage(points));
  }
  assert.deepEqual(operations,[]);
  assert.throws(() => context.buildTenetRegionImage(polygon,"x".repeat(1001)));
});
test("crop output stays within server dimensions even for large logical regions", () => {
  const {context} = harness();
  const result = context.buildTenetRegionImage([{x:0,y:0},{x:20000,y:0},{x:20000,y:20000},{x:0,y:20000}]);
  assert.ok(result.atlasSize.w <= 2048 && result.atlasSize.h <= 1536);
  assert.equal(result.atlasSize.w,Math.ceil(result.sourceRect.w*result.imageScale));
  assert.equal(result.selectionQuestion,undefined);
});
test("prepared crops carry a page revision guard at the network boundary", () => {
  const requestStart = source.indexOf("async function requestAI(");
  const fetchStart = source.indexOf('await fetch("/api/ai/command"',requestStart);
  const preparation = source.slice(requestStart,fetchStart);
  assert.match(preparation,/expectedRevision !== state\.userRevision/);
  assert.match(preparation,/expectedGeneration !== state\.recognitionGeneration/);
});
