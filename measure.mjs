import { loadImage, createCanvas } from "@napi-rs/canvas";
async function px(p0){const img=await loadImage(p0);const c=createCanvas(img.width,img.height);const x=c.getContext("2d");x.drawImage(img,0,0);return {w:img.width,h:img.height,d:x.getImageData(0,0,img.width,img.height).data};}
const at=(p,x,y)=>{const i=(y*p.w+x)*4;return [p.d[i],p.d[i+1],p.d[i+2]];};
const isW=(c)=>c[0]>215&&c[1]>215&&c[2]>215;
const isB=(c)=>c[0]<55&&c[1]<55&&c[2]<55;
for (const file of process.argv.slice(2)) {
  const p=await px(file);
  const bands=[];let s=-1;
  for(let y=0;y<p.h;y++){let k=0;for(let x=0;x<p.w;x+=2)if(isB(at(p,x,y)))k++;
    if(k/(p.w/2)>0.75){if(s<0)s=y;}else if(s>=0){bands.push([s,y-1]);s=-1;}}
  if(s>=0)bands.push([s,p.h-1]);
  const thick=bands.filter(b=>b[1]-b[0]>=8);
  const top=thick[0], bot=thick[thick.length-1];
  let line=`${file}`;
  if(top) line+=`  border ${top[1]-top[0]+1}px  top y=${top[0]}`;
  if(top&&bot&&bot!==top) line+=`  outer ${bot[1]-top[0]+1}px`;
  if(bot){
    const rows=[];
    for(let y=bot[1]+1;y<Math.min(p.h,bot[1]+120);y++){let n=0;for(let x=0;x<p.w;x++)if(isW(at(p,x,y)))n++;if(n>2)rows.push(y);}
    if(rows.length) line+=`  caption ink ${rows[rows.length-1]-rows[0]+1}px gap ${rows[0]-bot[1]}`;
  }
  if(top){
    const rows=[];
    for(let y=0;y<top[0];y++){let n=0;for(let x=0;x<p.w;x++)if(isW(at(p,x,y)))n++;if(n>2)rows.push(y);}
    if(rows.length) line+=`  title ink ${rows[rows.length-1]-rows[0]+1}px gap ${top[0]-rows[rows.length-1]}`;
  }
  console.log(line);
}
