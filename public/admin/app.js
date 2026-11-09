/* Dolce Admin V2 - two separate queues */
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
function toast(m){var t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none';},3500);}
function key(){return $('admKey').value.trim();}
function H(k){return {'x-admin-key':k,'Content-Type':'application/json'};}
$('loadBtn').onclick=load;
$('createBtn').onclick=function(){
  fetch('/api/ambassador/register',{method:'POST',headers:H(key()),body:JSON.stringify({name:$('nName').value,phone:$('nPhone').value,school:$('nSchool').value,adminKey:key()})})
  .then(function(r){return r.json();}).then(function(j){
    toast(j.success?('Created! Code: '+j.code+(j.walletLinked?' • wallet linked':' • NO wallet yet — ambassador must register in app with same number')):(j.error||'Failed'));
    if(j.success)load();});
};
function load(){
  // meals queue
  fetch('/api/ambassador/admin/meals?adminKey='+encodeURIComponent(key()),{headers:{'x-admin-key':key()}})
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Meal queue failed');return;}
    $('meals').innerHTML=j.pendingMeals.length?j.pendingMeals.map(function(m){
      return '<div class="q"><b>Slot '+m.slot+'</b> • '+(m.ambassador?m.ambassador.name+' ('+m.ambassador.code+')':'?')+' • KES '+(m.amount||150)+' • '+m.weekKey
      +'<br/><button onclick="mealOk(\''+m.id+'\')">Approve → credit BodaWallet</button> <button class="ghost" onclick="mealNo(\''+m.id+'\')">Reject</button></div>';
    }).join(''):'<p class="sub">No pending meals.</p>';
  });
  // payouts queue
  fetch('/api/ambassador/admin/payouts?adminKey='+encodeURIComponent(key()),{headers:{'x-admin-key':key()}})
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Payout queue failed');return;}
    $('pays').innerHTML=j.payouts.length?j.payouts.map(function(p){
      var label=p.kind==='bodawallet'?'→ credit BodaWallet':'→ send M-Pesa '+p.mpesaPhone+' then Mark PAID';
      return '<div class="q"><b>KES '+p.amount+'</b> • '+p.kind+' • '+p.status+' • amb '+String(p.ambassadorId).slice(0,6)+'<br/><span class="sub">'+label+'</span><br/>'
      +'<button onclick="payGo(\''+p.id+'\',\'approve\')">'+(p.kind==='bodawallet'?'Approve → credit wallet':'Approve')+'</button> '
      +(p.kind==='mpesa'?'<button onclick="payGo(\''+p.id+'\',\'paid\')">Mark PAID</button> ':'')
      +'<button class="ghost" onclick="payGo(\''+p.id+'\',\'reject\')">Reject</button></div>';
    }).join(''):'<p class="sub">No pending withdrawals.</p>';
  });
  // overview
  fetch('/api/ambassador/admin/overview?adminKey='+encodeURIComponent(key()),{headers:{'x-admin-key':key()}})
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Overview failed');return;}
    var h='<table><tr><th>Amb</th><th>Installs</th><th>Orders</th><th>Escrow</th><th>Meals</th><th>Status</th></tr>';
    j.ambassadors.forEach(function(a){
      h+='<tr><td><b>'+a.code+'</b><br/>'+a.name+'<br/><span class="sub">'+(a.school||'')+'<br/>'+a.phone+'</span></td>'
      +'<td>'+a.installs+'</td><td>'+a.orderUsers+' users<br/><span class="sub">'+a.validOrders+' orders</span></td>'
      +'<td>'+a.totalEarned+'<br/><b>'+a.available+' avail</b></td>'
      +'<td>'+a.mealsUsed+'/3<br/><span class="sub">'+a.weekKey+'</span></td>'
      +'<td>'+(a.active?'🟢':'🔴')+'<br/><button class="ghost" onclick="toggleAmb(\''+a.id+'\','+(a.active?'false':'true')+')">'+(a.active?'Deactivate':'Activate')+'</button></td></tr>';
    });
    $('ambs').innerHTML=h+'</table>';
  });
}
window.mealOk=function(id){fetch('/api/ambassador/admin/meals/approve',{method:'POST',headers:H(key()),body:JSON.stringify({claimId:id,adminKey:key()})}).then(function(r){return r.json();}).then(function(j){toast(j.success?('Credited '+(j.creditedPassenger||'')):(j.error||'Failed'));load();});};
window.mealNo=function(id){fetch('/api/ambassador/admin/meals/reject',{method:'POST',headers:H(key()),body:JSON.stringify({claimId:id,adminKey:key()})}).then(function(){load();});};
window.payGo=function(id,action){fetch('/api/ambassador/admin/payouts/decide',{method:'POST',headers:H(key()),body:JSON.stringify({payoutId:id,action:action,adminKey:key()})}).then(function(r){return r.json();}).then(function(j){toast(j.success?'Updated':(j.error||'Failed'));load();});};
window.toggleAmb=function(id,active){fetch('/api/ambassador/admin/toggle-active',{method:'POST',headers:H(key()),body:JSON.stringify({ambassadorId:id,active:active,adminKey:key()})}).then(function(){load();});};
})();