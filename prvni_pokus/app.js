// --- CONFIG ---
const JSONBIN_API_KEY = '$2a$10$rpU7scUXWCXKkafuGsrL8uTPptjdR3k8WjJ1f/Hnj6YOa7VyvWEDm';
const JSONBIN_BIN_ID  = 'Y698ee44943b1c97be97b8895';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
let currentUser = null;
let currentRun = null; // aktivni beh
let runsData = {};     // vsechny behy a uzivatele

function saveQueueToStorage() {
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
}

// --- TOAST ---
function showToast(message, type='success') {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(()=>{ toast.classList.remove('toast-show'); setTimeout(()=>toast.remove(),400); },3000);
}

// --- JSONBIN HELPERS ---
async function readDB() {
    const res = await fetch(JSONBIN_URL+'/latest',{headers:{'X-Master-Key':JSONBIN_API_KEY}});
    if(!res.ok) throw new Error('Chyba cteni DB: '+res.status);
    const json = await res.json();
    return json.record;
}
async function writeDB(data){
    const res = await fetch(JSONBIN_URL,{
        method:'PUT',
        headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_API_KEY},
        body:JSON.stringify(data)
    });
    if(!res.ok) throw new Error('Chyba zapisu DB: '+res.status);
}

// --- SAFE WRITE ---
const MAX_RETRIES=5, RETRY_DELAY_MS=300;
async function safeWriteScan(user, runId, scanData){
    for(let attempt=0; attempt<MAX_RETRIES; attempt++){
        try{
            const db=await readDB();
            if(!db.runs) db.runs = {};
            if(!db.runs[runId]) db.runs[runId] = { users:{} };
            if(!db.runs[runId].users[user]) db.runs[runId].users[user] = { scans:[], coords:{} };

            // zkontroluj duplicitu
            const lastScan = db.runs[runId].users[user].scans.slice(-1)[0];
            if(lastScan && lastScan.data===scanData && Math.abs(Date.now()-new Date(lastScan.time).getTime())<5000) return true;

            db.runs[runId].users[user].scans.push({ data: scanData, time: new Date().toISOString() });
            await writeDB(db);
            return true;
        } catch(err){
            if(attempt<MAX_RETRIES-1) await new Promise(r=>setTimeout(r,RETRY_DELAY_MS));
        }
    }
    return false;
}

async function safeWriteLocation(user, runId, coords){
    for(let attempt=0; attempt<MAX_RETRIES; attempt++){
        try{
            const db=await readDB();
            if(!db.runs) db.runs = {};
            if(!db.runs[runId]) db.runs[runId] = { users:{} };
            if(!db.runs[runId].users[user]) db.runs[runId].users[user] = { scans:[], coords:{} };
            db.runs[runId].users[user].coords = { ...coords, time: new Date().toLocaleTimeString() };
            await writeDB(db);
            return true;
        } catch(err){
            if(attempt<MAX_RETRIES-1) await new Promise(r=>setTimeout(r,RETRY_DELAY_MS));
        }
    }
    return false;
}

// --- FLUSH OFFLINE QUEUE ---
async function flushOfflineQueue(){
    if(offlineQueue.length===0||!navigator.onLine) return;
    const toRetry=[...offlineQueue];
    offlineQueue=[];
    saveQueueToStorage();
    let failed=[];
    for(const entry of toRetry){
        const ok = await safeWriteScan(entry.user, entry.runId, entry.data);
        if(!ok) failed.push(entry);
    }
    if(failed.length>0){ offlineQueue=[...offlineQueue,...failed]; saveQueueToStorage(); }
}

// --- LOGIN + ROLE ---
const loginForm = document.getElementById('loginForm');
const teacherNav = document.getElementById('teacherNav');

loginForm.addEventListener('submit', e=>{
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    if(!username||!password){ showToast('Vyplň jméno a heslo!','error'); return; }
    currentUser = (username==='teacher' && password==='admin123') ? 'teacher' : username;
    showToast(`Přihlášeno jako ${currentUser}`,'success');
    updateUIForRole();
    flushOfflineQueue();
});

function updateUIForRole(){
    teacherNav.style.display = (currentUser==='teacher')?'block':'none';
}

// --- NAVIGATION ---
const navItems = document.querySelectorAll('nav ul li');
const views = document.querySelectorAll('.view');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');

menuToggle.addEventListener('click',()=>{ sidebar.classList.toggle('open'); });
navItems.forEach(item=>{
    item.addEventListener('click',()=>{
        const viewId = item.dataset.view;
        if(viewId==='teacher' && currentUser!=='teacher'){ showToast('Pouze pro učitele!','error'); return; }
        views.forEach(v=>v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        sidebar.classList.remove('open');
        if(viewId==='history') loadHistory();
        if(viewId==='teacher') loadTeacherDashboard();
    });
});

// --- MAPA ---
const mapCanvas = document.getElementById('mapCanvas');
const ctxMap = mapCanvas.getContext('2d');
const mapImage = new Image();
mapImage.src='prvni_pokus/mapa.png';

mapImage.onload = ()=>{ ctxMap.drawImage(mapImage,0,0,mapCanvas.width,mapCanvas.height); };

function drawDot(x,y,color='red'){
    ctxMap.clearRect(0,0,mapCanvas.width,mapCanvas.height);
    ctxMap.drawImage(mapImage,0,0,mapCanvas.width,mapCanvas.height);
    ctxMap.fillStyle=color;
    ctxMap.beginPath();
    ctxMap.arc(x,y,6,0,2*Math.PI);
    ctxMap.fill();
}

mapCanvas.addEventListener('click', e=>{
    if(!currentUser){ showToast('Nejsi přihlášen!','error'); return; }
    if(currentUser==='teacher') return;
    if(!currentRun){ showToast('Žádný běh aktivní!','error'); return; }

    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX-rect.left;
    const y = e.clientY-rect.top;
    drawDot(x,y);
    safeWriteLocation(currentUser, currentRun, {x,y});
});

// --- QR SCANNER (pouze pro studenty) ---
const video=document.getElementById('video');
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
let scanning=false;

document.getElementById('startScan').addEventListener('click',()=>{
    if(currentUser==='teacher'){ showToast('Učitel nemůže skenovat!','error'); return; }
    if(scanning) return;
    if(!currentRun){ showToast('Žádný běh aktivní!','error'); return; }

    scanning=true;
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(stream=>{
        video.srcObject=stream;
        requestAnimationFrame(scanFrame);
    });
});

function scanFrame(){
    if(!scanning) return;
    if(video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth; canvas.height=video.videoHeight;
        ctx.drawImage(video,0,0);
        const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = jsQR(imageData.data,canvas.width,canvas.height);
        if(code){
            showToast(`QR: ${code.data}`);
            scanning=false;
            safeWriteScan(currentUser, currentRun, code.data);
            setTimeout(()=>scanning=true,2000);
        }
    }
    requestAnimationFrame(scanFrame);
}

// --- HISTORY ---
async function loadHistory(){
    const list=document.getElementById('historyList');
    list.innerHTML='<li>Načítám...</li>';
    const db = await readDB();
    list.innerHTML='';
    if(!currentRun){ list.innerHTML='<li>Žádný běh aktivní.</li>'; return; }
    const userData = db.runs?.[currentRun]?.users?.[currentUser];
    if(!userData || !userData.scans.length){ list.innerHTML='<li>Žádné skeny</li>'; return; }
    userData.scans.forEach(item=>{
        const li=document.createElement('li');
        li.textContent=`${item.time} – ${item.data}`;
        list.appendChild(li);
    });
}

// --- TEACHER DASHBOARD ---
async function loadTeacherDashboard(){
    const list=document.getElementById('teacherList');
    list.innerHTML='<li>Načítám...</li>';
    const db = await readDB();
    list.innerHTML='';

    if(!db.runs) return;
    Object.entries(db.runs).forEach(([runId, runData])=>{
        const liRun = document.createElement('li');
        liRun.innerHTML = `<strong>Běh: ${runId}</strong> – ${Object.keys(runData.users).length} běžců`;
        const ulUsers = document.createElement('ul');

        Object.entries(runData.users).forEach(([user, data])=>{
            const liUser = document.createElement('li');
            liUser.innerHTML = `<strong>${user}</strong> – QR: ${data.scans.length} – Poloha: ${data.coords.x||'-'},${data.coords.y||'-'}`;
            ulUsers.appendChild(liUser);

            if(data.coords.x && data.coords.y) drawDot(data.coords.x, data.coords.y, user==='teacher'?'blue':'green');
        });
        liRun.appendChild(ulUsers);
        list.appendChild(liRun);
    });
}

// --- ONLOAD ---
window.addEventListener('load', ()=>{
    if(navigator.onLine && offlineQueue.length>0){ flushOfflineQueue(); }
});
