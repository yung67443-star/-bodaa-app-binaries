/* Dolce Admin app */
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
function toast(m){var t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none';},3500);}
function key(){return $('admKey').value.trim();}
$('loadBtn').onclick=load;
$('createBtn').onclick=function(){
  fetch('/api/ambassador/register',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key()},
    body:JSON.stringify({name:$('nName').value,phone:$('nPhone').value,school:$('nSchool').value,adminKey:key()})})
  .then(function(r){return r.json();}).then(function(j){toast(j.success?('Created! Code: '+j.code):(j.error||'Failed'));if(j.success)load();})
  .catch(function(e){toast(e.message);});
};
function load(){
  fetch('/api/ambassador/admin/overview?adminKey='+encodeURIComponent(key()),{headers:{'x-admin-key':key()}})
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Failed - check key');return;}
    var h='<table><tr><th>Amb</th><th>Refs/Active</th><th>Earned/Avail</th><th>Meals</th><th>Status</th><th>Action</th></tr>';
    j.ambassadors.forEach(function(a){
      h+='<tr><td><b>'+a.code+'</b><br/>'+a.name+'<br/><span class="sub">'+(a.school||'')+'</span></td>'
      +'<td>'+a.referrals+' / '+a.activeReferrals+'</td>'
      +'<td>'+a.totalEarned+' / <b>'+a.available+'</b></td>'
      +'<td>'+a.mealsUsed+'/3<br/><span class="sub">'+a.weekKey+'</span></td>'
      +'<td>'+(a.active?'🟢':'🔴')+(a.probation?' <span class="red">PROBATION ('+a.lastOrderDaysAgo+'d idle)</span>':' <span class="sub">'+a.lastOrderDaysAgo+'d ago</span>')+'</td>'
      +'<td><button class="ghost" onclick="toggleAmb(\''+a.id+'\','+(a.active?'false':'true')+')">'+(a.active?'Deactivate':'Activate')+'</button></td></tr>';
    });
    h+='</table>';
    $('ambs').innerHTML=h;
    var p=j.pendingPayouts.length?'<table><tr><th>Amb</th><th>Amt</th><th>Phone</th><th>Action</th></tr>'+j.pendingPayouts.map(function(x){
      return '<tr><td>'+x.ambassadorId.slice(0,6)+'</td><td>KES '+x.amount+'</td><td>'+x.mpesaPhone+'</td>'
      +'<td><button onclick="decide(\''+x.id+'\',\'paid\')">Mark PAID</button> <button class="ghost" onclick="decide(\''+x.id+'\',\'reject\')">Reject</button></td></tr>';
    }).join('')+'</table>':'<p class="sub">No pending payouts.</p>';
    $('pays').innerHTML=p;
  }).catch(function(e){toast(e.message);});
}
window.toggleAmb=function(id,active){
  fetch('/api/ambassador/admin/toggle-active',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key()},body:JSON.stringify({ambassadorId:id,active:active,adminKey:key()})})
  .then(function(r){return r.json();}).then(function(){load();});
};
window.decide=function(id,action){
  fetch('/api/ambassador/admin/payout',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key()},body:JSON.stringify({payoutId:id,action:action,adminKey:key()})})
  .then(function(r){return r.json();}).then(function(j){toast(j.success?'Updated':'Failed');load();});
};
})();
