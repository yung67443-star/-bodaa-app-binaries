const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const getDb = () => getFirestore();

// TODO: set these in your env — ask user for real links
const PASSENGER_WEB_URL = process.env.PASSENGER_WEB_URL || "https://dolce.name.ng";
const PLAY_STORE_URL = process.env.PLAY_STORE_URL || PASSENGER_WEB_URL;

const escapeHtml = (unsafe = "") =>
  String(unsafe).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

const personaEmoji = (p="") => ({ bae:"❤️", talking:"👀", mom_dad:"🙏", bestie:"🤞", sibling:"🏠", me:"😌" }[p] || "❤️");

exports.sealGiftMessage = async (req,res) => {
  try{
    const { orderId, senderName, senderUid, recipientPhone, giftMessage, persona, vendorName } = req.body;
    if(!orderId || !giftMessage) return res.status(400).json({success:false, error:"Missing orderId or gift text."});
    await getDb().collection('premium_gift_cards').doc(orderId).set({
      order_id: orderId, sender_name: senderName || "A Mysterious Admirer",
      sender_uid: senderUid || "", recipient_phone: recipientPhone || "",
      gift_message: giftMessage.toString().slice(0,500),
      persona: persona || "", vendor_name: vendorName || "",
      opened:false, opened_at:null, created_at: FieldValue.serverTimestamp()
    });
    return res.status(200).json({success:true, message:"Gift sealed."});
  }catch(e){ console.error(e); return res.status(500).json({success:false, error:"Failed to seal gift."}); }
};

exports.revealGiftEnvelope = async (req,res) => {
  try{
    const { orderId } = req.params;
    const snap = await getDb().collection('premium_gift_cards').doc(orderId).get();
    if(!snap.exists) return res.status(404).send("<h3 style='font-family:sans-serif;text-align:center;margin-top:50px'>This dolce envelope does not exist.</h3>");
    const data = snap.data();
    if(!data.opened) await getDb().collection('premium_gift_cards').doc(orderId).update({opened:true, opened_at: FieldValue.serverTimestamp()});

    const safeMessage = escapeHtml(data.gift_message);
    const safeSender = escapeHtml(data.sender_name);
    const emoji = personaEmoji(data.persona);
    const webUrl = PASSENGER_WEB_URL + `?ref=gift_${encodeURIComponent(orderId)}`;

    return res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>dolce — A gift for you ${emoji}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,600&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--choc:#3E2314;--pink:#F6A9A0;--pink-deep:#E8958A;--bg:#FAF4F0;--muted:#9A8A86}
*{box-sizing:border-box}body{background:var(--bg);font-family:'Poppins',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:16px;overflow-x:hidden}
.card{text-align:center;width:100%;max-width:380px;background:#fff;padding:28px 22px 18px;border-radius:28px;box-shadow:0 20px 40px rgba(62,35,20,.09);border:1px solid #F3ECE6;position:relative;z-index:10}
.brand{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--choc);font-weight:700;margin-bottom:6px}
.hint{font-size:13px;color:var(--muted);margin-bottom:16px}
.env-stage{padding:10px 0 6px;cursor:pointer}.env{position:relative;width:280px;height:190px;margin:0 auto}
.env-back{position:absolute;inset:0;background:#FCDDD8;border-radius:18px}
.letter-mini{position:absolute;left:16px;right:16px;top:14px;bottom:14px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-style:italic;color:var(--choc);font-size:22px;transition:transform .8s cubic-bezier(.2,.9,.25,1.1);box-shadow:0 6px 18px rgba(62,35,20,.12)}
.env-pocket{position:absolute;inset:0;background:var(--pink);border-radius:18px;clip-path:polygon(0 0,50% 52%,100% 0,100% 100%,0 100%);opacity:.97}
.env-flap{position:absolute;left:0;right:0;top:0;height:52%;background:var(--pink-deep);clip-path:polygon(0 0,100% 0,50% 100%);border-radius:18px 18px 0 0;transform-origin:top center;transition:transform .6s ease,z-index .6s;z-index:3}
.seal{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:56px;height:56px;background:var(--choc);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;z-index:4;transition:opacity .3s;box-shadow:0 6px 14px rgba(62,35,20,.3)}
.env.open .env-flap{transform:rotateX(180deg);z-index:1}.env.open .seal{opacity:0}.env.open .letter-mini{transform:translateY(-68%) scale(1.04)}
#revealed{display:none;animation:up .7s cubic-bezier(.1,1,.1,1) both}@keyframes up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
h2{color:var(--choc);font-family:'Playfair Display',serif;font-style:italic;font-size:24px;margin:8px 0 4px}
.msg{background:#FFFDFB;border:1px dashed #E3CFC3;padding:20px;border-radius:16px;color:#4A3E3D;font-size:15px;line-height:1.65;margin-top:12px;font-style:italic;font-family:'Playfair Display',serif}
.from{margin-top:14px;font-weight:500;color:var(--choc);font-size:14px}
.btn{display:block;width:100%;border:none;border-radius:16px;padding:15px;font-size:14px;font-weight:700;cursor:pointer;margin-top:12px;text-decoration:none;box-sizing:border-box}
.btn-dark{background:var(--choc);color:#fff}.sublink{display:block;margin-top:12px;font-size:13px;color:var(--choc);font-weight:600;text-decoration:none}
.watermark{margin-top:14px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C9B8B2}
.confetti{position:fixed;top:-30px;pointer-events:none;z-index:50;animation:fall linear forwards}@keyframes fall{to{transform:translateY(112vh) rotate(360deg)}}
</style></head><body>
<div class="card"><div class="brand">dolce</div>
<div id="sealed"><div class="hint">You've got mail 💌 — tap to open</div>
<div class="env-stage" onclick="openEnvelope()"><div class="env" id="env"><div class="env-back"></div><div class="letter-mini">for you…</div><div class="env-pocket"></div><div class="env-flap"></div><div class="seal">${emoji}</div></div></div>
<div class="hint" style="margin-top:14px">from <b>${safeSender}</b></div></div>
<div id="revealed"><h2>A sweet message for you…</h2><div class="msg">"${safeMessage}"</div><div class="from">— with love from ${safeSender} ${emoji}</div>
<button class="btn btn-dark" onclick="flexCard()">Share this moment 📤</button>
<a class="sublink" href="${webUrl}">Surprise them back →</a><div class="watermark">made with dolce</div></div></div>
<script>
let opened=false;
function openEnvelope(){if(opened)return;opened=true;document.getElementById('env').classList.add('open');setTimeout(burst,550);setTimeout(()=>{document.getElementById('sealed').style.display='none';document.getElementById('revealed').style.display='block';burst();},1150);}
function burst(){const em=['❤️','✨','🧁','💌','🎉'];for(let i=0;i<28;i++){const s=document.createElement('div');s.className='confetti';s.textContent=em[Math.floor(Math.random()*em.length)];s.style.left=Math.random()*100+'vw';s.style.animationDuration=(2.2+Math.random()*2.5)+'s';s.style.fontSize=(14+Math.random()*20)+'px';document.body.appendChild(s);setTimeout(()=>s.remove(),5200);}}
async function flexCard(){
const msg=${JSON.stringify(data.gift_message)};const from=${JSON.stringify(data.sender_name)};const link=${JSON.stringify(webUrl)};
const c=document.createElement('canvas');c.width=1080;c.height=1920;const x=c.getContext('2d');
x.fillStyle='#FAF4F0';x.fillRect(0,0,1080,1920);x.textAlign='center';
x.fillStyle='#3E2314';x.font='700 64px Poppins, sans-serif';x.fillText('dolce',540,200);
x.fillStyle='#E8958A';x.font='600 38px Poppins, sans-serif';x.fillText('I just got surprised \\uD83D\\uDC8C',540,262);
x.fillStyle='#fff';x.beginPath();x.moveTo(110+56,360);x.arcTo(970,360,970,1340,56);x.arcTo(970,1340,110,1340,56);x.arcTo(110,1340,110,360,56);x.arcTo(110,360,970,360,56);x.closePath();x.fill();
x.fillStyle='#F6A9A0';x.font='400 90px serif';x.fillText('\\uD83D\\uDC8C',540,520);
x.fillStyle='#3E2314';x.font='italic 600 52px Georgia, serif';wrap(x,'\\u201C'+msg+'\\u201D',540,640,720,72);
x.fillStyle='#3E2314';x.font='500 40px Poppins, sans-serif';x.fillText(('-- with love from '+from).slice(0,60),540,1180);
x.fillStyle='#9A8A86';x.font='400 34px Poppins, sans-serif';x.fillText('Surprise someone:',540,1300);
x.fillStyle='#3E2314';x.font='600 34px Poppins, sans-serif';try{x.fillText(new URL(link).hostname,540,1350);}catch(e){x.fillText('dolce',540,1350);}
x.fillStyle='#C9B8B2';x.font='600 28px Poppins, sans-serif';x.fillText('M A D E  W I T H  D O L C E',540,1760);
const blob=await new Promise(r=>c.toBlob(r,'image/png'));const file=new File([blob],'dolce-surprise.png',{type:'image/png'});
const caption='I just got surprised via dolce ${emoji} — surprise someone: '+link;
if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'dolce surprise',text:caption});return;}catch(e){}}
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dolce-surprise.png';a.click();
try{await navigator.clipboard.writeText(caption);alert('Image downloaded + caption copied — post to Status / Story ❤️');}catch(e){alert('Image downloaded — post it ❤️');}
window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(caption),'_blank');}
function wrap(x,text,cx,y,maxW,lh){const words=text.split(' ');let line='',yy=y;for(const w of words){const t=line+w+' ';if(x.measureText(t).width>maxW){x.fillText(line,cx,yy);line=w+' ';yy+=lh;}else line=t;}x.fillText(line,cx,yy);}
<\/script></body></html>`);
  }catch(e){ console.error(e); return res.status(500).send("Error opening dolce envelope."); }
};
