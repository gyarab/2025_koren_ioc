// --- CONFIG ---
const JSONBIN_API_KEY = '$2a$10$rpU7scUXWCXKkafuGsrL8uTPptjdR3k8WjJ1f/Hnj6YOa7VyvWEDm';
const JSONBIN_BIN_ID  = 'Y698ee44943b1c97be97b8895';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
let currentRun = null;

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
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// --- ONLINE / OFFLINE ---
window.addEventListener('online', () => { showToast('Připojení obnoveno', 'info'); flushOfflineQueue(); });
window.addEventListener('offline', () => { showToast('Offline – skeny se ukládají lokálně', 'warning'); });

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
async function safeWriteScan(scanEntry){
    for(let attempt=0;attempt<MAX_RETRIES;attempt++){
        try{
            const db=await readDB();
            const isDuplicate=db.scans.some(s=>s.user===scanEntry.user && s.data===scanEntry.data && Math.abs(Date.now()-new Date(s.savedAt||0).getTime())<5000);
            if(isDuplicate) return true;
            db.scans.push({...scanEntry,savedAt:new Date().toISOString()});
            await writeDB(db);
            return true;
        }catch(err){
            if(attempt<MAX_RETRIES-1) await new Promise(r=>setTimeout(r,RETRY_DELAY_MS));
        }
    }
    return false;
}

async function safeWriteLocation(user, coords){
    for(let attempt=0;attempt<MAX_RETRIES;attempt++){
        try{
            const db=await readDB();
            db.users[user]=coords;
            await writeDB(db);
            return true;
        }catch(err){
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
        const ok=await safeWriteScan(entry);
        if(!ok) failed.push(entry);
    }
    if(failed.length>0){ offlineQueue=[...offlineQueue,...failed]; saveQueueToStorage(); }
}

// --- LOGIN + ROLE ---
let currentUser=null;
const loginForm=document.getElementById('loginForm');
const teacherNav=document.getElementById('teacherNav');

loginForm.addEventListener('submit',e=>{
    e.preventDefault();
    const username=document.getElementById('username').value.trim();
    const password=document.getElementById('password').value.trim();
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
const navItems=document.querySelectorAll('nav ul li');
const views=document.querySelectorAll('.view');
const sidebar=document.getElementById('sidebar');
const menuToggle=document.getElementById('menuToggle');

menuToggle.addEventListener('click',()=>{ sidebar.classList.toggle('open'); });

navItems.forEach(item=>{
    item.addEventListener('click',()=>{
        const viewId=item.dataset.view;
        if(viewId==='teacher' && currentUser!=='teacher'){ showToast('Pouze pro učitele!','error'); return; }

        views.forEach(v=>v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        sidebar.classList.remove('open');

        if(viewId==='history') loadHistory();
        if(viewId==='teacher') loadTeacherDashboard();
    });
});

// --- MAPA ---
const mapCanvas=document.getElementById('mapCanvas');
const ctxMap=mapCanvas.getContext('2d');
const mapImage=new Image();
mapImage.src='prvni_pokus/mapa.png';

mapImage.onload=()=>{ ctxMap.drawImage(mapImage,0,0,mapCanvas.width,mapCanvas.height); };

function drawDot(x,y){
    ctxMap.clearRect(0,0,mapCanvas.width,mapCanvas.height);
    ctxMap.drawImage(mapImage,0,0,mapCanvas.width,mapCanvas.height);
    ctxMap.fillStyle='red';
    ctxMap.beginPath();
    ctxMap.arc(x,y,6,0,2*Math.PI);
    ctxMap.fill();
}

mapCanvas.addEventListener('click',e=>{
    if(!currentUser){ showToast('Nejsi přihlášen!','error'); return; }
    const rect=mapCanvas.getBoundingClientRect();
    const x=e.clientX-rect.left;
    const y=e.clientY-rect.top;
    drawDot(x,y);
    safeWriteLocation(currentUser,{x,y,time:new Date().toLocaleTimeString()});
});

// --- QR SCANNER ---
let video=document.getElementById('video');
let canvas=document.getElementById('canvas');
let ctx=canvas.getContext('2d');
let scanning=false;

document.getElementById('startScan').addEventListener('click',()=>{
    if(scanning) return;
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
        const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
        const code=jsQR(imageData.data,imageData.width,imageData.height);
        if(code){ showToast("QR: "+code.data); scanning=false; setTimeout(()=>scanning=true,2000);}
    }
    requestAnimationFrame(scanFrame);
}

// --- HISTORY ---
async function loadHistory(){
    const list=document.getElementById('historyList');
    list.innerHTML='<li>Nacitam...</li>';
    const db=await readDB();
    list.innerHTML='';
    const userScans=db.scans.filter(d=>d.user===currentUser);
    userScans.forEach(item=>{
        const li=document.createElement('li');
        li.textContent=`${item.time} – ${item.data}`;
        list.appendChild(li);
    });
}

// --- TEACHER DASHBOARD ---
async function loadTeacherDashboard(){
    const list=document.getElementById('teacherList');
    list.innerHTML='<li>Nacitam...</li>';
    const db=await readDB();
    list.innerHTML='';

    // vykresli vsechny uzivatele jako tecky
    ctxMap.clearRect(0,0,mapCanvas.width,mapCanvas.height);
    ctxMap.drawImage(mapImage,0,0,mapCanvas.width,mapCanvas.height);

    Object.entries(db.users).forEach(([user,coords])=>{
        const scans=db.scans.filter(d=>d.user===user);
        const li=document.createElement('li');
        li.innerHTML=`<strong>${user}</strong><br>Poloha: ${coords.x}, ${coords.y}<br>Čas: ${coords.time}<br>QR: ${scans.length}`;
        list.appendChild(li);

        // vykreslení tečky na mapě
        ctxMap.fillStyle = (user==='teacher') ? 'blue' : 'green';
        ctxMap.beginPath();
        ctxMap.arc(coords.x,coords.y,6,0,2*Math.PI);
        ctxMap.fill();
    });
}

// --- CREATE RUN ---
document.getElementById('createRunBtn').addEventListener('click', async ()=>{
    if(!currentUser||currentUser!=='teacher'){ 
        showToast('Pouze učitel může vytvořit běh','error'); 
        return; 
    }

    if(!confirm("Opravdu chcete vytvořit nový běh? Všechny předchozí skeny budou smazány.")) return;

    const db = await readDB();
    db.scans = [];     // vymaže všechny předchozí skeny
    db.users = {};     // vymaže všechny uložené pozice
    await writeDB(db);

    currentRun = new Date().toISOString(); // nastavíme nový běh s časem
    showToast('Nový běh vytvořen','success');
    loadTeacherDashboard(); // refresh dashboardu
});

// --- ONLOAD ---
window.addEventListener('load',()=>{
    if(navigator.onLine && offlineQueue.length>0){ flushOfflineQueue(); }
});
