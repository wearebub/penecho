import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { safeSvg, rasterizeTenetIllustrations, validSelectionQuestion, TENET_ILLUSTRATION_PROMPT } = require("../src/server/tenet-illustration.js");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><ellipse cx="180" cy="170" rx="120" ry="60" fill="#559969"/><path d="M 270 150 L 330 100 L 305 165 Z" fill="beige" stroke="black" stroke-width="3"/><circle cx="265" cy="160" r="5" fill="black"/></svg>';
const command = () => ({ tool:"draw_image", x:1000, y:1200, w:800, h:600, svg });

test("restricted static illustration becomes a bounded PNG, not executable model output", async () => {
  const [result] = await rasterizeTenetIllustrations([{...command(),png:"untrusted",url:"https://example.invalid/image"}], sharp);
  assert.deepEqual(Object.keys(result).sort(), ["h","png","tool","w","x","y"]);
  assert.equal(result.tool, "draw_image");
  assert.match(result.png, /^data:image\/png;base64,/);
  const metadata = await sharp(Buffer.from(result.png.slice(22), "base64")).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 600);
  assert.equal(metadata.format, "png");
});
test("large logical illustrations use bounded raster dimensions", async () => {
  const [result] = await rasterizeTenetIllustrations([{...command(), w:6000,h:4000}], sharp);
  const metadata = await sharp(Buffer.from(result.png.slice(22), "base64")).metadata();
  assert.equal(metadata.width, 1536);
  assert.equal(metadata.height, 1024);
  assert.equal(result.w, 6000);
});
for (const content of [
  '<script>alert(1)</script>',
  '<image href="https://example.invalid/private"/>',
  '<image href="file:///etc/passwd"/>',
  '<foreignObject><div>HTML</div></foreignObject>',
  '<style>path { fill:url(https://example.invalid); }</style>',
  '<path d="M 0 0 L 10 10" onclick="alert(1)"/>',
  '<path d="M 0 0 L 10 10" fill="url(#remote)"/>',
  '<path d="M 0 0 L 10 10" style="stroke:red"/>',
  '<path d="M 0 0 L 10 10" transform="scale(999999)"/>',
  '<text>unsupported text</text>',
  '<animate attributeName="x"/>',
  '<path d="M 0 0 L 1e100 20"/>',
]) {
  test(`static-image boundary refuses ${content.slice(0,50)}`, () => {
    assert.throws(() => safeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${content}</svg>`), { name:"TenetIllustrationError" });
  });
}
test("XML declarations, entities, oversized trees and invalid geometry fail closed", async () => {
  for (const value of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+svg, '<?xml version="1.0"?>'+svg,
    svg.replace("<ellipse", '<g>&external;</g><ellipse'),
    svg.replace("<ellipse", '<g>'.repeat(14)+'</g>'.repeat(14)+'<ellipse'),
    svg.replace("<ellipse", '<circle cx="1" cy="1" r="1"/>'.repeat(193)+'<ellipse')]) {
    assert.throws(() => safeSvg(value), { name:"TenetIllustrationError" });
  }
  for (const value of [{...command(),x:-1}, {...command(),x:19999}, {...command(),w:Infinity}, {...command(),h:0}, {...command(),svg:"x".repeat(65537)}]) {
    await assert.rejects(rasterizeTenetIllustrations([value], sharp), { name:"TenetIllustrationError" });
  }
  await assert.rejects(rasterizeTenetIllustrations([command(),command(),command()], sharp), { name:"TenetIllustrationError" });
});
test("ordinary commands pass through without requiring rasterization", async () => {
  const text = {tool:"write_text",text:"Synthetic test"};
  assert.deepEqual(await rasterizeTenetIllustrations([text], null), [text]);
});
test("typed questions require explicit manual selection and bounded nonempty text", () => {
  const context = {box:{x:1,y:1,w:10,h:10}};
  assert.equal(validSelectionQuestion(undefined, null, "user_paused"), true);
  assert.equal(validSelectionQuestion("Why this step?",context,"manual"), true);
  for (const question of ["", "   ", "x".repeat(1001), {}, 42]) assert.equal(validSelectionQuestion(question,context,"manual"), false);
  assert.equal(validSelectionQuestion("Why?", null, "manual"), false);
  assert.equal(validSelectionQuestion("Why?", context, "user_paused"), false);
  assert.match(TENET_ILLUSTRATION_PROMPT, /All district rules still apply/);
});
