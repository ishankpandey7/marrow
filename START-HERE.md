# START-HERE.md — sabse pehle ye padho

Ye file Hinglish mein hai kyunki baaki saare docs English mein hain aur wo
agents ke liye likhe gaye hain. Ye file **tumhare liye** hai.

Jab bhi confuse ho jao, wapas yahin aa jaana.

---

## 1. Ye project hai kya?

Ek app bana rahe hain jiska naam **Marrow** hai.

Simple mein: **Pocket** ya **Instapaper** jaisa app. (Firefox ne Pocket 2025 mein
band kar diya tha, isliye ye cheez ab genuinely useful hai.)

Kaam kya karta hai:

1. Tumhe koi article mila internet pe. Abhi padhne ka time nahi hai.
2. Tum uska link Marrow mein paste karte ho.
3. Marrow us page ko **apne server pe kholta hai**, uske andar se sirf asli
   article nikaalta hai — ads, popups, cookie banner, "subscribe to our
   newsletter" wala modal, sab hata deta hai.
4. Wo saaf-suthri copy tumhare account mein save ho jaati hai.
5. Baad mein jab time ho, tum use phone pe aaram se padh lete ho. Internet na
   ho tab bhi.

Plus: tags laga sakte ho, search kar sakte ho, aur ek browser extension hoga
jisse ek click mein current page save ho jaayega.

**Abhi kya bana hai:** sirf dhaancha (skeleton). Ek "coming soon" page dikhta
hai. Database ka design ban chuka hai. Asli features Slice 1 se shuru honge.

---

## 2. Folder kahan hai? Mujhe dikh kyun nahi raha?

Folder yahan hai:

```
C:\Users\LOQ\kuch bada
```

Ye tumhara **user folder** hai — wahi jagah jahan Downloads, Documents,
Desktop rehte hain. `kuch bada` unke bagal mein hai.

**Kholne ka sabse aasan tareeka** — ye command chalao, Explorer window seedha
wahin khul jaayegi:

```bash
explorer.exe "C:\Users\LOQ\kuch bada"
```

**Ya manually:**

1. Keyboard pe `Windows key + E` dabao (File Explorer khulega)
2. Upar wale address bar mein `C:\Users\LOQ` type karke Enter
3. `kuch bada` naam ka folder dikhega, usko double-click

**Agar khaali dikh raha ho:** window pe click karke `F5` dabao (refresh). Windows
kabhi kabhi purana view dikhata rehta hai.

Andar 40+ files hongi — `app`, `docs`, `lib`, `README.md`, waghairah.

> **Zaroori:** `node_modules` naam ka folder dikhega jisme hazaaron files hain.
> Us se darna mat aur usko chedna mat. Wo downloaded code hai jo app ko chalane
> ke liye chahiye. Wo GitHub pe upload nahi hoga.

---

## 3. Git aur GitHub kya hai? (2 minute)

Ye do alag cheezein hain, naam milta-julta hai isliye confusion hota hai.

### Git = tumhare code ka "save point" system

Video game socho. Har important moment pe tum save karte ho. Kuch galat ho gaya
toh purane save pe wapas ja sakte ho.

Git wahi cheez hai code ke liye. Har save point ko **commit** kehte hain.

Abhi tak humne 9 commits banaye hain. Har commit mein likha hai ki kya badla
aur kyun badla.

**Faayda:** agar kal koi agent kuch tod de, toh ek command se sab kuch waapas
theek ho jaata hai. Iske bina tum ghante barbaad karoge.

### GitHub = wo save points internet pe rakhne ki jagah

Google Drive samajh lo, lekin sirf code ke liye.

**Ye kyun chahiye:**

- **Backup.** Laptop kharab hua, code safe hai.
- **Vercel ke liye zaroori.** Vercel (jo app ko internet pe live karega) code
  sirf GitHub se hi uthata hai. Iske bina website live nahi hogi.

GitHub free hai. Repository **private** rakhenge, matlab sirf tum dekh sakte ho.

### `git status --short` matlab kya?

Ye command poochta hai: **"koi cheez aisi hai jo abhi tak save nahi hui?"**

```bash
git status --short
```

Do hi possible jawab hain:

| Screen pe kya aaya                       | Matlab                      | Kya karna hai                 |
| ---------------------------------------- | --------------------------- | ----------------------------- |
| **Kuch nahi. Khaali.**                   | Sab kuch save ho chuka hai. | Kuch nahi. Ye achhi baat hai. |
| Kuch lines aayin, jaise `M app/page.tsx` | Kuch changes save nahi hue  | Agent ko bolo commit kare     |

`M` matlab modified (badla gaya), `??` matlab nayi file jo git ko pata hi nahi.

**Ye command kab chalana hai:** jab bhi tum Claude se Codex pe ya Codex se
Claude pe switch karo. Khaali output aaye tabhi switch karo. Warna dono agents
ek doosre ka kaam mita denge aur kisi ko pata bhi nahi chalega.

Ye ek command sab se zyada dard bachayegi. Bas yaad rakhna: **khaali = safe.**

---

## 4. Command kahan type karni hai?

Do jagah hain:

**Option A — is app ka Terminal (aasan).** Is Claude window mein hi ek Terminal
tab hai. Wahan type kar sakte ho.

**Option B — PowerShell (kuch cheezon ke liye zaroori).**

1. `Windows key` dabao
2. `powershell` type karo
3. Enter

Phir folder mein jaane ke liye — **quotes zaroori hain**, kyunki naam mein space
hai:

```
cd "C:\Users\LOQ\kuch bada"
```

> Jo commands tumse kuch **poochti** hain (jaise `gh auth login`), unhe
> PowerShell mein hi chalana. Main un commands ko apni taraf se nahi chala
> sakta, kyunki mere paas wo interactive window nahi hoti.

---

## 5. Localhost "stopped" kyun dikh raha hai?

Kuch tuta nahi hai. Maine dev server sirf screenshot lene ke liye chalu kiya
tha, aur kaam khatam hone pe band kar diya.

Dev server ek chhota web server hai jo **sirf tumhare computer pe** chalta hai.
Jab tak chalu hai, tab tak `http://localhost:3000` khulta hai. Band karte hi
band ho jaata hai. Internet pe koi aur ise nahi dekh sakta.

**Chalu karne ke liye:**

```bash
npm run dev
```

Phir browser mein kholo: http://localhost:3000

**Band karne ke liye:** us terminal window mein `Ctrl + C` dabao.

Jab tak server chal raha hai, wo terminal window busy rahegi — ye normal hai.
Doosri command chalani ho toh nayi window kholo.

---

## 6. Ab karna kya hai — order mein

Poora time: lagbhag 40 minute. Ek hi baar karna hai.

Jaldi mein ho toh sirf **Step A aur Step C** karo. Utne se agla poora kaam khul
jaata hai.

---

### Step A — GitHub CLI install karo (5 min)

`gh` ek tool hai jisse terminal se hi GitHub pe code bheja ja sakta hai, bina
website khole.

**PowerShell kholo** aur ye chalao:

```
winget install --id GitHub.cli -e
```

Ho jaane ke baad **PowerShell band karke dobara kholo.** Ye step skip mat karna
— naya program purani window ko dikhta hi nahi hai.

Check karo ki install hua ya nahi:

```
gh --version
```

Version number aana chahiye. `not recognized` aaye toh window dobara band karke
kholo.

**Ab login:**

```
gh auth login
```

Ye tumse 4-5 sawaal poochega. Arrow keys se choose karo, Enter dabao:

| Sawaal                                         | Kya chunna hai             |
| ---------------------------------------------- | -------------------------- |
| What account do you want to log into?          | `GitHub.com`               |
| What is your preferred protocol?               | `HTTPS`                    |
| Authenticate Git with your GitHub credentials? | `Yes`                      |
| How would you like to authenticate?            | `Login with a web browser` |

Phir ek code dikhega jaise `A1B2-C3D4`. **Us code ko copy karo**, Enter dabao —
browser khulega, code paste karo, aur **Authorize** dabao.

Terminal mein `Logged in as <tumhara-username>` aaye toh ho gaya.

> GitHub account nahi hai? github.com pe jaake pehle bana lo. Email, password,
> username. Free hai.

---

### Step B — Code GitHub pe daalo (2 min)

Step A ke baad, folder ke andar se:

```
gh repo create marrow --private --source=. --remote=origin --push
```

`--private` ka matlab sirf tum dekh sakte ho. Ye 9 commits GitHub pe chale
jaayenge.

---

### Step C — Supabase (10 min) — sabse zaroori

Supabase = database + login system. **Iske bina Slice 1 shuru hi nahi ho
sakta.** Free plan kaafi hai.

1. **supabase.com** kholo, "Sign in with GitHub" dabao
2. **New project** dabao
3. Name: `marrow`
4. Region: **South Asia (Mumbai)** chuno — India mein ho toh app tez chalega.
   **Ye baad mein badal nahi sakte.**
5. Ek database password apne aap banega — **usko abhi copy karke kahin safe
   likh lo.** Dobara nahi dikhega.
6. 2 minute wait karo, project ban raha hai

**Ab keys copy karni hain.** Left sidebar mein **Project Settings** → **API**:

| Page pe jo dikh raha hai | Kis naam se save karna hai      |
| ------------------------ | ------------------------------- |
| Project URL              | `NEXT_PUBLIC_SUPABASE_URL`      |
| `anon` `public`          | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret`  | `SUPABASE_SERVICE_ROLE_KEY`     |

> **Dhyan se:** `service_role` wali key ek **password** hai. Wo har user ka data
> padh sakti hai. Usko kisi chat mein paste mat karna, kisi ko bhejna mat, aur
> screenshot mein aane mat dena. Sirf `.env.local` file mein.

Phir **Project Settings** → **Database** → **Connection string** → **URI**.
Usme `[YOUR-PASSWORD]` likha hoga — usko step 5 wale password se replace karo.
Ye `SUPABASE_DB_URL` hai.

**Ab in keys ko file mein daalo.** Folder ke andar:

```bash
cp .env.example .env.local
```

`.env.local` ko Notepad mein kholo aur `=` ke baad values paste karo. Bas
itna:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
```

Space mat dena `=` ke aas-paas. Quotes ki zaroorat nahi.

> `.env.local` file kabhi GitHub pe nahi jaayegi — maine wo pehle se set kar
> diya hai. Isliye keys sirf isi file mein daalna.

---

### Step D — Vercel (8 min)

Vercel app ko internet pe live karta hai. Free.

1. **vercel.com** → Sign in with GitHub
2. **Add New** → **Project** → `marrow` repository import karo
3. Settings kuch mat badalna, Next.js apne aap detect ho jaayega
4. **Environment Variables** section mein wahi 3 Supabase values paste karo,
   plus `NEXT_PUBLIC_SITE_URL` (jo URL Vercel dega, bina `/` ke aakhir mein)
5. **Deploy**

---

### Step E — Sentry (5 min, optional)

Sentry batata hai jab app mein koi error aaye. Skip kar sakte ho — sirf errors
ka pata nahi chalega, baaki sab chalta rahega.

sentry.io → GitHub se sign in → New project → platform **Next.js** → DSN copy
karke `.env.local` mein `NEXT_PUBLIC_SENTRY_DSN` aur `SENTRY_DSN` dono mein
daalo.

---

### Step F — Domain (baad mein)

Abhi zaroorat nahi. Launch ke time. Cloudflare pe ~₹1,000/saal.

---

## 7. Ye sab ho jaane ke baad mujhe kya bolna hai?

[AGENT-PROMPTS.md](AGENT-PROMPTS.md) kholo, **"Slice 0 — finish the
credentialed tail"** wala box copy karo, aur mujhe paste kar do.

Uske baad har slice ke liye wahi file — kaunsa prompt, kis agent ko, kis order
mein — sab wahan likha hai.

---

## 8. Roz ke kaam ke commands

Sab folder ke andar se chalana:

| Command              | Kya karta hai                             |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | App chalu karo, phir localhost:3000 kholo |
| `Ctrl + C`           | App band karo                             |
| `git status --short` | Kuch unsaved hai? Khaali = safe           |
| `git log --oneline`  | Ab tak ke saare save points               |
| `npm test`           | Tests chalao                              |
| `explorer.exe .`     | Folder kholo Explorer mein                |

---

## 9. Kabhi mat karna

- **Keys kisi chat, message, ya screenshot mein paste mat karna.** Sirf
  `.env.local` mein. Galti se ho jaaye toh Supabase mein Project Settings →
  API mein "rotate" ka button hai, turant dabao.
- **Dono agents ek saath mat chalao.** Ek folder hai, dono ka kaam mit
  jaayega. Switch karne se pehle hamesha `git status --short`.
- **`node_modules` folder mat chhedna.**
- **Agent "ho gaya" bole toh maan mat lena.** Bolo: "typecheck, lint aur test
  chalao aur output dikhao."

---

## 10. Kuch samajh na aaye toh

Mujhse poochh lo, Hinglish mein. Ye tumhara project hai — sawaal poochna
kamzori nahi hai, jaanbujhkar andhere mein chalna hai.
