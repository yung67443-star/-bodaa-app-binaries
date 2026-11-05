/* dolce ride vendor web — mirrors APK logic */
(function(){
const $=id=>document.getElementById(id);
const toast=m=>{const t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',3200);};
const cfg=window.DOLCE_FIREBASE_CONFIG, VAPID=window.DOLCE_VAPID_KEY, EP=window.DOLCE_ENDPOINTS||{};
if(!cfg||String(cfg.apiKey).includes('PASTE')){ $('loginErr').textContent='⚠️ Paste Firebase web config into firebase-config.js first.'; }
firebase.initializeApp(cfg);
const auth=firebase.auth(), fs=firebase.firestore(), rtdb=firebase.database();
let vendorDocId=null, vendorData=null, allOrders=[], tab='PENDING', soundOn=true, fcmToken='', editingId=null;
const fmt=n=>'KES '+(Number(n)||0).toFixed(2);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const normStatus=o=>String(o.orderStatus||o.status||'PENDING').toUpperCase().trim();
const inReady=s=>['READY','READY_MATCHING','MATCHING_RIDER','RIDER_NOT_FOUND','DRIVER_ASSIGNED','ARRIVED_AT_STORE'].includes(s);
const inHist=s=>s==='PICKED_UP'||s==='PICKEDUP'||s==='EN_ROUTE'||s==='DELIVERED'||s==='DELIVERED_AND_PAID'||s.startsWith('CANCELLED');
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-nav]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  ['orders','products','wallet'].forEach(p=>$('page-'+p).classList.toggle('hidden',p!==b.dataset.nav));
});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  tab=b.dataset.tab; renderOrders();
});
$('soundBtn').onclick=()=>{soundOn=!soundOn;$('soundBtn').textContent=soundOn?'🔔 Sound: ON':'🔕 Sound: OFF';};
$('loginBtn').onclick=async()=>{
  $('loginErr').textContent='';$('loginBtn').disabled=true;
  try{ await auth.signInWithEmailAndPassword($('email').value.trim(),$('password').value); }
  catch(e){ $('loginErr').textContent=e.message; $('loginBtn').disabled=false; }
};
$('logoutBtn').onclick=()=>auth.signOut().then(()=>location.reload());
auth.onAuthStateChanged(async user=>{
  if(!user){$('view-login').classList.remove('hidden');$('view-app').classList.add('hidden');return;}
  let snap=await fs.collection('vendors').where('email','==',user.email).get();
  if(!snap.empty){vendorDocId=snap.docs[0].id;vendorData=snap.docs[0].data();}
  else{const d=await fs.collection('vendors').doc(user.uid).get(); if(!d.exists){$('loginErr').textContent='No vendor profile for '+user.email;await auth.signOut();return;} vendorDocId=d.id;vendorData=d.data();}
  $('view-login').classList.add('hidden');$('view-app').classList.remove('hidden');
  $('shopPill').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');
  $('shopPill').textContent='🏪 '+(vendorData.shop_name||'My Shop');
  startStore(); startOrders(); startProducts(); startWallet(); startFCM();
});
function startStore(){
  const sw=$('storeSwitch'),lb=$('storeLabel');
  const paint=open=>{sw.classList.toggle('on',open);lb.textContent=open?'Store Open (Accepting Orders)':'Store Closed (Unreachable)';};
  fs.collection('vendors').doc(vendorDocId).onSnapshot(d=>{if(d.exists)paint(d.data().is_open!==false);});
  sw.onclick=async()=>{const open=!sw.classList.contains('on');paint(open);
    try{await fs.collection('vendors').doc(vendorDocId).update({is_open:open});toast(open?'Store OPEN 🟢':'Store CLOSED 🔴');}
    catch(e){paint(!open);toast('Failed: '+e.message);}};
}
function startOrders(){
  const q=rtdb.ref('orders').orderByChild('vendorId').equalTo(vendorDocId);
  const seen=new Set();
  q.on('value',snap=>{
    allOrders=[];snap.forEach(c=>allOrders.push({key:c.key,...c.val()}));allOrders.reverse();
    allOrders.forEach(o=>{const s=normStatus(o);
      if(s==='PENDING'&&!seen.has('n'+o.key)){ if(soundOn&&seen.size){$('ding').play().catch(()=>{}); toast('🧾 New order #'+String(o.key).slice(-5).toUpperCase());} }
      seen.add('n'+o.key);});
    renderOrders(); renderBadges();
  });
}
function renderBadges(){
  const c={PENDING:0,PREPARING:0,READY:0,HISTORY:0};
  allOrders.forEach(o=>{const s=normStatus(o); if(s==='PENDING')c.PENDING++; else if(s==='PREPARING')c.PREPARING++; else if(inReady(s))c.READY++; else if(inHist(s))c.HISTORY++;});
  $('b0').textContent=c.PENDING?`(${c.PENDING})`:'';$('b1').textContent=c.PREPARING?`(${c.PREPARING})`:'';
  $('b2').textContent=c.READY?`(${c.READY})`:'';$('b3').textContent=c.HISTORY?`(${c.HISTORY})`:'';
  $('cntNew').textContent=c.PENDING?`· ${c.PENDING} new`:'';
}
function renderOrders(){
  const box=$('orders');box.innerHTML='';
  const list=allOrders.filter(o=>{const s=normStatus(o);
    if(tab==='HISTORY')return inHist(s); if(tab==='READY')return inReady(s); return s===tab;});
  if(!list.length){box.innerHTML='<div class="card">No orders here. New orders beep + pop here automatically.</div>';return;}
  list.forEach(o=>{
    const s=normStatus(o);const items=(o.items||o.cart||[]);
    const itemHtml=Array.isArray(items)?items.map(i=>`• ${esc(i.name||i.title||'Item')} × ${i.qty||i.quantity||1} — KES ${i.price||i.amount||''}`).join('<br/>'):esc(JSON.stringify(items));
    const cls=s==='PENDING'?'b-pending':s==='PREPARING'?'b-prep':inReady(s)?'b-ready':'b-hist';
    const el=document.createElement('div');el.className='order';
    el.innerHTML=`<span class="badge ${cls}">${esc(s)}</span>
      <h3>#${esc(String(o.key).slice(-5).toUpperCase())} · ${fmt(o.total||o.grandTotal||o.amount)}</h3>
      <div class="meta">${esc(o.customerName||o.customer||'Customer')} · ${esc(o.customerPhone||o.phone||'')} · ${esc(new Date(o.createdAt||o.timestamp||Date.now()).toLocaleString())}</div>
      <div class="items">${itemHtml||'—'}</div>
      <div class="meta">${esc(o.deliveryAddress||o.address||'')}</div><div class="rowbtns"></div>`;
    const rb=el.querySelector('.rowbtns');
    const mk=(label,cls2,fn)=>{const b=document.createElement('button');b.className='btn '+cls2;b.textContent=label;b.onclick=()=>fn(o);rb.appendChild(b);};
    if(s==='PENDING'){mk('✅ Accept','peach',o1=>setStatus(o1,'PREPARING'));mk('❌ Reject','ghost',o1=>setStatus(o1,'CANCELLED_BY_VENDOR'));}
    if(s==='PREPARING'){mk('🍳 Mark Ready','peach',o1=>setStatus(o1,'READY'));}
    if(inReady(s)){const m=document.createElement('span');m.className='sub';m.textContent='Rider matching in progress…';rb.appendChild(m);}
    box.appendChild(el);
  });
}
async function setStatus(o,st){
  try{await rtdb.ref('orders/'+o.key).update({orderStatus:st,updatedAt:Date.now()});toast('Order → '+st);}
  catch(e){toast('Failed: '+e.message);}
}
function startProducts(){
  fs.collection('vendors').doc(vendorDocId).collection('products').onSnapshot(snap=>{
    const box=$('prods');box.innerHTML='';
    if(snap.empty){box.innerHTML='<div class="card">No products yet. Tap + Add Product.</div>';return;}
    snap.forEach(d=>{const p=d.data();
      const el=document.createElement('div');el.className='prod';
      el.innerHTML=`<img src="${esc(p.imageUrl||(p.imageUrls||[])[0]||'')}" onerror="this.style.display='none'"/>
        <div style="flex:1"><b>${esc(p.name)}</b><br/><span class="sub">${esc(p.category||'')} · KES ${p.price} · ${p.inStock===false?'Out of stock':'In stock'}</span></div>`;
      const b=document.createElement('button');b.className='btn ghost';b.textContent='Edit';b.onclick=()=>openProd(d.id,p);el.appendChild(b);box.appendChild(el);});
  });
  $('addProd').onclick=()=>openProd(null,null);
}
function openProd(id,p){
  editingId=id||null;$('pdTitle').textContent=id?'Edit Product':'Add Product';
  $('pdName').value=p?.name||'';$('pdPrice').value=p?.price||'';$('pdCat').value=p?.category||'';
  $('pdStock').checked=p?.inStock!==false;$('pdDel').classList.toggle('hidden',!id);
  $('pdMsg').textContent='';$('prodDlg').showModal();
}
$('pdClose').onclick=()=>$('prodDlg').close();
$('pdDel').onclick=async()=>{if(!editingId)return;if(!confirm('Delete this product?'))return;
  await fs.collection('vendors').doc(vendorDocId).collection('products').doc(editingId).delete();$('prodDlg').close();toast('Deleted');};
$('pdSave').onclick=async()=>{
  const name=$('pdName').value.trim(),price=parseFloat($('pdPrice').value),cat=$('pdCat').value.trim();
  if(!name||!(price>0)){$('pdMsg').textContent='Name + valid price required';return;}
  if(!cat){$('pdMsg').textContent='Category required';return;}
  $('pdMsg').textContent='Saving…';$('pdSave').disabled=true;
  try{
    let imageUrl=null;const f=$('pdFile').files[0];
    if(f){imageUrl=await uploadImage(f);}
    const ref=editingId?fs.collection('vendors').doc(vendorDocId).collection('products').doc(editingId)
      :fs.collection('vendors').doc(vendorDocId).collection('products').doc();
    const payload={productId:ref.id,vendorId:vendorDocId,name,price,category:cat,inStock:$('pdStock').checked};
    if(imageUrl){payload.imageUrl=imageUrl;payload.imageUrls=[imageUrl];}
    await ref.set(payload,{merge:true});
    $('prodDlg').close();toast('Menu saved ✓');
  }catch(e){$('pdMsg').textContent='Failed: '+e.message;}
  $('pdSave').disabled=false;
};
async function uploadImage(file){
  const fd=new FormData();fd.append('product_image',file,file.name);
  try{const r=await fetch(EP.localUpload||'/api/media/upload',{method:'POST',body:fd});const j=await r.json();if(j.imageUrl)return j.imageUrl;}catch(e){}
  const base=(EP.binariesBase||'').replace(/\/$/,'');
  for(const p of ['/api/media/upload','/upload','/api/upload']){
    try{const r=await fetch(base+p,{method:'POST',body:fd});const j=await r.json();if(j.imageUrl)return j.imageUrl;}catch(e){}
  }
  throw new Error('Image upload failed on all endpoints');
}
function startWallet(){
  fs.collection('vendors').doc(vendorDocId).onSnapshot(d=>{
    if(d.exists)$('wBal').textContent=fmt(d.data().wallet_balance||0);
  });
  fs.collection('vendors').doc(vendorDocId).collection('wallet_ledger').orderBy('timestamp','desc').onSnapshot(snap=>{
    let pend=0;const box=$('ledger');box.innerHTML='';
    snap.forEach(doc=>{const t=doc.data();if(t.hiddenByVendor)return;
      const amt=t.grossAmount??t.amount??0;
      if(t.type==='ESCROW_INBOUND'&&String(t.status||'').toUpperCase()==='PENDING')pend+=Number(amt)||0;
      const sub=t.type==='WALLET_WITHDRAWAL_OUTBOUND'?'Destination: '+(t.destination||'Registered Channel')
        :t.type==='ESCROW_INBOUND'?'Order Ref: #'+String(t.orderId||'FOOD').slice(-5).toUpperCase()
        :'Earned from Order #'+String(t.orderId||'FOOD').slice(-5).toUpperCase();
      const d=document.createElement('div');d.className='lrow';
      d.innerHTML=`<div><b>${esc(t.type)}</b> <span class="badge ${String(t.status).toUpperCase()==='PENDING'?'b-pending':'b-hist'}">${esc(t.status||'')}</span><br/><span class="sub">${esc(sub)}</span></div><div><b>KES ${Number(amt).toFixed(2)}</b></div>`;
      box.appendChild(d);});
    $('wPend').textContent=fmt(pend);
    if(!box.children.length)box.innerHTML='<p class="sub">No transactions yet.</p>';
  });
}
async function startFCM(){
  try{
    if(!('Notification' in window)||!firebase.messaging.isSupported())return;
    const msg=firebase.messaging();
    const perm=await Notification.requestPermission();if(perm!=='granted')return;
    if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./firebase-messaging-sw.js');}catch(e){}}
    if(!VAPID||String(VAPID).includes('PASTE')){console.warn('VAPID missing — push disabled, orders still live');return;}
    const token=await msg.getToken({vapidKey:VAPID});
    if(token&&token!==fcmToken){fcmToken=token;await fs.collection('vendors').doc(vendorDocId).update({webFcmToken:token,fcmToken:token});}
    msg.onMessage(()=>{if(soundOn)$('ding').play().catch(()=>{});toast('🔔 Update — check Live Orders');});
  }catch(e){console.warn('FCM web skipped:',e.message);}
}
})();