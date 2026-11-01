const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('fr-FR');
const scoreText = n => n.toFixed(3).replace('.', ',');
const state = {a:0,b:1,threshold:.9,limit:300,mode:'arcs',page:0,selected:null,filtered:[],drawn:[],view:null};
let manifest, data, generation=0, drag=null, timer, size, hover=null;
const cache = new Map();
const canvas=$('plot'), ctx=canvas.getContext('2d');
const palette=['#287763','#cb8157','#548bab','#90799e','#82914b','#bc6470'];
function fail(error){ $('error').textContent=error.message; $('error').hidden=false; $('loading').hidden=true; }
function book(which){return manifest.books[state[which]];}
function pairAt(index){const flat=data.ids[index], r=Math.floor(flat/data.cols), c=flat%data.cols;return state.a===data.low?{x:r,y:c,score:data.scores[index],index}:{x:c,y:r,score:data.scores[index],index};}
function resetView(){if(!manifest)return;state.view={x0:0,x1:book('a').verses.length-1,y0:0,y1:book('b').verses.length-1};}
async function loadPair(){
 const token=++generation; $('loading').hidden=false; $('loading').textContent='Chargement des correspondances…'; $('error').hidden=true; data=null; state.selected=null;state.filtered=[];state.drawn=[];hover=null; $('tooltip').hidden=true; $('pairList').replaceChildren();$('reading').replaceChildren();$('selectedScore').textContent=''; $('matchCount').textContent=''; $('pageInfo').textContent=''; $('thresholdHint').textContent='';
 $('plotTitle').textContent=`${book('a').name} × ${book('b').name}`; resetView();draw();
 const low=Math.min(state.a,state.b),high=Math.max(state.a,state.b),key=`${low}-${high}`;
 try{
  if(!cache.has(key)){
   const info=manifest.pairs[key], response=await fetch(`data/${info.file}`);
   if(!response.ok)throw new Error('Impossible de charger les scores. Vérifiez les fichiers dans web/dist/data.');
   const packed=await response.arrayBuffer();
   const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
   const buffer=await new Response(stream).arrayBuffer();const count=new DataView(buffer).getUint32(0,true);
   if(buffer.byteLength!==4+count*8)throw new Error('Fichier de scores incomplet.');
   cache.set(key,{low,cols:info.cols,scores:new Float32Array(buffer,4,count),ids:new Uint32Array(buffer,4+count*4,count)});
  }
  if(token!==generation)return;
  data=cache.get(key);$('loading').hidden=true;filter();
 }catch(error){if(token===generation)fail(error);}
}
function filter(){
 if(!data)return;
 const threshold=Number($('threshold').value);state.threshold=threshold;state.limit=Number($('limit').value);
 $('thresholdValue').textContent=threshold.toFixed(3).replace('.',',');
 const masks=['a','b'].map(which=>{
  const suffix=which.toUpperCase(),chapter=$('chapter'+suffix).value,verse=$('verse'+suffix).value;
  if(!chapter)return null;
  return book(which).verses.map((v,i)=>verse!==''?i===Number(verse):v.ref.split(':')[0]===chapter);
 });
 let lo=0,hi=data.scores.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(data.scores[mid]>=threshold)lo=mid+1;else hi=mid;}
 if(masks.some(Boolean)){
  const matches=[];
  for(let i=0;i<lo;i++){const p=pairAt(i);if((!masks[0]||masks[0][p.x])&&(!masks[1]||masks[1][p.y]))matches.push(i);}
  state.filtered=matches;
 }else state.filtered=Uint32Array.from({length:lo},(_,i)=>i);
 const count=state.filtered.length;
 $('thresholdHint').textContent=count===0&&threshold>manifest.minScore
  ?'Aucune correspondance à ce seuil. Essayez de le diminuer.'
  :count>state.limit&&threshold<Number($('threshold').max)
   ?`${fmt(state.limit)} correspondances affichées sur ${fmt(count)}. Augmentez le seuil pour réduire leur nombre.`
   :'';
 state.page=0;
 state.selected=state.filtered.length?state.filtered[0]:null;
 $('matchCount').textContent=`${fmt(state.filtered.length)} paire${state.filtered.length>1?'s':''} · ${fmt(Math.min(state.limit,state.filtered.length))} affichée${Math.min(state.limit,state.filtered.length)>1?'s':''}`;
 renderReading();renderList();draw();
}
function renderReading(){
 const reading=$('reading');reading.replaceChildren();
 if(state.selected===null){const p=document.createElement('p');p.className='empty';p.textContent='Aucune paire pour ce filtre. Diminuez le seuil ou choisissez un autre verset.';reading.append(p);$('selectedScore').textContent='';return;}
 const pair=pairAt(state.selected);$('selectedScore').textContent=`cos ${scoreText(pair.score)}`;
 for(const [which,index] of [['a',pair.x],['b',pair.y]]){
  const verse=book(which).verses[index], section=document.createElement('section'),ref=document.createElement('div'),p=document.createElement('p');
  section.className='verse';ref.className='ref';ref.textContent=`${book(which).name} ${verse.ref}`;p.textContent=verse.text;section.append(ref,p);reading.append(section);
 }
}
function select(index){state.selected=index;renderReading();renderList();draw();}
function renderList(){
 const list=$('pairList');list.replaceChildren();const start=state.page*20,end=Math.min(start+20,state.filtered.length);
 $('pageInfo').textContent=state.filtered.length?`${start+1}–${end} / ${fmt(state.filtered.length)}`:'0 paire';
 $('prevPage').disabled=state.page===0;$('nextPage').disabled=end>=state.filtered.length;
 for(let i=start;i<end;i++){
  const index=state.filtered[i],p=pairAt(index),button=document.createElement('button'),label=document.createElement('span'),score=document.createElement('small');
  button.className='pair-row'+(index===state.selected?' selected':'');button.setAttribute('aria-pressed',String(index===state.selected));
  label.textContent=`${book('a').name} ${book('a').verses[p.x].ref} ↔ ${book('b').name} ${book('b').verses[p.y].ref}`;score.textContent=scoreText(p.score);
  button.append(label,score);button.addEventListener('click',()=>select(index));list.append(button);
 }
}
function resize(){const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);size={w:r.width,h:r.height};draw();}
function geometry(){return {left:60,top:25,right:size.w-20,bottom:size.h-60};}
function text(value,x,y,align='center',color='#6e7d76',font='11px Arial'){ctx.fillStyle=color;ctx.font=font;ctx.textAlign=align;ctx.fillText(value,x,y);}
function draw(){
 if(!size)return;const {w,h}=size;ctx.clearRect(0,0,w,h);state.drawn=[];if(!manifest||!state.view)return;
 const g=geometry(),pw=g.right-g.left,ph=g.bottom-g.top,v=state.view;
 if(pw<=0||ph<=0)return;
 ctx.strokeStyle='#e4e8e0';ctx.lineWidth=1;
 const mapX=x=>g.left+(x-v.x0)/(v.x1-v.x0)*pw,mapY=y=>g.top+(y-v.y0)/(v.y1-v.y0)*ph;
 if(state.mode==='scatter'){
  const tickCount=w<500?4:6;
  for(let i=0;i<tickCount;i++){
   const f=i/(tickCount-1),xi=Math.round(v.x0+f*(v.x1-v.x0)),yi=Math.round(v.y0+f*(v.y1-v.y0)),x=mapX(xi),y=mapY(yi);
   ctx.beginPath();ctx.moveTo(x,g.top);ctx.lineTo(x,g.bottom);ctx.stroke();ctx.beginPath();ctx.moveTo(g.left,y);ctx.lineTo(g.right,y);ctx.stroke();
   text(book('a').verses[xi]?.ref||'',x,g.bottom+20);text(book('b').verses[yi]?.ref||'',g.left-9,y+4,'right');
  }
  text(`${book('a').name} · chapitre:verset`,(g.left+g.right)/2,h-10,'center','#203b36');
  ctx.save();ctx.translate(12,(g.top+g.bottom)/2);ctx.rotate(-Math.PI/2);text(`${book('b').name} · chapitre:verset`,0,0,'center','#203b36');ctx.restore();
 }else{
  for(let i=0;i<=5;i++){const y=g.bottom-i/5*ph;ctx.beginPath();ctx.moveTo(g.left,y);ctx.lineTo(g.right,y);ctx.stroke();text((i/5).toFixed(1),g.left-10,y+4,'right');}
  const na=book('a').verses.length,nb=book('b').verses.length,total=na+nb-1,split=g.left+(na-.5)/total*pw;
  ctx.strokeStyle='#b7c8bb';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(split,g.top);ctx.lineTo(split,g.bottom);ctx.stroke();ctx.setLineDash([]);
  for(const [which,offset,color] of [['a',0,'#527D99'],['b',na,'#C57B51']]){
   const start=which==='a'?g.left:split,end=which==='a'?split:g.right;
   ctx.fillStyle=color;ctx.fillRect(start,g.bottom,end-start,7);
   const count=book(which).verses.length;
   for(let i=0;i<4;i++){if(which==='b'&&i===0)continue;const index=Math.round(i/3*(count-1));text(book(which).verses[index].ref,g.left+(offset+index)/total*pw,g.bottom+26);}
   text(book(which).name,g.left+(offset+(count-1)/2)/total*pw,h-10,'center',color,'bold 12px Arial');
  }
  text('Score',g.left-10,g.top-8,'right');
 }
 if(!data)return;
 const indices=Array.from(state.filtered.slice(0,state.limit));
 if(state.selected!==null&&!indices.includes(state.selected))indices.push(state.selected);
 ctx.save();ctx.beginPath();ctx.rect(g.left-4,g.top-4,pw+8,ph+8);ctx.clip();
 for(const index of indices){
  const p=pairAt(index),selected=index===state.selected;
  if(state.mode==='scatter'){
   const x=mapX(p.x),y=mapY(p.y);if(x<g.left||x>g.right||y<g.top||y>g.bottom)continue;
   ctx.beginPath();ctx.arc(x,y,selected?5:state.limit>1000?1.8:3,0,Math.PI*2);ctx.fillStyle=selected?'#c87645':'#287763';ctx.globalAlpha=selected?1:.55;ctx.fill();
   if(selected){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}state.drawn.push({index,x,y});
  }else{
   const total=book('a').verses.length+book('b').verses.length-1;
   const x1=g.left+p.x/total*pw,x2=g.left+(book('a').verses.length+p.y)/total*pw;
   const cx=(x1+x2)/2,rx=(x2-x1)/2,ry=p.score*ph;
   ctx.beginPath();ctx.ellipse(cx,g.bottom,rx,ry,0,Math.PI,2*Math.PI);ctx.strokeStyle=selected?'#203b36':palette[index%palette.length];ctx.lineWidth=selected?2.5:1;ctx.globalAlpha=selected?1:.35;ctx.stroke();state.drawn.push({index,cx,rx,ry,y:g.bottom});
  }
 }
 ctx.globalAlpha=1;ctx.restore();
 if(!state.filtered.length){
  const x=(g.left+g.right)/2,y=(g.top+g.bottom)/2;
  text('Aucune correspondance à ce seuil',x,y);
  if(state.threshold>manifest.minScore)text('Essayez de le diminuer.',x,y+20);
 }
}
function eventPosition(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function nearest(pos){let best=null,distance=10;for(const p of state.drawn){let d;if(state.mode==='scatter')d=Math.hypot(pos.x-p.x,pos.y-p.y);else{const t=(pos.x-p.cx)/p.rx;if(Math.abs(t)>1)continue;d=Math.abs(pos.y-(p.y-p.ry*Math.sqrt(1-t*t)));}if(d<distance){best=p.index;distance=d;}}return best;}
canvas.addEventListener('pointermove',e=>{
 const p=eventPosition(e);
 if(drag&&state.mode==='scatter'){
  const g=geometry(),dx=(p.x-drag.x)/(g.right-g.left)*(drag.view.x1-drag.view.x0),dy=(p.y-drag.y)/(g.bottom-g.top)*(drag.view.y1-drag.view.y0);
  const width=drag.view.x1-drag.view.x0,height=drag.view.y1-drag.view.y0;
  const x0=Math.max(0,Math.min(book('a').verses.length-1-width,drag.view.x0-dx));const y0=Math.max(0,Math.min(book('b').verses.length-1-height,drag.view.y0-dy));
  state.view={x0,x1:x0+width,y0,y1:y0+height};drag.moved ||= Math.hypot(p.x-drag.x,p.y-drag.y)>4;draw();return;
 }
 hover=nearest(p);canvas.style.cursor=hover===null?(state.mode==='scatter'?'grab':'default'):'pointer';const tip=$('tooltip');tip.hidden=hover===null;
 if(hover!==null){const pair=pairAt(hover);tip.textContent=`${book('a').name} ${book('a').verses[pair.x].ref} ↔ ${book('b').name} ${book('b').verses[pair.y].ref} · ${scoreText(pair.score)}`;tip.style.left=Math.max(0,Math.min(p.x+12,size.w-225))+'px';tip.style.top=Math.max(0,p.y-42)+'px';}
});
canvas.addEventListener('pointerdown',e=>{if(!data)return;const p=eventPosition(e);drag={...p,view:{...state.view},moved:false};canvas.setPointerCapture(e.pointerId);$('tooltip').hidden=true;});
canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const index=nearest(eventPosition(e));if(index!==null)select(index);}drag=null;});
canvas.addEventListener('pointercancel',()=>drag=null);
canvas.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});
canvas.addEventListener('wheel',e=>{
 if(state.mode!=='scatter'||!data)return;e.preventDefault();const p=eventPosition(e),g=geometry(),v=state.view;
 const fx=Math.max(0,Math.min(1,(p.x-g.left)/(g.right-g.left))),fy=Math.max(0,Math.min(1,(p.y-g.top)/(g.bottom-g.top)));
 const factor=e.deltaY>0?1.2:1/1.2,maxX=book('a').verses.length-1,maxY=book('b').verses.length-1;
 const width=Math.max(10,Math.min(maxX,(v.x1-v.x0)*factor)),height=Math.max(10,Math.min(maxY,(v.y1-v.y0)*factor));
 const x0=Math.max(0,Math.min(maxX-width,v.x0+fx*(v.x1-v.x0)-fx*width)),y0=Math.max(0,Math.min(maxY-height,v.y0+fy*(v.y1-v.y0)-fy*height));
 state.view={x0,x1:x0+width,y0,y1:y0+height};draw();
},{passive:false});
function setMode(mode){state.mode=mode;for(const name of ['scatter','arcs']){$(name+'Tab').classList.toggle('active',name===mode);$(name+'Tab').setAttribute('aria-pressed',String(name===mode));}$('resetZoom').disabled=mode==='arcs';$('plotHelp').textContent=mode==='arcs'?'Hauteur = score · couleurs distinctives · cliquer sur un arc pour lire':'Molette pour zoomer · glisser pour déplacer · cliquer pour lire';$('tooltip').hidden=true;draw();}
$('scatterTab').onclick=()=>setMode('scatter');$('arcsTab').onclick=()=>setMode('arcs');$('resetZoom').onclick=()=>{resetView();draw();};
$('threshold').oninput=()=>{$('thresholdValue').textContent=Number($('threshold').value).toFixed(3).replace('.',',');clearTimeout(timer);timer=setTimeout(filter,100);};
$('limit').onchange=filter;
$('prevPage').onclick=()=>{if(state.page>0){state.page--;renderList();}};
$('nextPage').onclick=()=>{if((state.page+1)*20<state.filtered.length){state.page++;renderList();}};
function updateVerses(which){
 const suffix=which.toUpperCase(),chapter=$('chapter'+suffix).value,select=$('verse'+suffix);
 select.replaceChildren(new Option('Tous',''));select.disabled=!chapter;
 select.title=chapter?'':'Choisissez d’abord un chapitre';
 if(chapter)book(which).verses.forEach((v,i)=>{const [c,n]=v.ref.split(':');if(c===chapter)select.add(new Option(n,String(i)));});
}
function updateChapters(which){
 const select=$('chapter'+which.toUpperCase());
 select.replaceChildren(new Option('Tous',''));
 for(const chapter of new Set(book(which).verses.map(v=>v.ref.split(':')[0])))select.add(new Option(chapter,chapter));
 select.disabled=false;updateVerses(which);
}
for(const which of ['a','b']){
 const suffix=which.toUpperCase();
 $('book'+suffix).onchange=()=>{state[which]=Number($('book'+suffix).value);updateChapters(which);$('selectionNotice').textContent='';loadPair();};
 $('chapter'+suffix).onchange=()=>{updateVerses(which);$('selectionNotice').textContent='';filter();};
 $('verse'+suffix).onchange=()=>{
  const other=which==='a'?'b':'a',otherSelect=$('verse'+other.toUpperCase());
  $('selectionNotice').textContent='';
  if($('verse'+suffix).value!==''&&otherSelect.value!==''){
   otherSelect.value='';
   $('selectionNotice').textContent=`${book(other).name} (${other==='a'?'gauche':'droite'}) : retour à « Tous les versets ». Un seul verset précis à la fois.`;
  }
  filter();
 };
}
new ResizeObserver(resize).observe(canvas);
async function init(){
 const response=await fetch('data/manifest.json');if(!response.ok)throw new Error('Corpus manquant : lancer prepare_data.py, puis ouvrir le site via le serveur local.');manifest=await response.json();
 for(const id of ['bookA','bookB']){manifest.books.forEach((b,i)=>{const option=document.createElement('option');option.value=i;option.textContent=b.name;$(id).append(option);});$(id).disabled=false;}
 $('bookA').value=state.a;$('bookB').value=state.b;updateChapters('a');updateChapters('b');$('threshold').min=manifest.minScore;$('threshold').disabled=false;setMode(state.mode);await loadPair();
}
init().catch(fail);
