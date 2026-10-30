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
 addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='biuuka-record-preview'||typeof event.data.source!=='string'||event.data.source.length>2*1024*1024)return;
  const parsed=document.createElement('template');parsed.innerHTML=event.data.source;
  const content=document.createDocumentFragment();
  for(const node of parsed.content.childNodes){const clean=copy(node);if(clean)content.append(clean);}
  document.body.replaceChildren(content);
 });
})();
