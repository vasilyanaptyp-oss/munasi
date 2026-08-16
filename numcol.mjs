import { loadImage, createCanvas } from "@napi-rs/canvas";
async function px(p0){const img=await loadImage(p0);const c=createCanvas(img.width,img.height);const x=c.getContext("2d");x.drawImage(img,0,0);return {w:img.width,h:img.height,d:x.getImageData(0,0,img.width,img.height).data};}
// count strongly-saturated yellow-ish and grey-ish pixels that are not the blue field
for (const file of process.argv.slice(2)) {
  const p=await px(file);
  const hist=new Map();
  for(let i=0;i<p.d.length;i+=4){
    const r=p.d[i],g=p.d[i+1],b=p.d[i+2];
    if(b>140&&b-r>50&&g>90) continue;          // field
    if(r<60&&g<60&&b<60) continue;             // walls
    if(r>200&&g>200&&b>200) continue;          // white ink
    // yellow: r,g high, b low
    if(r>150&&g>140&&b<120){
      const k=`${r>>4}:${g>>4}:${b>>4}`;
      hist.set(k,(hist.get(k)??0)+1);
    }
  }
  const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,n])=>{const [r,g,b]=k.split(":").map(Number);return `#${((r*16+8)<<16|(g*16+8)<<8|(b*16+8)).toString(16).padStart(6,"0")}x${n}`;});
  console.log(file.replace("/tmp/",""), top.join(" ") || "(no yellow)");
}
