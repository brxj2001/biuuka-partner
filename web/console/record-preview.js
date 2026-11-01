// Only this receiver executes. Generated scripts, navigation and active embeds
// are discarded; the response CSP also blocks all external resource requests.
(() => {
 const html=new Set('div span main section article header footer aside nav p h1 h2 h3 h4 h5 h6 br hr pre code blockquote ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col figure figcaption b strong i em u s small sub sup mark a button label progress meter details summary img style'.split(' '));
 const svg=new Set('svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask pattern filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode title desc use symbol'.split(' '));
 const attrs=new Set('id class style title role aria-label width height viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity stroke-dasharray stroke-dashoffset opacity transform gradientTransform gradientUnits offset stop-color stop-opacity clip-path clip-rule mask filter font-family font-size font-weight text-anchor dominant-baseline dx dy patternUnits patternTransform stdDeviation in in2 result mode values type operator k1 k2 k3 k4 flood-color flood-opacity colspan rowspan scope open value max min low high optimum alt'.split(' '));
 function copy(node){
  if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||'');
  if(node.nodeType!==Node.ELEMENT_NODE)return null;
  const isSvg=node.namespaceURI==='http://www.w3.org/2000/svg';
  if(!(isSvg?svg:html).has(node.localName))return null;
  const clean=isSvg?document.createElementNS(node.namespaceURI,node.localName):document.createElement(node.localName);
  for(const attr of node.attributes){
   if(attrs.has(attr.name))clean.setAttribute(attr.name,attr.value);
   else if((attr.localName==='href')&&isSvg&&/^#[\w:.-]+$/.test(attr.value))clean.setAttribute('href',attr.value);
   else if(attr.name==='src'&&node.localName==='img'&&/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(attr.value))clean.setAttribute('src',attr.value);
  }
  for(const child of node.childNodes){const value=copy(child);if(value)clean.append(value);}
  return clean;
 }
 // Export only the sanitized SVG, with computed CSS frozen at its first frame.
 // The opaque sandbox cannot access accounts, storage or external resources.
 function snapshot(){
  const roots=document.body.querySelectorAll('svg');if(roots.length!==1)throw Error('score_svg_required');
  const root=roots[0];if(root.querySelectorAll('*').length>10000)throw Error('score_too_large');
  const animations=document.getAnimations().map(animation=>({animation,time:animation.currentTime,state:animation.playState}));
  for(const {animation} of animations){animation.pause();animation.currentTime=0;}
  try{
  const clone=root.cloneNode(true),original=[root,...root.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  const properties='fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity stroke-dasharray stroke-dashoffset opacity color visibility display transform transform-origin transform-box clip-path clip-rule mask filter font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline stop-color stop-opacity flood-color flood-opacity'.split(' ');
  original.forEach((node,index)=>{
   const target=copies[index],computed=getComputedStyle(node);target.removeAttribute('class');target.removeAttribute('style');
   for(const property of properties){let value=computed.getPropertyValue(property);if(!value)continue;
    value=value.replace(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi,(_match,url)=>{const hash=url.lastIndexOf('#');if(hash<0||!/^#[\w:.-]+$/.test(url.slice(hash)))throw Error('score_unsafe_svg');return 'url('+url.slice(hash)+')';});
    target.style.setProperty(property,value);
   }
   // Geometry scorers read SVG transform attributes, not CSS transform-origin.
   if(node!==root&&node instanceof SVGGraphicsElement&&node.parentElement instanceof SVGGraphicsElement){
    const parentMatrix=node.parentElement.getCTM(),matrix=node.getCTM();
    if(parentMatrix&&matrix){const local=parentMatrix.inverse().multiply(matrix),values=[local.a,local.b,local.c,local.d,local.e,local.f];
     if(!values.every(Number.isFinite))throw Error('score_standalone_required');
     target.setAttribute('transform',`matrix(${values.join(' ')})`);
     for(const key of ['transform','transform-origin','transform-box'])target.style.removeProperty(key);
    }
   }
   if(['rect','circle','ellipse'].includes(node.localName))for(const key of ['x','y','cx','cy','r','rx','ry','width','height']){const value=computed.getPropertyValue(key);if(value&&value!=='auto'&&value!=='none')target.setAttribute(key,value);}
  });
  clone.querySelectorAll('style').forEach(node=>node.remove());
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const bounds=root.getBoundingClientRect();if(!bounds.width||!bounds.height)throw Error('score_svg_required');
  if(!clone.hasAttribute('viewBox'))clone.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
  clone.setAttribute('width',String(bounds.width));clone.setAttribute('height',String(bounds.height));
  const value=new XMLSerializer().serializeToString(clone);if(new TextEncoder().encode(value).length>1048576)throw Error('score_too_large');return value;
  }finally{for(const {animation,time,state} of animations){animation.currentTime=time;if(state==='running')animation.play();}}
 }
 let generation=0;
 addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='biuuka-record-preview'||typeof event.data.source!=='string'||event.data.source.length>2*1024*1024)return;
  const parsed=document.createElement('template');parsed.innerHTML=event.data.source;
  const content=document.createDocumentFragment();
  for(const node of parsed.content.childNodes){const clean=copy(node);if(clean)content.append(clean);}
  document.body.replaceChildren(content);
  const current=++generation,requestId=event.data.requestId;
  if(typeof requestId!=='string'||requestId.length>100)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(current!==generation)return;
   try{parent.postMessage({type:'biuuka-score-snapshot',requestId,svg:snapshot()},'*');}
   catch(e){parent.postMessage({type:'biuuka-score-snapshot',requestId,error:['score_svg_required','score_too_large','score_unsafe_svg'].includes(e.message)?e.message:'score_standalone_required'},'*');}
  }));
 });
})();
