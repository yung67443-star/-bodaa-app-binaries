/* Dolce Ambassador app - plain fetch to standalone backend */
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
function toast(m){var t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none';},3500);}
var ambId=localStorage.getItem('dolce_amb_id')||'';
if(ambId){$('loginCard').style.display='none';$('dash').style.display='block';load();}
$('loginBtn').onclick=function(){
  var code=$('code').value.trim(),phone=$('phone').value.trim();
  if(!code||!phone){toast('Enter code + phone');return;}
  fetch('/api/ambassador/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,phone:phone})})
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Login failed');return;}
    ambId=j.ambassadorId;localStorage.setItem('dolce_amb_id',ambId);
    $('loginCard').style.display='none';$('dash').style.display='block';load();
  }).catch(function(e){toast(e.message);});
};
$('logoutBtn').onclick=function(){localStorage.removeItem('dolce_amb_id');location.reload();};
$('mealBtn').onclick=function(){
  fetch('/api/ambassador/claim-meal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ambassadorId:ambId})})
  .then(function(r){return r.json();}).then(function(j){toast(j.success?('Meal claimed! Left this week: '+j.mealsLeft):(j.error||'Failed'));if(j.success)load();})
  .catch(function(e){toast(e.message);});
};
$('payBtn').onclick=function(){
  var amt=$('amt').value.trim(),mpesa=$('mpesa').value.trim();
  fetch('/api/ambassador/request-payout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ambassadorId:ambId,amount:amt,mpesaPhone:mpesa})})
  .then(function(r){return r.json();}).then(function(j){toast(j.success?'Payout requested! Paid Monday.':(j.error||'Failed'));if(j.success)load();})
  .catch(function(e){toast(e.message);});
};
function load(){
  fetch('/api/ambassador/dashboard?ambassadorId='+encodeURIComponent(ambId))
  .then(function(r){return r.json();}).then(function(j){
    if(!j.success){toast(j.error||'Failed');if(/not found/i.test(j.error||'')){localStorage.removeItem('dolce_amb_id');location.reload();}return;}
    $('hello').textContent='Hi '+j.amb.name+' 👋';
    $('codeLine').textContent='Code: '+j.amb.code+' • School: '+(j.amb.school||'-')+' • Share: dolce.name.ng?ref='+j.amb.code;
    $('sAvail').textContent='KES '+j.available;
    $('sTotal').textContent='KES '+j.totalEarned;
    $('sRefs').textContent=j.referrals.length;
    $('sActive').textContent=j.activeReferralCount;
    $('mealLine').textContent='Meals this week ('+j.weekKey+'): '+j.mealsUsed+'/3 used • '+j.mealsLeft+' left';
    var rh='';
    if(!j.referrals.length)rh='<p class="sub">No referrals yet. Share your code!</p>';
    else rh='<table><tr><th>Phone</th><th>Joined</th></tr>'+j.referrals.slice(0,50).map(function(r){
      var dt=r.referredAt&&r.referredAt._seconds?new Date(r.referredAt._seconds*1000).toLocaleDateString():'-';
      var ph=String(r.phone||r.id||'').slice(-9);
      return '<tr><td>***'+ph+'</td><td>'+dt+'</td></tr>';
    }).join('')+'</table>';
    $('refs').innerHTML=rh;
    var ch='';
    if(!j.commissions.length)ch='<p class="sub">No paid food orders yet from your code.</p>';
    else ch='<table><tr><th>Order</th><th>Total</th><th>You +40%</th></tr>'+j.commissions.map(function(c){
      return '<tr><td>'+String(c.orderId||'').slice(-6)+'</td><td>'+c.orderTotal+'</td><td class="green">+'+c.commissionAmount+'</td></tr>';
    }).join('')+'</table>';
    $('comms').innerHTML=ch;
    var ph2=j.payouts&&j.payouts.length?j.payouts.map(function(p){return '<div>KES '+p.amount+' • '+p.status+'</div>';}).join(''):'<p class="sub">No payouts yet. Min 200.</p>';
    $('pays').innerHTML=ph2;
  }).catch(function(e){toast(e.message);});
}
})();
