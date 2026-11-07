/* dolce ride vendor web — cleaned, mirrors APK
   LiveOrdersFragment + VendorOrderAdapter + ChatBottomSheet + ProductManagementFragment */
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
function toast(m){var t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none';},3400);}
var cfg=window.DOLCE_FIREBASE_CONFIG, VAPID=window.DOLCE_VAPID_KEY, EP=window.DOLCE_ENDPOINTS||{};
if(!cfg||!cfg.apiKey||String(cfg.apiKey).indexOf('PASTE')!==-1){$('loginErr').textContent='Missing Firebase config — fill firebase-config.js';return;}
firebase.initializeApp(cfg);
var auth=firebase.auth(), fs=firebase.firestore(), rtdb=firebase.database();
var TS=firebase.database.ServerValue.TIMESTAMP;
var BIN_BASE=String(EP.binariesBase||'https://bodaa-app-binaries-svaw.onrender.com').replace(/\/$/,'');

var myUid='', vendorDocId='', vendorData=null, allOrders=[], tab='PENDING', soundOn=true, fcmToken='';
var editingId=null, editingOld={imageUrl:'',imageUrls:[]};
var chatChannel='', chatCounterpart='', chatTitle='', chatRef=null, chatLoaded=false, chatSawOther=false;

/* ---------- helpers (mirror APK snapText/snapDouble) ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function fmt(n){return 'KES '+(Number(n)||0).toFixed(2);}
function txt(o){for(var i=1;i<arguments.length;i++){var k=arguments[i];var v=o?o[k]:'';if(typeof v==='string'&&v.trim())return v.trim();}return '';}
function num(o){for(var i=1;i<arguments.length;i++){var k=arguments[i];var v=o?o[k]:undefined;if(typeof v==='number')return v;if(typeof v==='string'&&v.trim()!==''){var n=parseFloat(v);if(!isNaN(n))return n;}}return 0;}
function normStatus(o){return String(o.orderStatus||o.status||'PENDING').toUpperCase().trim();}
function inReady(s){return s==='READY'||s==='READY_MATCHING'||s==='MATCHING_RIDER'||s==='RIDER_NOT_FOUND'||s==='DRIVER_ASSIGNED'||s==='ARRIVED_AT_STORE';}
function inHist(s){return s==='PICKED_UP'||s==='PICKEDUP'||s==='EN_ROUTE'||s==='DELIVERED'||s==='DELIVERED_AND_PAID'||s.indexOf('CANCELLED')===0;}
function orderLabel(o,key){return String(o.orderId||key).slice(-6).toUpperCase();}
function orderTime(o){var v=o.createdAt||o.timestamp||o.last_updated||o.updatedAt||Date.now();var n=Number(v);if(!isNaN(n)&&n>0)return new Date(n>1e12?n:n*1).toLocaleString();var d=new Date(v);return isNaN(d)?new Date().toLocaleString():d.toLocaleString();}
function beep(){if(!soundOn)return;try{var a=$('ding');a.currentTime=0;a.play().catch(function(){});}catch(e){}}

/* ---------- nav ---------- */
document.querySelectorAll('[data-nav]').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('[data-nav]').forEach(function(x){x.classList.remove('active');});b.classList.add('active');
  ['orders','chats','products','wallet'].forEach(function(p){$('page-'+p).classList.toggle('hidden',p!==b.dataset.nav);});
};});
document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('[data-tab]').forEach(function(x){x.classList.remove('active');});b.classList.add('active');
  tab=b.dataset.tab;renderOrders();
};});
$('soundBtn').onclick=function(){soundOn=!soundOn;$('soundBtn').textContent=soundOn?'🔔 Sound: ON':'🔕 Sound: OFF';};
$('loginBtn').onclick=function(){
  $('loginErr').textContent='';$('loginBtn').disabled=true;
  auth.signInWithEmailAndPassword($('email').value.trim(),$('password').value).catch(function(e){$('loginErr').textContent=e.message;$('loginBtn').disabled=false;});
};
$('logoutBtn').onclick=function(){auth.signOut().then(function(){location.reload();});};

auth.onAuthStateChanged(function(user){
  if(!user){$('view-login').classList.remove('hidden');$('view-app').classList.add('hidden');$('loginBtn').disabled=false;return;}
  myUid=user.uid;
  fs.collection('vendors').where('email','==',user.email||'').get().then(function(snap){
    if(!snap.empty){vendorDocId=snap.docs[0].id;vendorData=snap.docs[0].data();}
    return snap.empty?fs.collection('vendors').doc(user.uid).get().then(function(d){
      if(!d.exists){$('loginErr').textContent='No vendor profile for '+user.email;auth.signOut();return null;}
      vendorDocId=d.id;vendorData=d.data();return true;
    }):true;
  }).then(function(ok){
    if(!ok&&!vendorDocId)return;
    $('view-login').classList.add('hidden');$('view-app').classList.remove('hidden');
    $('shopPill').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');
    $('shopPill').textContent='🏪 '+(vendorData.shop_name||vendorData.name||'My Shop');
    startStore();startOrders();startProducts();startWallet();startInbox();startFCM();
  }).catch(function(e){$('loginErr').textContent=e.message;$('loginBtn').disabled=false;});
});

/* ---------- store toggle (mirrors APK) ---------- */
function startStore(){
  var sw=$('storeSwitch'),lb=$('storeLabel');
  function paint(open){sw.classList.toggle('on',!!open);lb.textContent=open?'Store Open (Accepting Orders)':'Store Closed (Unreachable)';}
  fs.collection('vendors').doc(vendorDocId).onSnapshot(function(d){if(d.exists)paint(d.data().is_open!==false);});
  sw.onclick=function(){var open=!sw.classList.contains('on');paint(open);
    fs.collection('vendors').doc(vendorDocId).update({is_open:open})
      .then(function(){toast(open?'Store OPEN 🟢':'Store CLOSED 🔴');})
      .catch(function(e){paint(!open);toast('Failed: '+e.message);});};
}

/* ---------- orders (mirrors LiveOrdersFragment + VendorOrderAdapter) ---------- */
var seenOrderKeys={};
function startOrders(){
  rtdb.ref('orders').orderByChild('vendorId').equalTo(vendorDocId).on('value',function(snap){
    allOrders=[];snap.forEach(function(c){allOrders.push(Object.assign({key:c.key},c.val()));});
    allOrders.reverse();
    var firstLoad=Object.keys(seenOrderKeys).length===0;
    allOrders.forEach(function(o){
      if(normStatus(o)==='PENDING'&&!seenOrderKeys['n'+o.key]&&!firstLoad){beep();toast('🧾 New order #'+orderLabel(o,o.key));}
      seenOrderKeys['n'+o.key]=1;
    });
    renderOrders();renderBadges();
  });
}
function renderBadges(){
  var c={PENDING:0,PREPARING:0,READY:0,HISTORY:0};
  allOrders.forEach(function(o){var s=normStatus(o);
    if(s==='PENDING')c.PENDING++;else if(s==='PREPARING')c.PREPARING++;else if(inReady(s))c.READY++;else if(inHist(s))c.HISTORY++;});
  $('b0').textContent=c.PENDING?('('+c.PENDING+')'):'';$('b1').textContent=c.PREPARING?('('+c.PREPARING+')'):'';
  $('b2').textContent=c.READY?('('+c.READY+')'):'';$('b3').textContent=c.HISTORY?('('+c.HISTORY+')'):'';
  $('cntNew').textContent=c.PENDING?('· '+c.PENDING+' new'):'';
}
function nextStateFor(s){
  if(s==='PENDING')return 'PREPARING';
  if(s==='PREPARING')return 'READY_MATCHING'; // triggers wallet credit + ride creation (APK comment)
  if(s==='DRIVER_ASSIGNED'||s==='ARRIVED_AT_STORE')return 'PICKED_UP';
  return null;
}
function renderOrders(){
  var box=$('orders');box.innerHTML='';
  var list=allOrders.filter(function(o){var s=normStatus(o);
    if(tab==='HISTORY')return inHist(s);if(tab==='READY')return inReady(s);return s===tab;});
  if(!list.length){box.innerHTML='<div class="card">No orders here. New orders beep + pop here automatically.</div>';return;}
  list.forEach(function(o){
    var s=normStatus(o);
    var gross=num(o,'gross_product_total','grossProductTotal','total','grandTotal','amount');
    var nete=num(o,'vendor_net_earnings','vendorNetEarnings');
    var preview=o.preview_pricing===true;
    var cName=txt(o,'passenger_name','recipientName','customerName','customer')||'Customer';
    var cId=txt(o,'customerId','userId','passengerId','customer_id');
    var cPhone=txt(o,'customerPhone','phone','recipientPhone','passengerPhone','customer_phone','deliveryPhone');
    var dId=txt(o,'driverId','driver_id','assigned_driver_id');
    var dPhone=txt(o,'driverPhone','driver_phone');
    var dName=txt(o,'driverName','driver_name')||'Boda Rider';
    var items=o.items||o.cart||[];
    var itemHtml='';
    if(Array.isArray(items)){itemHtml=items.map(function(i){var nm=i.name||i.title||'Item';var q=i.qty||i.currentQty||i.quantity||1;return '• '+esc(nm)+' × '+esc(q);}).join('<br/>');}
    else if(items)itemHtml=esc(JSON.stringify(items));
    var cls=s==='PENDING'?'b-pending':s==='PREPARING'?'b-prep':inReady(s)?'b-ready':'b-hist';
    var el=document.createElement('div');el.className='order';
    var money=preview?('Food Value: '+fmt(gross)+'<br/><span class="sub">Est. Take Home: '+fmt(nete)+'</span>'):('Food Value: '+fmt(gross)+'<br/><span class="sub">Take Home: '+fmt(nete)+'</span>');
    el.innerHTML='<span class="badge '+cls+'">'+esc(s)+'</span>'
      +'<h3>#'+esc(orderLabel(o,o.key))+' · '+fmt(gross)+'</h3>'
      +'<div class="meta">'+esc(cName)+(cPhone?' · '+esc(cPhone):'')+' · '+esc(orderTime(o))+'</div>'
      +'<div class="items" style="margin-top:8px">'+money+'</div>'
      +'<div class="items">'+(itemHtml||'—')+'</div>'
      +'<div class="meta">'+esc(txt(o,'deliveryAddress','address')||'')+'</div>'
      +(dId?'<div class="meta">🛵 Rider: '+esc(dName)+(dPhone?' · '+esc(dPhone):'')+'</div>':'')
      +'<div class="rowbtns"></div>';
    var rb=el.querySelector('.rowbtns');
    function mk(label,cls2,fn){var b=document.createElement('button');b.className='btn '+cls2;b.textContent=label;b.onclick=function(){fn(o);};rb.appendChild(b);return b;}
    function mkCall(label,phone){if(!phone)return;var a=document.createElement('a');a.className='btn ghost callbtn';a.textContent=label;a.href='tel:'+phone;rb.appendChild(a);}
    // action button mirrors APK exactly
    if(s==='PENDING'){mk('✅ Accept','peach',function(x){setStatus(x,'PREPARING');});mk('❌ Reject','ghost',function(x){if(confirm('Reject this order?'))setStatus(x,'CANCELLED_BY_VENDOR');});}
    else if(s==='PREPARING'){mk('🍳 Mark Ready','peach',function(x){setStatus(x,'READY_MATCHING');});}
    else if(s==='READY_MATCHING'||s==='MATCHING_RIDER'||s==='RIDER_NOT_FOUND'||s==='READY'){
      var m=document.createElement('button');m.className='btn ghost';m.disabled=true;m.textContent='SEARCHING FOR RIDER… ⏳';rb.appendChild(m);}
    else if(s==='DRIVER_ASSIGNED'||s==='ARRIVED_AT_STORE'){mk('🛵 Handover to Rider','peach',function(x){setStatus(x,'PICKED_UP');});}
    // chat works in EVERY status (requirement #2)
    mk('💬 Chat','ghost',function(x){openChat(x.key,'Chat regarding Order #'+orderLabel(x,x.key),txt(x,'customerId','userId','passengerId','customer_id'));});
    mkCall('📞 Customer',cPhone);
    if(dPhone)mkCall('📞 Rider',dPhone);
    box.appendChild(el);
  });
}
function setStatus(o,st){
  var target=o.key;
  var updates={orderStatus:st,status:String(st).toLowerCase(),last_updated:TS,updatedAt:Date.now()};
  if(st==='READY_MATCHING')toast('Food ready! Earnings credited to your wallet 💰');
  else if(st==='PICKED_UP')toast('Handed over to rider. Out for delivery 🛵');
  rtdb.ref('orders/'+target).update(updates).then(function(){toast('Order → '+st);}).catch(function(e){toast('Failed: '+e.message);});
}

/* ---------- chat (mirrors ChatBottomSheet.kt) ---------- */
function inboxPayload(text){
  return {channelId:chatChannel,headerTitle:chatTitle,lastMessage:text,timestamp:Date.now(),sessionType:'FOOD_ORDER',associatedId:chatChannel,isActive:true};
}
function openChat(channelId,title,counterpartId){
  chatChannel=channelId;chatTitle=title||('Order #'+String(channelId).slice(-6).toUpperCase());chatCounterpart=counterpartId||'';
  chatLoaded=false;chatSawOther=false;
  $('chatTitle').textContent=chatTitle;$('chatStatus').textContent='';$('chatMsgs').innerHTML='';
  $('chatSheet').classList.remove('hidden');
  if(chatRef)chatRef.off();
  // resolve counterpart from order if missing (inbox reopen case)
  var needResolve=!chatCounterpart;
  var ord=allOrders.find(function(x){return x.key===channelId;});
  if(ord&&!chatCounterpart)chatCounterpart=txt(ord,'customerId','userId','passengerId','customer_id');
  if(needResolve&&!chatCounterpart){
    rtdb.ref('orders/'+channelId).once('value').then(function(s){var v=s.val()||{};chatCounterpart=txt(v,'customerId','userId','passengerId','customer_id');attachChatListener();});
  } else attachChatListener();
}
function attachChatListener(){
  chatRef=rtdb.ref('chats').child(chatChannel);
  chatRef.on('value',function(snap){
    var msgs=[];snap.forEach(function(c){var m=c.val();m.messageId=m.messageId||c.key;msgs.push(m);});
    msgs.sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0);});
    renderChat(msgs);
    // mark seen (mirror APK)
    var upd={};
    msgs.forEach(function(m){if(m.senderId!==myUid&&m.status!=='seen'&&!m.isDeleted)upd['/chats/'+chatChannel+'/'+m.messageId+'/status']='seen';});
    if(Object.keys(upd).length)rtdb.ref().update(upd);
    // notify on new incoming
    if(!chatLoaded){chatLoaded=true;}
    else{
      var last=msgs[msgs.length-1];
      if(last&&last.senderId!==myUid&&!chatSawOther){chatSawOther=true;beep();toast('💬 '+chatTitle+': '+(last.imageUrl?'sent a photo':String(last.text||'').slice(0,80)));}
      else if(last&&last.senderId!==myUid){beep();}
    }
    renderInboxBadge();
  });
}
function renderChat(msgs){
  var box=$('chatMsgs');box.innerHTML='';
  if(!msgs.length)box.innerHTML='<p class="sub">No messages yet — say hi to the student. Chat works in every order status.</p>';
  msgs.forEach(function(m){
    var d=document.createElement('div');d.className='bubble '+(m.senderId===myUid?'me':'them');
    if(m.isDeleted){d.textContent='This message was deleted';}
    else{
      var t=document.createElement('div');t.textContent=m.text||'';d.appendChild(t);
      if(m.imageUrl){var im=document.createElement('img');im.src=m.imageUrl;im.loading='lazy';im.onclick=function(){window.open(m.imageUrl,'_blank');};d.appendChild(im);}
      var tick=document.createElement('span');tick.className='tick';tick.textContent=new Date(m.timestamp||Date.now()).toLocaleString()+(m.senderId===myUid?' · '+esc(m.status||'sent'):'');d.appendChild(tick);
    }
    box.appendChild(d);
  });
  box.scrollTop=box.scrollHeight;
}
$('chatClose').onclick=function(){$('chatSheet').classList.add('hidden');if(chatRef)chatRef.off();chatChannel='';};
document.querySelectorAll('[data-quick]').forEach(function(b){b.onclick=function(){sendChatText(b.dataset.quick);};});
$('chatSend').onclick=function(){var v=$('chatText').value.trim();if(v)sendChatText(v);};
$('chatText').addEventListener('keydown',function(e){if(e.key==='Enter'){var v=$('chatText').value.trim();if(v)sendChatText(v);}});
$('chatAttach').onclick=function(){$('chatFile').click();};
$('chatFile').onchange=function(){var f=$('chatFile').files[0];if(f)sendChatImage(f);$('chatFile').value='';};
function sendChatText(text){
  if(!chatChannel)return;
  var key=chatRef.push().key;
  var msg={messageId:key,senderId:myUid,text:text,imageUrl:null,messageType:'TEXT',timestamp:Date.now(),status:'sent',isDeleted:false};
  var upd={};upd['/chats/'+chatChannel+'/'+key]=msg;var ib=inboxPayload(text);upd['/user_inboxes/'+myUid+'/'+chatChannel]=ib;
  if(chatCounterpart)upd['/user_inboxes/'+chatCounterpart+'/'+chatChannel]=ib;
  $('chatStatus').textContent='Sending…';
  rtdb.ref().update(upd).then(function(){$('chatText').value='';$('chatStatus').textContent='';}).catch(function(e){$('chatStatus').textContent='Failed: '+e.message;});
}
function sendChatImage(file){
  if(!chatChannel)return;
  $('chatStatus').textContent='Sending photo…';
  resizeToJpeg(file,1080,0.8).then(function(blob){
    return uploadToBinaries(blob,file.name||'chat.jpg');
  }).then(function(url){sendImageMsg(url);}).catch(function(e){$('chatStatus').textContent='Photo failed: '+e.message;});
}
function sendImageMsg(url){
  var key=chatRef.push().key;
  var msg={messageId:key,senderId:myUid,text:'🖼️ Image Attachment',imageUrl:url,messageType:'IMAGE',timestamp:Date.now(),status:'sent',isDeleted:false};
  var upd={};upd['/chats/'+chatChannel+'/'+key]=msg;var ib=inboxPayload('🖼️ Image Attachment');upd['/user_inboxes/'+myUid+'/'+chatChannel]=ib;
  if(chatCounterpart)upd['/user_inboxes/'+chatCounterpart+'/'+chatChannel]=ib;
  rtdb.ref().update(upd).then(function(){$('chatStatus').textContent='';}).catch(function(e){$('chatStatus').textContent='Failed: '+e.message;});
}

/* ---------- inbox (mirrors ChatInboxActivity.kt) ---------- */
var inboxCache=[];
function startInbox(){
  rtdb.ref('user_inboxes').child(myUid).on('value',function(snap){
    inboxCache=[];snap.forEach(function(c){var v=c.val();v.channelId=v.channelId||c.key;inboxCache.push(v);});
    inboxCache.sort(function(a,b){return (b.timestamp||0)-(a.timestamp||0);});
    renderInbox();renderInboxBadge();
  });
}
function renderInbox(){
  var box=$('inbox');if(!box)return;box.innerHTML='';
  if(!inboxCache.length){box.innerHTML='<div class="card">No chats yet. Open any order and tap 💬 Chat.</div>';return;}
  inboxCache.forEach(function(s){
    var el=document.createElement('div');el.className='inboxrow';
    el.innerHTML='<div class="dot">💬</div><div style="flex:1"><b>'+esc(s.headerTitle||s.channelId)+'</b><br/><span class="sub">'+esc(s.lastMessage||'')+' · '+esc(new Date(s.timestamp||Date.now()).toLocaleString())+'</span></div>';
    el.onclick=function(){openChat(s.channelId,s.headerTitle||('Order #'+String(s.channelId).slice(-6).toUpperCase()),'');};
    box.appendChild(el);
  });
}
function renderInboxBadge(){
  var n=inboxCache.length;$('cntChat').textContent=n?('· '+n):'';
}

/* ---------- products (unified pipeline with APK) ---------- */
function startProducts(){
  fs.collection('vendors').doc(vendorDocId).collection('products').onSnapshot(function(snap){
    var box=$('prods');box.innerHTML='';
    if(snap.empty){box.innerHTML='<div class="card">No products yet. Tap + Add Product.</div>';return;}
    snap.forEach(function(d){var p=d.data();
      var img=(p.imageUrls&&p.imageUrls[0])||p.imageUrl||'';
      var el=document.createElement('div');el.className='prod';
      el.innerHTML='<img src="'+esc(img)+'" onerror="this.style.display=\'none\'"/>'
        +'<div style="flex:1"><b>'+esc(p.name)+'</b><br/><span class="sub">'+esc(p.category||'')+' · KES '+esc(p.price)+' · '+(p.inStock===false?'Out of stock':'In stock')+'</span></div>';
      var b=document.createElement('button');b.className='btn ghost';b.textContent='Edit';b.onclick=function(){openProd(d.id,p);};el.appendChild(b);box.appendChild(el);});
  });
  $('addProd').onclick=function(){openProd(null,null);};
}
function openProd(id,p){
  editingId=id||null;editingOld={imageUrl:(p&&p.imageUrl)||'',imageUrls:(p&&p.imageUrls)||[]};
  $('pdTitle').textContent=id?'Edit Product':'Add Product';
  $('pdName').value=(p&&p.name)||'';$('pdPrice').value=(p&&p.price!=null)?p.price:'';$('pdCat').value=(p&&p.category)||'';
  $('pdStock').checked=!p||p.inStock!==false;
  var prev=$('pdPreview');var src=(editingOld.imageUrls[0])||editingOld.imageUrl||'';
  if(src){prev.src=src;prev.classList.remove('hidden');}else{prev.removeAttribute('src');prev.classList.add('hidden');}
  $('pdFile').value='';
  $('pdDel').classList.toggle('hidden',!id);
  $('pdMsg').textContent='';$('prodDlg').showModal();
}
$('pdClose').onclick=function(){$('prodDlg').close();};
$('pdFile').onchange=function(){var f=$('pdFile').files[0];if(!f)return;var url=URL.createObjectURL(f);var prev=$('pdPreview');prev.src=url;prev.classList.remove('hidden');};
$('pdDel').onclick=function(){if(!editingId)return;if(!confirm('Delete this product?'))return;
  fs.collection('vendors').doc(vendorDocId).collection('products').doc(editingId).delete().then(function(){$('prodDlg').close();toast('Deleted');});};
$('pdSave').onclick=function(){
  var name=$('pdName').value.trim(),price=parseFloat($('pdPrice').value),cat=$('pdCat').value.trim();
  if(!name||!(price>0)){$('pdMsg').textContent='Name + valid price required';return;}
  if(!cat){$('pdMsg').textContent='Category required';return;}
  $('pdMsg').textContent='Saving…';$('pdSave').disabled=true;
  var f=$('pdFile').files[0];
  function finish(imageUrl){
    var ref=editingId?fs.collection('vendors').doc(vendorDocId).collection('products').doc(editingId)
      :fs.collection('vendors').doc(vendorDocId).collection('products').doc();
    var payload={productId:ref.id,vendorId:vendorDocId,name:name,price:price,category:cat,inStock:$('pdStock').checked};
    if(imageUrl){payload.imageUrl=imageUrl;payload.imageUrls=[imageUrl];} // always both — fixes APK missing image
    ref.set(payload,{merge:true}).then(function(){$('prodDlg').close();toast('Menu saved ✓');$('pdSave').disabled=false;})
      .catch(function(e){$('pdMsg').textContent='Failed: '+e.message;$('pdSave').disabled=false;});
  }
  if(f){resizeToJpeg(f,1080,0.8).then(function(blob){return uploadToBinaries(blob,f.name);}).then(finish).catch(function(e){$('pdMsg').textContent='Image upload failed: '+e.message;$('pdSave').disabled=false;});}
  else finish(editingId?null:(editingOld.imageUrls[0]||editingOld.imageUrl||null));
};
/* image pipeline shared by products + chat — same as APK: 1080px JPEG80, key product_image */
function resizeToJpeg(file,maxDim,quality){
  return new Promise(function(res,rej){
    var img=new Image();var url=URL.createObjectURL(file);
    img.onload=function(){
      try{
        var w=img.width,h=img.height;var scale=Math.min(1,maxDim/Math.max(w,h));
        var cw=Math.round(w*scale),ch=Math.round(h*scale);
        var c=document.createElement('canvas');c.width=cw;c.height=ch;
        c.getContext('2d').drawImage(img,0,0,cw,ch);
        URL.revokeObjectURL(url);
        c.toBlob(function(b){b?res(b):rej(new Error('resize failed'));},'image/jpeg',quality);
      }catch(e){rej(e);}
    };
    img.onerror=function(){URL.revokeObjectURL(url);rej(new Error('bad image'));};
    img.src=url;
  });
}
function normalizeUrl(u){
  u=String(u||'').trim();if(!u)return '';
  if(u.indexOf('data:')===0||u.indexOf('blob:')===0)return u;
  if(u.indexOf('http://')===0||u.indexOf('https://')===0)return u;
  if(u.charAt(0)==='/')return BIN_BASE+u;
  return BIN_BASE+'/'+u;
}
function uploadToBinaries(blob,filename){
  var fd=new FormData();fd.append('product_image',blob,filename||'photo.jpg');
  return fetch(BIN_BASE+'/api/media/upload',{method:'POST',body:fd}).then(function(r){
    if(!r.ok)throw new Error('upload HTTP '+r.status);return r.json();
  }).then(function(j){
    if(!j||(j.success===false))throw new Error((j&&j.message)||'upload rejected');
    var url=normalizeUrl(j.imageUrl||j.url||j.fileUrl||j.path||'');
    if(!url||url.indexOf('data:')===0||url.indexOf('blob:')===0)throw new Error('server returned no usable URL');
    if(url.charAt(0)==='/'||url.indexOf('http')!==0)throw new Error('server returned relative URL: '+url);
    return url;
  });
}

/* ---------- wallet (view only) ---------- */
function startWallet(){
  fs.collection('vendors').doc(vendorDocId).onSnapshot(function(d){if(d.exists)$('wBal').textContent=fmt(d.data().wallet_balance||0);});
  fs.collection('vendors').doc(vendorDocId).collection('wallet_ledger').orderBy('timestamp','desc').onSnapshot(function(snap){
    var pend=0;var box=$('ledger');box.innerHTML='';
    snap.forEach(function(doc){var t=doc.data();if(t.hiddenByVendor)return;
      var amt=num(t,'grossAmount','amount','netAmount');
      if(t.type==='ESCROW_INBOUND'&&String(t.status||'').toUpperCase()==='PENDING')pend+=Number(amt)||0;
      var sub=t.type==='WALLET_WITHDRAWAL_OUTBOUND'?'Destination: '+(t.destination||'Registered Channel')
        :t.type==='ESCROW_INBOUND'?'Order Ref: #'+String(t.orderId||'FOOD').slice(-5).toUpperCase()
        :'Earned from Order #'+String(t.orderId||'FOOD').slice(-5).toUpperCase();
      var d=document.createElement('div');d.className='lrow';
      d.innerHTML='<div><b>'+esc(t.type)+'</b> <span class="badge '+(String(t.status||'').toUpperCase()==='PENDING'?'b-pending':'b-hist')+'">'+esc(t.status||'')+'</span><br/><span class="sub">'+esc(sub)+'</span></div><div><b>KES '+Number(amt).toFixed(2)+'</b></div>';
      box.appendChild(d);});
    $('wPend').textContent=fmt(pend);
    if(!box.children.length)box.innerHTML='<p class="sub">No transactions yet.</p>';
  },function(){ $('ledger').innerHTML='<p class="sub">Ledger unavailable (missing index/permissions).</p>'; });
}

/* ---------- FCM (never overwrites APK fcmToken) ---------- */
function startFCM(){
  try{
    if(!('Notification' in window))return;
    if(!firebase.messaging.isSupported())return;
    var msg=firebase.messaging();
    Notification.requestPermission().then(function(perm){if(perm!=='granted')return;
      if('serviceWorker' in navigator){navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(function(){});}
      if(!VAPID||String(VAPID).indexOf('PASTE')!==-1){console.warn('VAPID missing — push disabled, orders/chat still live');return;}
      return msg.getToken({vapidKey:VAPID}).then(function(token){
        if(token&&token!==fcmToken){fcmToken=token;
          return fs.collection('vendors').doc(vendorDocId).update({webFcmToken:token,webFcmUpdatedAt:Date.now()}).catch(function(){});
        }
      });
    }).catch(function(){});
    msg.onMessage(function(payload){beep();var t=((payload.notification||{}).title)||'🔔 Update';toast(t+' — check Live Orders / Chats');});
  }catch(e){console.warn('FCM skipped:',e.message);}
}
})();