() => {
  const MIN=44, out={url:location.pathname,vw:innerWidth,findings:[]};
  const add=(kind,detail,el,extra={})=>{const r=el?el.getBoundingClientRect():null;
    out.findings.push({kind,detail,text:el?(el.innerText||el.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,44):'',
      box:r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]:null,...extra});};
  const vis=el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;
    const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0';};
  // Expo's LogBox / error overlay is development chrome, not the app. Left in,
  // a single red toast contributes a dozen contrast, overlap and role findings
  // and buries the real ones.
  const devChrome=[...document.querySelectorAll('*')].filter(el=>{
    const t=(el.innerText||'');
    return /^(Dismiss|Minimize)$/.test(t.trim())
      || el.id==='logbox'
      || /logbox/i.test(el.className&&el.className.toString?el.className.toString():'');
  });
  const inDevChrome=el=>{
    for(const d of devChrome){ if(d===el) return true;
      // The toast's own container is a few levels up from the Dismiss button.
      let p=d; for(let i=0;i<4&&p;i++){ p=p.parentElement; if(p&&p.contains(el)) return true; } }
    return false;
  };
  const all=[...document.querySelectorAll('*')].filter(el=>vis(el)&&!inDevChrome(el));
  out.devChromePresent = devChrome.length>0;
  const ptr=el=>getComputedStyle(el).cursor==='pointer';

  const de=document.documentElement;
  if(de.scrollWidth>de.clientWidth+1) add('page-h-overflow',`${de.scrollWidth} > ${de.clientWidth}`,null);

  // Horizontal escape — report only the outermost offender per subtree.
  const esc=new Set();
  for(const el of all){const r=el.getBoundingClientRect();
    if(r.width>0&&(r.left<-1||r.right>innerWidth+1)){
      let sc=false;for(let p=el.parentElement;p;p=p.parentElement){if(/auto|scroll/.test(getComputedStyle(p).overflowX)){sc=true;break;}}
      if(!sc&&!esc.has(el.parentElement)) {esc.add(el); add('escapes-viewport',`l=${Math.round(r.left)} r=${Math.round(r.right)} vw=${innerWidth}`,el);}}}

  // Clipped by an overflow:hidden ancestor. A horizontally scrollable ancestor
  // is excluded: content extending past a carousel's edge is the point of a
  // carousel, not a defect.
  for(const el of all){const r=el.getBoundingClientRect();if(!r.width)continue;
    for(let p=el.parentElement;p;p=p.parentElement){const cs=getComputedStyle(p);
      // A horizontal scroller ends the walk before any hidden-overflow test.
      // Checked first and on the computed *longhand*: react-native-web's
      // carousels compute `overflow: "auto hidden"`, so an equality test
      // against 'hidden' misses them and the walk carries on to the screen
      // root, which then reports every off-screen carousel item as clipped.
      if(/auto|scroll/.test(cs.overflowX)||p.scrollWidth>p.clientWidth+2) break;
      if(cs.overflowX==='hidden'||cs.overflow==='hidden'){
        const pr=p.getBoundingClientRect();
        if(r.left<pr.left-1||r.right>pr.right+1) add('clipped',`el[${Math.round(r.left)},${Math.round(r.right)}] in [${Math.round(pr.left)},${Math.round(pr.right)}]`,el);
        break;}}}

  // A pressable is the OUTERMOST element of a cursor:pointer subtree.
  const pressables=all.filter(el=>{
    if(el.matches('input,textarea,select')) return true;
    if(!ptr(el)) return false;
    return !(el.parentElement && ptr(el.parentElement));
  });
  out.pressableCount=pressables.length;
  // WCAG 2.5.8 exempts a target that sits inline in a sentence or block of
  // text — a link inside a paragraph cannot be 44pt tall without wrecking the
  // paragraph, and the spec says so explicitly. Detected by computed display,
  // which react-native-web sets to `inline` for nested <Text>.
  const inlineInProse=el=>{
    if(getComputedStyle(el).display!=='inline') return false;
    const p=el.parentElement;
    return !!p && (p.innerText||'').trim().length > (el.innerText||'').trim().length;
  };
  for(const el of pressables){
    const r=el.getBoundingClientRect();
    if((r.width<MIN||r.height<MIN)&&!inlineInProse(el))
      add('tap-target',`${Math.round(r.width)}x${Math.round(r.height)}`,el);
    const role=el.getAttribute('role');
    // Roles that legitimately describe an interactive control. `tab` matters
    // here: the tab bar is a tablist, not five buttons.
    // `text` counts: an element deliberately marked as text is not an
    // unlabelled control. Chat bubbles are text that carry a copy action, and
    // react-native-web gives every Pressable a pointer cursor regardless.
    const OK=['button','link','tab','checkbox','switch','radio','menuitem','option','text','img','image'];
    if(!el.matches('input,textarea,select')&&!OK.includes(role))
      add('no-role',`role=${role||'none'}`,el);
  }

  // Contrast.
  const pc=c=>{const m=c.match(/[\d.]+/g);return m?{r:+m[0],g:+m[1],b:+m[2],a:m[3]===undefined?1:+m[3]}:null;};
  const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
  const ov=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const bgOf=el=>{for(let p=el;p;p=p.parentElement){const c=pc(getComputedStyle(p).backgroundColor);
    if(c&&c.a>0){if(c.a===1)return c;return ov(c,p.parentElement?bgOf(p.parentElement):{r:255,g:255,b:255,a:1});}}
    return{r:255,g:255,b:255,a:1};};
  const seen=new Map();
  for(const el of all){
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const cs=getComputedStyle(el),fg=pc(cs.color);if(!fg)continue;
    const bg=bgOf(el),eff=fg.a<1?ov(fg,bg):fg;
    const l1=lum(eff),l2=lum(bg);
    const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const size=parseFloat(cs.fontSize),bold=+cs.fontWeight>=700;
    const need=(size>=24||(size>=18.66&&bold))?3:4.5;
    if(ratio<need){
      // Group by colour pair + size: the same token failing 12 times is one defect.
      const key=`${cs.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${size}`;
      if(!seen.has(key)){seen.set(key,{n:0,sample:''});
        add('contrast',`${ratio.toFixed(2)}:1 need ${need} — ${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) @${size}px`,el,{key});}
      seen.get(key).n++;}
  }
  out.contrastGroups=[...seen].map(([k,v])=>({token:k,instances:v.n}));

  // Text nodes that visually overlap another text node.
  //
  // A floating dock, footer or tab bar deliberately sits *over* a scroll view,
  // so an overlap between something inside a scroller and something outside it
  // is layering, not a defect. What matters for those is whether content is
  // still reachable at full scroll, which the scrollers report covers.
  const scrollerOf=el=>{for(let p=el.parentElement;p;p=p.parentElement){
    const cs=getComputedStyle(p);
    if(/auto|scroll/.test(cs.overflowY)&&p.scrollHeight>p.clientHeight+2) return p;} return null;};
  const texts=all.filter(el=>[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
    const a=texts[i],b=texts[j];
    if(a.contains(b)||b.contains(a))continue;
    if(scrollerOf(a)!==scrollerOf(b))continue;   // one floats over the other
    // An inline element that wraps reports one union rect spanning every line
    // it occupies, so two links on adjacent lines of the same paragraph appear
    // to intersect when nothing is drawn on top of anything.
    if(getComputedStyle(a).display==='inline'||getComputedStyle(b).display==='inline')continue;
    const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
    const ox=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left);
    const oy=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
    if(ox>2&&oy>2) add('text-overlap',`"${a.innerText.trim().slice(0,20)}" x "${b.innerText.trim().slice(0,20)}" overlap ${Math.round(ox)}x${Math.round(oy)}`,a);
  }

  // Scroll containers and whether their end is reachable.
  out.scrollers=all.filter(el=>/auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+2)
    .map(el=>{const r=el.getBoundingClientRect();
      return{box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
        scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,max:el.scrollHeight-el.clientHeight};});

  const c={};for(const f of out.findings)c[f.kind]=(c[f.kind]||0)+1;out.counts=c;
  return out;
}
