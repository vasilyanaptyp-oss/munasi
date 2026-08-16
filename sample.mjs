import { loadImage, createCanvas } from "@napi-rs/canvas";
const img=await loadImage(process.argv[2]);
const c=createCanvas(img.width,img.height);const x=c.getContext("2d");x.drawImage(img,0,0);
const d=x.getImageData(0,0,img.width,img.height).data;
for(const [px,py] of process.argv.slice(3).map(s=>s.split(",").map(Number))){
  const i=(py*img.width+px)*4;
  console.log(`${px},${py} -> #${((d[i]<<16)|(d[i+1]<<8)|d[i+2]).toString(16).padStart(6,"0")}`);
}
